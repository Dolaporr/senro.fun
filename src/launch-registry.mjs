// Registry of launches this browser has confirmed, with chain reconciliation.
//
// Scope, stated plainly: this records launches made through this page and re-reads them from the chain.
// It is NOT a public feed of every Pump launch. A network-wide feed needs an indexer or webhook provider
// (an API key and a verified event schema), which this repo does not have; see docs/LAUNCHPAD_EXECUTION.md.
//
// Rules: one record per mint; the same signature twice is a duplicate; a different signature for a mint
// that is already recorded is a conflict and the first record is kept; order is slot descending with the
// signature as a stable tiebreak; paging uses opaque cursors that are validated before use.
import {PublicKey} from '@solana/web3.js';
import {loadPumpSdk} from './pump-sdk.mjs';

export const REGISTRY_KEY='senro-launches-v1';
export const MAX_RECORDS=200;
export const PAGE_MAX=50;
const BASE58=/^[1-9A-HJ-NP-Za-km-z]+$/;
const TOKEN_PROGRAMS=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const isB58=(v,min,max)=>typeof v==='string'&&v.length>=min&&v.length<=max&&BASE58.test(v);
const isHttps=v=>{try{return new URL(v).protocol==='https:';}catch{return false;}};

/** Validates and freezes one launch record. Throws a plain message on anything unexpected. */
export function normalizeLaunch(input){
 const r=input??{};
 if(!isB58(r.signature,64,88))throw Error('Launch record has an invalid signature.');
 if(!isB58(r.mint,32,44)||!isB58(r.creator,32,44))throw Error('Launch record has an invalid address.');
 if(!Number.isSafeInteger(r.slot)||r.slot<=0)throw Error('Launch record has an invalid slot.');
 if(typeof r.name!=='string'||!r.name||r.name.length>32||typeof r.symbol!=='string'||!r.symbol||r.symbol.length>10)throw Error('Launch record has an invalid name or symbol.');
 if(!isHttps(r.metadataUri))throw Error('Launch record has an invalid metadata link.');
 if(r.imageUri!=null&&!isHttps(r.imageUri))throw Error('Launch record has an invalid image link.');
 return Object.freeze({signature:r.signature,mint:r.mint,creator:r.creator,slot:r.slot,name:r.name,symbol:r.symbol,metadataUri:r.metadataUri,imageUri:r.imageUri??null,state:['recorded','live','graduated','missing','mismatch','unreachable'].includes(r.state)?r.state:'recorded'});
}

const order=(a,b)=>b.slot-a.slot||(a.signature<b.signature?-1:a.signature>b.signature?1:0);
export const encodeCursor=r=>btoa(JSON.stringify({s:r.slot,g:r.signature})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function decodeCursor(text){
 try{
  const raw=JSON.parse(atob(String(text).replace(/-/g,'+').replace(/_/g,'/')));
  if(!Number.isSafeInteger(raw.s)||raw.s<=0||!isB58(raw.g,64,88))throw 0;
  return {slot:raw.s,signature:raw.g};
 }catch{throw Error('That page link is not valid. Start again from the first page.');}
}

export function createRegistry(initial=[]){
 const byMint=new Map();
 const sorted=()=>[...byMint.values()].sort(order);
 const api={
  /** Returns 'added', 'duplicate' or 'conflict'. Throws on a malformed record. */
  ingest(raw){
   const record=normalizeLaunch(raw),existing=byMint.get(record.mint);
   if(existing)return existing.signature===record.signature?'duplicate':'conflict';
   byMint.set(record.mint,record);
   if(byMint.size>MAX_RECORDS)byMint.delete(sorted().at(-1).mint);
   return 'added';
  },
  get:mint=>byMint.get(mint)??null,
  list:()=>sorted(),
  size:()=>byMint.size,
  setState(mint,state){const r=byMint.get(mint);if(r)byMint.set(mint,normalizeLaunch({...r,state}));},
  page({cursor=null,limit=20}={}){
   const size=Math.min(PAGE_MAX,Math.max(1,Math.trunc(Number(limit))||20)),all=sorted();
   let start=0;
   if(cursor){const c=decodeCursor(cursor);start=all.findIndex(r=>order(r,c)>0);if(start<0)start=all.length;}
   const items=all.slice(start,start+size),more=start+size<all.length;
   return {items,nextCursor:more?encodeCursor(items.at(-1)):null,total:all.length};
  }
 };
 for(const record of initial){try{api.ingest(record);}catch{/* a bad stored record is dropped, never fatal */}}
 return api;
}

/** Loads the registry from a Storage-like object. Corrupt or foreign data yields an empty or partial registry. */
export function loadRegistry(storage=globalThis.localStorage,key=REGISTRY_KEY){
 try{const data=JSON.parse(storage.getItem(key));return createRegistry(Array.isArray(data?.records)?data.records:[]);}catch{return createRegistry();}
}
export function saveRegistry(registry,storage=globalThis.localStorage,key=REGISTRY_KEY){
 try{storage.setItem(key,JSON.stringify({version:1,records:registry.list()}));return true;}catch{return false;}
}

/** Pure: turns the two on-chain accounts into a state. A graduated curve is a normal state, not an error. */
export function classifyLaunch(record,{mintAccount,curveAccount},{PUMP_SDK,PUMP_PROGRAM_ID}){
 if(!mintAccount)return {state:'missing',reason:'The mint account was not found on this RPC. It may still be settling.'};
 if(!TOKEN_PROGRAMS.includes(mintAccount.owner.toBase58()))return {state:'mismatch',reason:'The mint is not owned by an SPL token program.'};
 if(!curveAccount||!curveAccount.owner.equals(PUMP_PROGRAM_ID))return {state:'mismatch',reason:'No Pump bonding curve exists for this mint.'};
 let curve;try{curve=PUMP_SDK.decodeBondingCurve(curveAccount);}catch{return {state:'mismatch',reason:'The bonding curve could not be decoded.'};}
 if(curve.creator.toBase58()!==record.creator)return {state:'mismatch',reason:'The bonding curve creator is not the recorded wallet.'};
 return curve.complete?{state:'graduated',reason:'The curve is complete.'}:{state:'live',reason:'The mint and its curve match the record.'};
}

/**
 * Re-reads records from the chain, four launches (eight accounts) per RPC call. One RPC failure marks only
 * that batch 'unreachable'. Results are written to the registry and returned as {mint: {state, reason}}.
 */
export async function reconcileLaunches({connection,registry,mints=null,commitment='confirmed'}){
 const {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda}=await loadPumpSdk();
 const records=(mints?mints.map(m=>registry.get(m)):registry.list()).filter(Boolean),results={};
 for(let i=0;i<records.length;i+=4){
  const batch=records.slice(i,i+4);
  const keys=batch.flatMap(r=>{const mint=new PublicKey(r.mint);return [mint,bondingCurvePda(mint)];});
  let accounts;
  try{accounts=await connection.getMultipleAccountsInfo(keys,commitment);}
  catch{for(const r of batch)results[r.mint]={state:'unreachable',reason:'The network could not be reached. Try again.'};continue;}
  batch.forEach((r,n)=>{results[r.mint]=classifyLaunch(r,{mintAccount:accounts[n*2],curveAccount:accounts[n*2+1]},{PUMP_SDK,PUMP_PROGRAM_ID});});
 }
 for(const [mint,{state}] of Object.entries(results))registry.setState(mint,state);
 return results;
}

/** Link to the existing studio with the mint prefilled. It only fills the field; nothing is loaded or signed. */
export const studioLink=mint=>`/?mint=${encodeURIComponent(mint)}#studio`;
