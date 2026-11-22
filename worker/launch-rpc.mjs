// Launch-scoped RPC relay (mainnet). Separate from the read-only /api/solana relay, which stays
// untouched and still refuses every broadcast.
//
// This relay forwards a tiny method set, and it will simulate or send ONLY a transaction shaped like
// a Pump create_v2 launch: v0, two signers, no lookup tables, optional ComputeBudget limit/price,
// and exactly one Pump-program instruction carrying the create_v2 discriminator. Sends additionally
// require both signatures to verify. It cannot be used to send an arbitrary transaction.
// No npm packages here: Netlify's function bundle cannot load web3.js's dependencies (see
// tests/netlify-function-deps.test.mjs). Transactions are read with the small parser in tx-wire.mjs.
import {parseTransaction} from './tx-wire.mjs';
import {base58Encode} from '../src/nush-config.mjs';

export const PUMP_PROGRAM_ID='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const COMPUTE_BUDGET_ID='ComputeBudget111111111111111111111111111111';
export const CREATE_V2_DISCRIMINATOR=[214,144,76,236,95,139,49,180];
export const PUBLIC_UPSTREAMS=['https://solana-rpc.publicnode.com','https://api.mainnet.solana.com'];

/** A private RPC URL (for example one with an API key) goes first; public endpoints stay as fallback. Server-side only. */
export function launchUpstreams(privateUrl){
 if(!privateUrl)return PUBLIC_UPSTREAMS;
 let u;try{u=new URL(privateUrl);}catch{throw Error('LAUNCH_RPC_URL is not a valid URL.');}
 if(u.protocol!=='https:')throw Error('LAUNCH_RPC_URL must use HTTPS.');
 return [u.href,...PUBLIC_UPSTREAMS];
}

// Per-client budgets. Best effort: counters live in one function instance, so a busy deployment with many
// instances allows more in total. They still stop a single client from hammering the relay or the RPC key.
export const LIMITS=Object.freeze({read:{limit:120,windowMs:60_000},simulate:{limit:20,windowMs:60_000},send:{limit:5,windowMs:600_000}});
export function rateLimiter({limit,windowMs,now=Date.now,maxKeys=10_000}){
 const hits=new Map();
 return key=>{
  const t=now(),recent=(hits.get(key)??[]).filter(x=>t-x<windowMs);
  if(recent.length>=limit){hits.set(key,recent);return false;}
  recent.push(t);hits.delete(key);hits.set(key,recent);
  if(hits.size>maxKeys)hits.delete(hits.keys().next().value);
  return true;
 };
}
export const createLaunchLimiters=(now=Date.now)=>({read:rateLimiter({...LIMITS.read,now}),simulate:rateLimiter({...LIMITS.simulate,now}),send:rateLimiter({...LIMITS.send,now})});
export const methodClass=method=>method==='sendTransaction'?'send':method==='simulateTransaction'?'simulate':'read';
// Only addresses set by the platform are trusted. x-forwarded-for is caller-controlled and is ignored, so a
// client cannot rotate it to escape the limit. Without a platform address every caller shares one bucket.
export function clientKey(request,platformIp){
 const ip=platformIp||request.headers.get('x-nf-client-connection-ip')||'shared';
 return String(ip).slice(0,64);
}
const READ_METHODS=new Set(['getGenesisHash','getBalance','getFeeForMessage','isBlockhashValid','getLatestBlockhash','getBlockHeight','getMultipleAccounts','getSignatureStatuses','getSlot']);
const MAX_BODY=4096;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});

export const PUMP_FEE_PROGRAM_ID='pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
export const SYSTEM_PROGRAM_ID='11111111111111111111111111111111';
export const CREATE_FEE_SHARING_DISCRIMINATOR=[195,78,86,76,111,52,251,213];
export const UPDATE_FEE_SHARES_DISCRIMINATOR=[189,13,136,99,187,164,237,35];
const startsWith=(data,prefix)=>prefix.every((v,i)=>data[i]===v);
const u16=(d,o)=>d[o]|d[o+1]<<8,u32=(d,o)=>(d[o]|d[o+1]<<8|d[o+2]<<16)+d[o+3]*2**24;
const u64=(d,o)=>Number(d.slice(o,o+8).reduceRight((n,b)=>n*256n+BigInt(b),0n));
const keyAt=(d,o)=>base58Encode(d.slice(o,o+32));

/**
 * Throws unless `base64` is a Nush launch. Without economics: compute budget + exactly one Pump create_v2,
 * no lookup tables. With economics (the treasury and lookup table configured on the server): the same,
 * followed by exactly the Pump fee-sharing config, a 75/25 split between the fee payer and the treasury,
 * and a transfer of exactly the launch fee from the fee payer to the treasury, through the Nush table only.
 */
