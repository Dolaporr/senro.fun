// MOCKED storage: the provider and the public gateway are in-memory fakes. These tests prove the
// service's validation, authorization, verification and failure handling. They do not prove that a
// real IPFS provider accepts or serves content; that needs credentials and is tracked as blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {
 handleUpload,pinataProvider,sniffImage,uploadAuthMessage,createRateLimiter,verifyUploadAuth,MAX_BODY_BYTES
} from '../worker/launchpad-upload.mjs';
import {MAX_IMAGE_BYTES} from '../src/launchpad-model.mjs';

const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,...Array(64).fill(1)]);
const JPEG=Uint8Array.from([0xff,0xd8,0xff,0xe0,...Array(64).fill(2)]);
const WEBP=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50,...Array(32).fill(3)]);
const URL_='https://nush.test/api/launchpad/upload';
const NOW=1_800_000_000_000;
const retries={attempts:2,delayMs:0,wait:async()=>{}};
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const privateKeyOf=kp=>crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(kp.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
const sign=(kp,message)=>Buffer.from(crypto.sign(null,Buffer.from(message),privateKeyOf(kp))).toString('base64');

function fakeStorage({tamperMeta,tamperImage,badCid,failImage,failJson,gatewayDown}={}){
 const store=new Map();let n=0;const calls={pinFile:0,pinJson:0};
 const cid=()=>badCid?'not-a-cid':'Qm'+String(++n).padStart(44,'1');
 const provider={name:'fake',
  async pinFile({bytes}){calls.pinFile++;if(failImage)throw Object.assign(Error('x'),{status:502});const c=cid();store.set(c,{bytes:Uint8Array.from(bytes),type:'image'});return {cid:c,uri:`https://gateway.test/ipfs/${c}`};},
  async pinJson({document}){calls.pinJson++;if(failJson)throw Object.assign(Error('x'),{status:502});const c=cid();store.set(c,{text:JSON.stringify(tamperMeta?{...document,name:'Evil'}:document),type:'json'});return {cid:c,uri:`https://gateway.test/ipfs/${c}`};}
 };
 const fetcher=async url=>{
  if(gatewayDown)throw Error('gateway down');
  const entry=store.get(String(url).split('/ipfs/')[1]);
  if(!entry)return new Response('missing',{status:404});
  return entry.type==='json'?new Response(entry.text,{headers:{'content-type':'application/json'}}):new Response(tamperImage?Uint8Array.from([...entry.bytes].reverse()):entry.bytes);
 };
 return {provider,fetcher,store,calls};
}

async function upload({image=PNG,declared,fields={},auth={},kp=Keypair.generate(),storage=fakeStorage(),deps={},headers={},method='POST',omit=[]}={}){
 const imageSha256=await sha(image);
 const issuedAt=String(auth.issuedAt??NOW);
 const wallet=auth.wallet??kp.publicKey.toBase58();
 const signer=auth.signer??kp;
 const form=new FormData();
 const base={name:'Orbit',symbol:'ORB',description:'A token',wallet,issuedAt,...fields};
 for(const [k,v] of Object.entries(base))if(!omit.includes(k))form.append(k,v);
 if(!omit.includes('signature'))form.append('signature',auth.signature??sign(signer,uploadAuthMessage({wallet,imageSha256:auth.imageSha256??imageSha256,issuedAt})));
 if(!omit.includes('image'))form.append('image',new Blob([image],{type:declared??sniffMime(image)}),'art');
 const request=new Request(URL_,{method,headers,body:method==='POST'?form:undefined});
 const response=await handleUpload(request,{provider:storage.provider,fetcher:storage.fetcher,now:()=>NOW,seen:new Map(),retries,...deps});
 return {response,body:await response.json(),storage,kp};
}
const sniffMime=b=>sniffImage(b)??'application/octet-stream';

test('sniffImage trusts bytes, not names: PNG, JPEG, WebP only',()=>{
 assert.equal(sniffImage(PNG),'image/png');assert.equal(sniffImage(JPEG),'image/jpeg');assert.equal(sniffImage(WEBP),'image/webp');
 for(const bad of [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),new TextEncoder().encode('<html></html>'),new TextEncoder().encode('GIF89a'),new Uint8Array(0),Uint8Array.from([0xff,0xd8])])assert.equal(sniffImage(bad),null);
});

