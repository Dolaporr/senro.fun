// Launch-scoped RPC relay (mainnet). Separate from the read-only /api/solana relay, which stays
// untouched and still refuses every broadcast.
//
// This relay forwards a tiny method set, and it will simulate or send ONLY a transaction shaped like
// a Pump create_v2 launch: v0, two signers, no lookup tables, optional ComputeBudget limit/price,
// and exactly one Pump-program instruction carrying the create_v2 discriminator. Sends additionally
// require both signatures to verify. It cannot be used to send an arbitrary transaction.
import {VersionedTransaction} from '@solana/web3.js';

export const PUMP_PROGRAM_ID='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const COMPUTE_BUDGET_ID='ComputeBudget111111111111111111111111111111';
export const CREATE_V2_DISCRIMINATOR=[214,144,76,236,95,139,49,180];
const UPSTREAMS=['https://solana-rpc.publicnode.com','https://api.mainnet.solana.com'];
const READ_METHODS=new Set(['getGenesisHash','getBalance','getFeeForMessage','isBlockhashValid','getLatestBlockhash','getBlockHeight','getMultipleAccounts','getSignatureStatuses']);
const MAX_BODY=4096;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});

/** Throws unless `base64` is a Pump create_v2 launch transaction; returns the decoded transaction. */
export function inspectLaunchWire(base64){
 if(typeof base64!=='string'||base64.length>1700)throw Error('Invalid transaction size.');
 let bytes;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}catch{throw Error('Invalid base64 transaction.');}
 if(bytes.length>1232||bytes.length<130)throw Error('Invalid transaction size.');
 let tx;try{tx=VersionedTransaction.deserialize(bytes);}catch{throw Error('Invalid transaction.');}
 const m=tx.message;
 if(tx.version!==0||m.addressTableLookups.length)throw Error('Only v0 transactions without lookup tables are allowed.');
 if(m.header.numRequiredSignatures!==2||tx.signatures.length!==2)throw Error('A launch has exactly two signers.');
 let pump=0;
 for(const ix of m.compiledInstructions){
  const program=m.staticAccountKeys[ix.programIdIndex].toBase58();
  if(program===COMPUTE_BUDGET_ID){if(![2,3].includes(ix.data[0]))throw Error('Only compute limit and price instructions are allowed.');continue;}
  if(program!==PUMP_PROGRAM_ID)throw Error('Only the Pump program is allowed.');
  if(CREATE_V2_DISCRIMINATOR.some((v,i)=>ix.data[i]!==v))throw Error('Only the Pump create_v2 instruction is allowed.');
  pump++;
 }
 if(pump!==1)throw Error('A launch has exactly one Pump create instruction.');
 return tx;
}

async function signaturesValid(tx){
 const message=tx.message.serialize();
 for(let i=0;i<2;i++){
  const sig=tx.signatures[i];if(sig.length!==64||sig.every(b=>b===0))return false;
  const key=await crypto.subtle.importKey('raw',tx.message.staticAccountKeys[i].toBytes(),{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,sig,message))return false;
 }
 return true;
}

/** Validates one JSON-RPC request; returns it, or throws a user-facing message. */
export async function validateLaunchRpc(body){
 if(!body||Array.isArray(body)||body.jsonrpc!=='2.0')throw Error('Invalid JSON-RPC request.');
 const params=body.params??[];if(!Array.isArray(params))throw Error('Invalid RPC parameters.');
 if(READ_METHODS.has(body.method)){
  if(body.method==='getMultipleAccounts'&&(!Array.isArray(params[0])||params[0].length>8))throw Error('Read at most 8 accounts.');
  if(body.method==='getSignatureStatuses'&&(!Array.isArray(params[0])||params[0].length!==1))throw Error('Check one signature at a time.');
  return body;
 }
 if(body.method==='simulateTransaction'){
  const o=params[1];
  if(o?.encoding!=='base64'||o.sigVerify!==false||o.replaceRecentBlockhash!==false)throw Error('Simulate the exact message: unsigned check, original blockhash.');
  if(o.accounts&&(!Array.isArray(o.accounts.addresses)||o.accounts.addresses.length>8))throw Error('Inspect at most eight simulated accounts.');
  inspectLaunchWire(params[0]);return body;
 }
 if(body.method==='sendTransaction'){
  const o=params[1];
  if(o?.encoding!=='base64'||o.skipPreflight===true||(o.maxRetries!==undefined&&o.maxRetries!==0))throw Error('Sends require preflight and no relay retries.');
  const tx=inspectLaunchWire(params[0]);
  if(!await signaturesValid(tx))throw Error('Both launch signatures must be valid.');
  return body;
 }
 throw Error('Method is not allowed.');
}

async function readBounded(request){
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY*2){await reader.cancel();throw Error('Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length;}return new TextDecoder().decode(bytes);
}

export async function handleLaunchRpc(request,fetcher=fetch){
 if(request.method!=='POST')return json({error:'Use POST.'},405);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin requests are not allowed.'},403);
 if(Number(request.headers.get('content-length'))>MAX_BODY*2)return json({error:'Request too large.'},413);
 let body;
 try{const text=await readBounded(request);body=await validateLaunchRpc(JSON.parse(text));}
 catch(e){return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:e.message}},e.message==='Request too large.'?413:400);}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  let status=502;
  for(const url of UPSTREAMS){
   try{
    const upstream=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    if(!upstream.ok){status=status===429?429:upstream.status;continue;}
    const value=await upstream.json();
    if(value?.error&&[-32005,429].includes(value.error.code)){status=429;continue;}
    return json(value);
   }catch{if(controller.signal.aborted)break;}
  }
  return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32000,message:status===429?'RPC rate limit reached. Try again shortly.':'The public mainnet RPCs are unavailable.'}},status===429?429:502);
 }finally{clearTimeout(timer);}
}