export function inspectLaunchWire(base64,economics=null){
 if(typeof base64!=='string'||base64.length>1700)throw Error('Invalid transaction size.');
 let bytes;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}catch{throw Error('Invalid base64 transaction.');}
 if(bytes.length>1232||bytes.length<130)throw Error('Invalid transaction size.');
 let tx;try{tx=parseTransaction(bytes);}catch{throw Error('Invalid transaction.');}
 const m=tx,keys=m.staticAccountKeys;
 if(tx.version!==0)throw Error('Only v0 transactions are allowed.');
 if(economics){
  if(m.addressTableLookups.length!==1||m.addressTableLookups[0].accountKey!==economics.lookupTable)throw Error('A Nush launch uses only the Nush lookup table.');
 }else if(m.addressTableLookups.length)throw Error('Only v0 transactions without lookup tables are allowed.');
 if(m.header.numRequiredSignatures!==2||tx.signatures.length!==2)throw Error('A launch has exactly two signers.');
 const program=ix=>{if(ix.programIdIndex>=keys.length)throw Error('Program ids must be listed directly.');return keys[ix.programIdIndex];};
 const ixs=m.compiledInstructions;let i=0;
 while(i<ixs.length&&program(ixs[i])===COMPUTE_BUDGET_ID){if(![2,3].includes(ixs[i].data[0]))throw Error('Only compute limit and price instructions are allowed.');i++;}
 if(i>2)throw Error('At most two compute budget instructions are allowed.');
 const rest=ixs.slice(i);
 const create=rest[0];
 if(!create)throw Error('A launch has exactly one Pump create instruction.');
 if(program(create)!==PUMP_PROGRAM_ID)throw Error('Only the Pump program is allowed.');
 if(!startsWith(create.data,CREATE_V2_DISCRIMINATOR))throw Error('Only the Pump create_v2 instruction is allowed.');
 if(!economics){
  if(rest.length!==1){
   const other=rest.slice(1).map(program);
   if(other.some(p=>p!==PUMP_PROGRAM_ID&&p!==COMPUTE_BUDGET_ID))throw Error('Only the Pump program is allowed.');
   if(other.includes(COMPUTE_BUDGET_ID))throw Error('Compute budget instructions must come first.');
   throw Error('A launch has exactly one Pump create instruction.');
  }
  return tx;
 }
 if(rest.length!==4)throw Error('A Nush launch is the create, the fee split and the launch fee, nothing else.');
 const [config,update,transfer]=rest.slice(1);
 if(program(config)!==PUMP_FEE_PROGRAM_ID||!startsWith(config.data,CREATE_FEE_SHARING_DISCRIMINATOR))throw Error('The Pump fee-sharing config must follow the create.');
 if(program(update)!==PUMP_FEE_PROGRAM_ID||!startsWith(update.data,UPDATE_FEE_SHARES_DISCRIMINATOR))throw Error('The Pump fee split must follow the config.');
 const d=update.data,creator=keys[0];
 if(d.length!==12+34*2||u32(d,8)!==2)throw Error('The fee split must have exactly two shareholders.');
 const shares=[[keyAt(d,12),u16(d,44)],[keyAt(d,46),u16(d,78)]];
 if(shares[0][0]!==creator||shares[0][1]!==10_000-economics.treasuryShareBps||shares[1][0]!==economics.treasury||shares[1][1]!==economics.treasuryShareBps)throw Error('The fee split must be the creator and the Nush treasury at the agreed shares.');
 if(program(transfer)!==SYSTEM_PROGRAM_ID||transfer.data.length!==12||u32(transfer.data,0)!==2)throw Error('The launch fee must be a plain SOL transfer.');
 const [from,to]=transfer.accountKeyIndexes;
 if(transfer.accountKeyIndexes.length!==2||from!==0||to>=keys.length||keys[to]!==economics.treasury)throw Error('The launch fee must go from the creator to the Nush treasury.');
 if(u64(transfer.data,4)!==economics.launchFeeLamports)throw Error('The launch fee amount is wrong.');
 return tx;
}

async function signaturesValid(tx){
 const message=tx.messageBytes;
 for(let i=0;i<2;i++){
  const sig=tx.signatures[i];if(sig.length!==64||sig.every(b=>b===0))return false;
  const key=await crypto.subtle.importKey('raw',tx.keyBytes[i],{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,sig,message))return false;
 }
 return true;
}

/** Validates one JSON-RPC request; returns it, or throws a user-facing message. */
export async function validateLaunchRpc(body,{economics=null}={}){
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
  inspectLaunchWire(params[0],economics);return body;
 }
 if(body.method==='sendTransaction'){
  const o=params[1];
  if(o?.encoding!=='base64'||o.skipPreflight===true||(o.maxRetries!==undefined&&o.maxRetries!==0))throw Error('Sends require preflight and no relay retries.');
  const tx=inspectLaunchWire(params[0],economics);
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

export async function handleLaunchRpc(request,fetcher=fetch,{limiters=null,upstreams=PUBLIC_UPSTREAMS,ip=null,economics=null}={}){
 if(request.method!=='POST')return json({error:'Use POST.'},405);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin requests are not allowed.'},403);
 if(Number(request.headers.get('content-length'))>MAX_BODY*2)return json({error:'Request too large.'},413);
 let body;
 try{const text=await readBounded(request);body=await validateLaunchRpc(JSON.parse(text),{economics});}
 catch(e){return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:e.message}},e.message==='Request too large.'?413:400);}
 if(limiters&&!limiters[methodClass(body.method)](clientKey(request,ip)))return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32005,message:body.method==='sendTransaction'?'Too many launches from this connection. Wait a few minutes.':'Too many requests. Wait a moment and try again.'}},429);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  let status=502;
  for(const url of upstreams){
   try{
    const upstream=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    if(!upstream.ok){status=status===429?429:upstream.status;continue;}
    const value=await upstream.json();
    if(value?.error&&[-32005,429].includes(value.error.code)){status=429;continue;}
    return json(value);
   }catch{if(controller.signal.aborted)break;}
  }
  return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32000,message:status===429?'RPC rate limit reached. Try again shortly.':'The mainnet RPC is unavailable. Try again shortly.'}},status===429?429:502);
 }finally{clearTimeout(timer);}
}
