// Launchpad metadata upload: image + token metadata JSON -> durable content-addressed storage.
//
// Server-side only. Storage credentials come from the environment and never reach the browser.
// Flow: size-bounded body -> multipart parse -> content sniffing -> field validation -> wallet-signed
// authorization -> rate limit -> pin image -> pin metadata -> re-fetch both from the gateway and
// confirm they are byte/field exact -> return the URI. Nothing is returned as usable until verified.
import {validateLaunch,MAX_IMAGE_BYTES} from '../src/launchpad-model.mjs';
import {createTokenMetadata,verifyMetadataDocument} from '../src/launchpad-metadata.mjs';

export const MAX_BODY_BYTES=MAX_IMAGE_BYTES+64*1024;
export const AUTH_WINDOW_MS=5*60*1000;
const FIELDS=['name','symbol','description','website','twitter','telegram'];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const sha256Hex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** Content sniffing by magic bytes; the declared MIME type is never trusted. */
export function sniffImage(bytes){
 const b=bytes;
 if(b.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v,i)=>b[i]===v))return 'image/png';
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=12&&[0x52,0x49,0x46,0x46].every((v,i)=>b[i]===v)&&[0x57,0x45,0x42,0x50].every((v,i)=>b[8+i]===v))return 'image/webp';
 return null;
}

/** Exact text the wallet signs. Binds the upload to one wallet, one image and one moment. */
export const uploadAuthMessage=({wallet,imageSha256,issuedAt})=>`Pumphooks metadata upload\nwallet: ${wallet}\nimage-sha256: ${imageSha256}\nissued: ${issuedAt}`;

const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(text){
 let n=0n;for(const c of text){const i=B58.indexOf(c);if(i<0)throw Error('bad base58');n=n*58n+BigInt(i);}
 const out=[];while(n>0n){out.unshift(Number(n&255n));n>>=8n;}
 for(const c of text){if(c!=='1')break;out.unshift(0);}
 return Uint8Array.from(out);
}

export async function verifyUploadAuth({wallet,imageSha256,issuedAt,signature},{now=Date.now,seen=new Map()}={}){
 const issued=Number(issuedAt);
 if(!Number.isSafeInteger(issued)||Math.abs(now()-issued)>AUTH_WINDOW_MS)throw new HttpError(401,'Upload authorization expired. Sign again.');
 let key,sig;
 try{key=base58Decode(String(wallet));sig=Uint8Array.from(atob(String(signature)),c=>c.charCodeAt(0));}catch{throw new HttpError(401,'Invalid wallet authorization.');}
 if(key.length!==32||sig.length!==64)throw new HttpError(401,'Invalid wallet authorization.');
 const publicKey=await crypto.subtle.importKey('raw',key,{name:'Ed25519'},false,['verify']);
 const ok=await crypto.subtle.verify('Ed25519',publicKey,sig,new TextEncoder().encode(uploadAuthMessage({wallet,imageSha256,issuedAt:String(issuedAt)})));
 if(!ok)throw new HttpError(401,'Wallet signature does not match this upload.');
 const id=String(signature);
 for(const [k,expires] of seen)if(expires<=now())seen.delete(k);
 if(seen.has(id))throw new HttpError(401,'This authorization was already used.');
 seen.set(id,now()+AUTH_WINDOW_MS*2);
 return wallet;
}

/** Sliding-window limiter. In-memory, so it is per server instance: a best-effort guard, not a quota. */
export function createRateLimiter({limit,windowMs,now=Date.now}){
 const hits=new Map();
 return key=>{
  const t=now(),recent=(hits.get(key)??[]).filter(x=>t-x<windowMs);
  if(recent.length>=limit){hits.set(key,recent);return false;}
  recent.push(t);hits.set(key,recent);return true;
 };
}

async function readBounded(request,max){
 if(Number(request.headers.get('content-length')??0)>max)throw new HttpError(413,'Upload is too large.');
 if(!request.body)throw new HttpError(400,'Upload body is required.');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'Upload is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return bytes;
}

const CID=/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120})$/;
const withTimeout=async(fetcher,url,init={},ms=15000)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetcher(url,{...init,signal:c.signal});}finally{clearTimeout(t);}};

/** IPFS pinning through Pinata. The JWT stays server-side; the gateway must be HTTPS. */
export function pinataProvider({jwt,gateway='https://gateway.pinata.cloud',fetcher=fetch}={}){
 if(!jwt)throw new HttpError(503,'Upload provider is not configured.');
 const base=new URL(gateway);if(base.protocol!=='https:'||base.username||base.password)throw Error('Gateway must be a plain HTTPS URL.');
 const auth={authorization:`Bearer ${jwt}`};
 const uriFor=cid=>{if(!CID.test(cid))throw new HttpError(502,'Storage provider returned an invalid content id.');return `${base.origin}/ipfs/${cid}`;};
 return {
  name:'pinata',
  async pinFile({bytes,mime,filename}){
   const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),filename);form.append('pinataMetadata',JSON.stringify({name:filename}));
   const r=await withTimeout(fetcher,'https://api.pinata.cloud/pinning/pinFileToIPFS',{method:'POST',headers:auth,body:form});
   if(!r.ok)throw new HttpError(502,'Storage provider rejected the image.');
   const cid=(await r.json())?.IpfsHash;return {cid,uri:uriFor(cid)};
  },
  async pinJson({document,name}){
   const r=await withTimeout(fetcher,'https://api.pinata.cloud/pinning/pinJSONToIPFS',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({pinataContent:document,pinataMetadata:{name}})});
   if(!r.ok)throw new HttpError(502,'Storage provider rejected the metadata.');
   const cid=(await r.json())?.IpfsHash;return {cid,uri:uriFor(cid)};
  }
 };
}

