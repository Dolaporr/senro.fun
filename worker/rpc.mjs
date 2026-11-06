// Same-origin relay to one fixed upstream. Signing and broadcast are deliberately absent.
const UPSTREAMS=['https://solana-rpc.publicnode.com','https://api.mainnet.solana.com'];
const METHODS=new Set(['getGenesisHash','getAccountInfo','getMultipleAccounts','getEpochInfo','getLatestBlockhash','getFeeForMessage','getMinimumBalanceForRentExemption','simulateTransaction']);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function validateRpcBody(body){
 if(!body||Array.isArray(body)||body.jsonrpc!=='2.0'||!METHODS.has(body.method))throw Error('Only supported read and unsigned simulation methods are allowed.');
 if(body.params!==undefined&&!Array.isArray(body.params))throw Error('Invalid RPC parameters.');
 const params=body.params??[];
 if(body.method==='getMultipleAccounts'&&(!Array.isArray(params[0])||params[0].length>100))throw Error('Read at most 100 accounts.');
 if(body.method==='simulateTransaction'){
  const options=params[1];if(options?.encoding!=='base64'||options.sigVerify!==false||options.replaceRecentBlockhash!==true)throw Error('Only unsigned simulation with a refreshed blockhash is allowed.');
  if(typeof params[0]!=='string'||params[0].length>1700)throw Error('Invalid transaction size.');
  let bytes;try{bytes=Uint8Array.from(atob(params[0]),c=>c.charCodeAt(0));}catch{throw Error('Invalid base64 transaction.');}
  if(bytes.length>1232||bytes.length<66||bytes[0]!==1||bytes.slice(1,65).some(v=>v!==0))throw Error('Simulation requires exactly one empty signature.');
  if(options.accounts&&(!Array.isArray(options.accounts.addresses)||options.accounts.addresses.length>4))throw Error('Inspect at most four simulated accounts.');
 }
 return body;
}
async function readBoundedBody(request){
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw Error('Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
export async function handleRpc(request,fetcher=fetch){
 if(request.method!=='POST')return json({error:'Use POST.'},405);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin requests are not allowed.'},403);
 if(Number(request.headers.get('content-length'))>16384)return json({error:'Request too large.'},413);
 let body;try{const text=await readBoundedBody(request);if(text.length>16384)return json({error:'Request too large.'},413);body=validateRpcBody(JSON.parse(text));}catch(e){return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:e.message}},e.message==='Request too large.'?413:400);}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{let status=502;for(const upstreamUrl of UPSTREAMS){try{const upstream=await fetcher(upstreamUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});if(!upstream.ok){status=status===429?429:upstream.status;console.warn('Mainnet RPC transport rejected',new URL(upstreamUrl).hostname,body.method,upstream.status);continue;}const value=await upstream.json();if(value?.error&&[-32005,429].includes(value.error.code)){status=429;continue;}return json(value);}catch{if(controller.signal.aborted)break;}}return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32000,message:status===429?'RPC rate limit reached. Try again shortly.':'The public mainnet RPCs are unavailable. Choose a custom mainnet RPC in Connection settings.'}},status===429?429:502);}finally{clearTimeout(timer);}

}