test('upload pins image then metadata, re-reads both from the gateway and returns verified URIs',async()=>{
 const {response,body,storage}=await upload();
 assert.equal(response.status,200);assert.equal(body.verified,true);assert.equal(body.provider,'fake');
 assert.match(body.metadataUri,/^https:\/\/gateway\.test\/ipfs\/Qm/);assert.match(body.imageUri,/^https:\/\/gateway\.test\/ipfs\/Qm/);
 assert.equal(storage.calls.pinFile,1);assert.equal(storage.calls.pinJson,1);
 const stored=JSON.parse(storage.store.get(body.metadataCid).text);
 assert.equal(stored.name,'Orbit');assert.equal(stored.symbol,'ORB');assert.equal(stored.image,body.imageUri);assert.equal(stored.description,'A token');
 assert.deepEqual(body.metadata,stored);
});

test('upload carries optional links and accepts JPEG and WebP',async()=>{
 const {body}=await upload({image:JPEG,fields:{website:'https://orbit.example',twitter:'https://x.com/orbit'}});
 assert.equal(body.metadata.website,'https://orbit.example');assert.equal(body.metadata.twitter,'https://x.com/orbit');
 assert.equal((await upload({image:WEBP})).response.status,200);
});

test('request shape: method, origin, content type, body and image are enforced before any storage call',async()=>{
 const storage=fakeStorage();
 assert.equal((await upload({method:'GET',storage})).response.status,405);
 assert.equal((await upload({storage,headers:{origin:'https://foreign.test'}})).response.status,403);
 const textual=await handleUpload(new Request(URL_,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{provider:storage.provider,fetcher:storage.fetcher});
 assert.equal(textual.status,415);
 assert.equal((await upload({storage,omit:['image']})).response.status,400);
 assert.equal((await upload({storage,image:new Uint8Array(0)})).response.status,400);
 assert.equal(storage.calls.pinFile,0);assert.equal(storage.calls.pinJson,0);
});

test('image content: spoofed types, SVG, HTML and oversize images are rejected before storage',async()=>{
 const storage=fakeStorage();
 const svg=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
 assert.equal((await upload({storage,image:svg,declared:'image/png'})).response.status,415);
 assert.equal((await upload({storage,image:new TextEncoder().encode('<html>x</html>'),declared:'image/png'})).response.status,415);
 assert.equal((await upload({storage,image:JPEG,declared:'image/png'})).response.status,415,'declared PNG, bytes are JPEG');
 const big=new Uint8Array(MAX_IMAGE_BYTES+1);big.set(PNG);
 const {response}=await upload({storage,image:big});
 assert.equal(response.status,413);
 assert.equal(storage.calls.pinFile,0);
});

test('streamed bodies are cut off at the cap without reading the rest',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
 const storage=fakeStorage();
 const response=await handleUpload(new Request(URL_,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x'},body,duplex:'half'}),{provider:storage.provider,fetcher:storage.fetcher});
 assert.equal(response.status,413);assert.equal(cancelled,true);
 const declared=await handleUpload(new Request(URL_,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x','content-length':String(MAX_BODY_BYTES+1)},body:'x'}),{provider:storage.provider,fetcher:storage.fetcher});
 assert.equal(declared.status,413);
});

test('field validation returns per-field errors and stores nothing',async()=>{
 const storage=fakeStorage();
 const {response,body}=await upload({storage,fields:{symbol:'!!',name:'x',website:'http://insecure.example'}});
 assert.equal(response.status,400);assert.ok(body.errors.symbol&&body.errors.name&&body.errors.website);
 assert.equal(storage.calls.pinFile,0);
});

test('wallet authorization: missing, foreign, wrong-image, expired and replayed signatures are rejected',async()=>{
 const storage=fakeStorage();
 assert.equal((await upload({storage,omit:['signature']})).response.status,401);
 assert.equal((await upload({storage,auth:{signer:Keypair.generate()}})).response.status,401,'signed by a different key');
 assert.equal((await upload({storage,auth:{imageSha256:'0'.repeat(64)}})).response.status,401,'signed for a different image');
 assert.equal((await upload({storage,auth:{issuedAt:NOW-6*60_000}})).response.status,401,'expired');
 assert.equal((await upload({storage,auth:{issuedAt:NOW+6*60_000}})).response.status,401,'future-dated');
 assert.equal((await upload({storage,omit:['wallet']})).response.status,401);
 assert.equal(storage.calls.pinFile,0);
 const kp=Keypair.generate(),seen=new Map(),imageSha256=await sha(PNG);
 const args={wallet:kp.publicKey.toBase58(),imageSha256,issuedAt:String(NOW),signature:sign(kp,uploadAuthMessage({wallet:kp.publicKey.toBase58(),imageSha256,issuedAt:String(NOW)}))};
 assert.equal(await verifyUploadAuth(args,{now:()=>NOW,seen}),args.wallet);
 await assert.rejects(verifyUploadAuth(args,{now:()=>NOW,seen}),/already used/);
});

test('rate limits apply per client and per wallet',async()=>{
 const storage=fakeStorage();
 const ip=createRateLimiter({limit:1,windowMs:1000,now:()=>NOW});
 const first=await upload({storage,deps:{ipLimiter:ip}});assert.equal(first.response.status,200);
 assert.equal((await upload({storage,deps:{ipLimiter:ip}})).response.status,429);
 const wallet=createRateLimiter({limit:1,windowMs:1000,now:()=>NOW}),kp=Keypair.generate();
 assert.equal((await upload({kp,storage:fakeStorage(),deps:{walletLimiter:wallet}})).response.status,200);
 assert.equal((await upload({kp,storage:fakeStorage(),deps:{walletLimiter:wallet}})).response.status,429);
 let t=NOW;const limiter=createRateLimiter({limit:1,windowMs:1000,now:()=>t});
 assert.equal(limiter('a'),true);assert.equal(limiter('a'),false);t+=1001;assert.equal(limiter('a'),true,'window slides');
});

test('provider failure modes: not configured, image rejected, metadata rejected, bogus content ids',async()=>{
 assert.equal((await upload({deps:{provider:null},storage:{provider:null,fetcher:fakeStorage().fetcher}})).response.status,503);
 const noImage=fakeStorage({failImage:true});
 assert.equal((await upload({storage:noImage})).response.status,500,'generic failure for unexpected provider errors');
 const noJson=fakeStorage({failJson:true});const r=await upload({storage:noJson});assert.equal(r.response.status,500);assert.equal(r.body.error,'Upload failed.');
 const bad=await upload({storage:fakeStorage({badCid:true})});assert.equal(bad.response.status,502,'colliding or bogus content ids fail verification');
});

test('verification failures: gateway returns other metadata, other image bytes, or is down; nothing is returned as usable',async()=>{
 for(const [options,label] of [[{tamperMeta:true},'metadata mismatch'],[{tamperImage:true},'image mismatch'],[{gatewayDown:true},'gateway down']]){
  const {response,body}=await upload({storage:fakeStorage(options)});
  assert.equal(response.status,502,label);assert.match(body.error,/could not be verified/);assert.equal(body.metadataUri,undefined,label);
 }
});

test('verification retries so gateway propagation delay does not fail a good upload',async()=>{
 const storage=fakeStorage();let misses=1;
 const realFetch=storage.fetcher;
 storage.fetcher=async(url,init)=>{if(String(url).includes('/ipfs/Qm')&&misses-->0)return new Response('not yet',{status:404});return realFetch(url,init);};
 const {response}=await upload({storage});
 assert.equal(response.status,200);
});

test('Pinata adapter: bearer auth server-side, HTTPS gateway, CID validation, provider errors are generic',async()=>{
 assert.throws(()=>pinataProvider({}),e=>e.status===503);
 assert.throws(()=>pinataProvider({jwt:'j',gateway:'http://insecure.example'}),/HTTPS/);
 const requests=[];
 const CIDV0='Qm'+'1'.repeat(44);
 const fetcher=async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({IpfsHash:CIDV0}),{status:200});};
 const p=pinataProvider({jwt:'SECRET',gateway:'https://gw.example',fetcher});
 const file=await p.pinFile({bytes:PNG,mime:'image/png',filename:'a.png'});
 const meta=await p.pinJson({document:{name:'x'},name:'x-metadata'});
 assert.equal(file.uri,`https://gw.example/ipfs/${CIDV0}`);assert.equal(meta.cid,CIDV0);
 assert.equal(requests[0].url,'https://api.pinata.cloud/pinning/pinFileToIPFS');assert.equal(requests[1].url,'https://api.pinata.cloud/pinning/pinJSONToIPFS');
 for(const r of requests)assert.equal(r.init.headers.authorization,'Bearer SECRET');
 assert.deepEqual(JSON.parse(requests[1].init.body).pinataContent,{name:'x'});
 const failing=pinataProvider({jwt:'SECRET',fetcher:async()=>new Response('{"error":"quota SECRET"}',{status:402})});
 await assert.rejects(failing.pinFile({bytes:PNG,mime:'image/png',filename:'a.png'}),e=>e.status===502&&!/SECRET|quota/.test(e.message));
 const badCid=pinataProvider({jwt:'j',fetcher:async()=>new Response(JSON.stringify({IpfsHash:'../../etc'}),{status:200})});
 await assert.rejects(badCid.pinJson({document:{},name:'n'}),e=>e.status===502);
});

test('secrets never appear in responses',async()=>{
 const {body}=await upload({storage:fakeStorage({tamperMeta:true})});
 assert.ok(!JSON.stringify(body).includes('SECRET'));
});