async function retry(task,{attempts=3,delayMs=1500,wait=sleep}={}){
 let last;for(let i=0;i<attempts;i++){try{return await task();}catch(e){last=e;if(i<attempts-1)await wait(delayMs*(i+1));}}throw last;
}

/** Re-reads both objects from the public gateway and requires exact content. */
export async function verifyPinned({metadataUri,imageUri,imageBytes,expected,fetcher=fetch,retries}){
 try{
  await retry(async()=>{
   const meta=await verifyMetadataDocument(metadataUri,{fetcher});
   if(meta.image!==imageUri)throw Error('image uri mismatch');
   const raw=await (await fetcher(metadataUri,{method:'GET',redirect:'error',headers:{accept:'application/json'}})).text();
   const doc=JSON.parse(raw);
   const keys=Object.keys(expected).sort();
   if(JSON.stringify(Object.keys(doc).sort())!==JSON.stringify(keys)||keys.some(k=>doc[k]!==expected[k]))throw Error('metadata mismatch');
   const image=await fetcher(imageUri,{method:'GET',redirect:'error'});
   if(!image.ok)throw Error('image unavailable');
   const bytes=new Uint8Array(await image.arrayBuffer());
   if(bytes.length!==imageBytes.length||await sha256Hex(bytes)!==await sha256Hex(imageBytes))throw Error('image mismatch');
  },retries);
 }catch{throw new HttpError(502,'Stored content could not be verified. Nothing was published.');}
}

function clientKey(request){return request.headers.get('x-nf-client-connection-ip')??request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';}

/**
 * @param request   Web Request (multipart/form-data: name, symbol, description, website, twitter,
 *                  telegram, image, wallet, issuedAt, signature)
 * @param deps      {provider, fetcher, now, seen, ipLimiter, walletLimiter, retries}
 */
export async function handleUpload(request,{provider,fetcher=fetch,now=Date.now,seen,ipLimiter,walletLimiter,retries}={}){
 try{
  if(request.method!=='POST')return json({error:'Use POST.'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin requests are not allowed.'},403);
  if(!/^multipart\/form-data;/i.test(request.headers.get('content-type')??''))throw new HttpError(415,'Send multipart/form-data.');
  if(ipLimiter&&!ipLimiter(clientKey(request)))throw new HttpError(429,'Too many uploads. Try again later.');
  if(!provider)throw new HttpError(503,'Upload provider is not configured.');
  const body=await readBounded(request,MAX_BODY_BYTES);
  let form;try{form=await new Response(body,{headers:{'content-type':request.headers.get('content-type')}}).formData();}catch{throw new HttpError(400,'Malformed upload.');}
  const file=form.get('image');
  if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function')throw new HttpError(400,'An image file is required.');
  const imageBytes=new Uint8Array(await file.arrayBuffer());
  if(imageBytes.length===0)throw new HttpError(400,'An image file is required.');
  if(imageBytes.length>MAX_IMAGE_BYTES)throw new HttpError(413,'Image must be 5 MB or smaller.');
  const mime=sniffImage(imageBytes);
  if(!mime)throw new HttpError(415,'Image must be PNG, JPEG or WebP.');
  if(file.type&&file.type!==mime)throw new HttpError(415,'Image content does not match its declared type.');
  const fields={};for(const f of FIELDS){const v=form.get(f);if(v!==null&&typeof v!=='string')throw new HttpError(400,'Invalid form field.');fields[f]=v??'';}
  const checked=validateLaunch({...fields,image:{type:mime,size:imageBytes.length}});
  if(!checked.valid)return json({error:'Token details are invalid.',errors:checked.errors},400);
  const imageSha256=await sha256Hex(imageBytes);
  const wallet=await verifyUploadAuth({wallet:form.get('wallet'),imageSha256,issuedAt:form.get('issuedAt'),signature:form.get('signature')},{now,seen});
  if(walletLimiter&&!walletLimiter(wallet))throw new HttpError(429,'Too many uploads for this wallet. Try again later.');

  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime];
  const image=await provider.pinFile({bytes:imageBytes,mime,filename:`${imageSha256.slice(0,16)}.${ext}`});
  const document=createTokenMetadata(fields,image.uri);
  const meta=await provider.pinJson({document,name:`${checked.metadata.symbol}-metadata`});
  await verifyPinned({metadataUri:meta.uri,imageUri:image.uri,imageBytes,expected:document,fetcher,retries});
  return json({verified:true,provider:provider.name,metadataUri:meta.uri,imageUri:image.uri,metadataCid:meta.cid,imageCid:image.cid,metadata:document});
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  return json({error:'Upload failed.'},500);
 }
}
