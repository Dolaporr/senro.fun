// Registry logic is pure and tested directly. Reconciliation uses the REAL Pump SDK to encode curve accounts
// against a MOCKED connection. This proves the classification and batching, not behaviour on a live cluster.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import BN from 'bn.js';
import {Keypair,PublicKey} from '@solana/web3.js';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {base58} from '../src/guarded-trade.mjs';
import {createRegistry,normalizeLaunch,loadRegistry,saveRegistry,encodeCursor,decodeCursor,classifyLaunch,reconcileLaunches,studioLink,MAX_RECORDS,REGISTRY_KEY} from '../src/launch-registry.mjs';

const sdk=await loadPumpSdk();
const TOKEN_2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const sig=()=>base58(crypto.randomBytes(64));
const rec=(over={})=>({signature:sig(),mint:Keypair.generate().publicKey.toBase58(),creator:Keypair.generate().publicKey.toBase58(),slot:1000,name:'Orbit',symbol:'ORB',metadataUri:'https://gateway.test/ipfs/Qm1',imageUri:'https://gateway.test/ipfs/Qm2',...over});
const info=(owner,data=Buffer.alloc(0))=>({lamports:1,owner:new PublicKey(owner),data,executable:false,rentEpoch:0});
async function curveInfo(creator,complete=false){
 const z=new BN(0);
 const data=Buffer.from(await sdk.PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN(1),virtualQuoteReserves:new BN(1),realTokenReserves:new BN(1),realQuoteReserves:z,tokenTotalSupply:new BN(1),complete,creator:new PublicKey(creator),isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:z,canEditCreatorFee:false,isHolderReward:false,creatorFee:z,protocolFees:z,depth:0,initialVirtualQuoteReserves:z,postCompleteBaseOut:z,postCompleteQuoteIn:z}));
 return info(sdk.PUMP_PROGRAM_ID.toBase58(),data);
}

test('normalizeLaunch accepts a good record and rejects malformed ones',()=>{
 const good=normalizeLaunch(rec());assert.equal(good.state,'recorded');assert.ok(Object.isFrozen(good));
 assert.equal(normalizeLaunch(rec({imageUri:null})).imageUri,null);
 for(const bad of [null,{},rec({signature:'short'}),rec({signature:'0'.repeat(88)}),rec({mint:'nope'}),rec({creator:7}),rec({slot:0}),rec({slot:1.5}),rec({slot:'9'}),rec({name:''}),rec({name:'x'.repeat(33)}),rec({symbol:'x'.repeat(11)}),rec({metadataUri:'http://insecure.test/x'}),rec({metadataUri:'javascript:1'}),rec({imageUri:'ftp://x'})])assert.throws(()=>normalizeLaunch(bad),/invalid/,JSON.stringify(bad)?.slice(0,60));
 assert.equal(normalizeLaunch(rec({state:'hacked'})).state,'recorded','unknown states are not trusted');
});

test('one record per mint: duplicates and conflicts are reported and the first record is kept',()=>{
 const r=createRegistry(),a=rec();
 assert.equal(r.ingest(a),'added');assert.equal(r.ingest(a),'duplicate');
 assert.equal(r.ingest({...a,signature:sig(),slot:5}),'conflict');
 assert.equal(r.size(),1);assert.equal(r.get(a.mint).signature,a.signature);assert.equal(r.get(a.mint).slot,1000);
 assert.throws(()=>r.ingest({}),/invalid/);assert.equal(r.size(),1);
});

test('order is slot descending with a stable signature tiebreak',()=>{
 const r=createRegistry();const same=[rec({slot:50}),rec({slot:50}),rec({slot:50})];
 [rec({slot:10}),...same,rec({slot:99})].forEach(x=>r.ingest(x));
 const slots=r.list().map(x=>x.slot);assert.deepEqual(slots,[99,50,50,50,10]);
 const ties=r.list().filter(x=>x.slot===50).map(x=>x.signature);assert.deepEqual(ties,[...ties].sort());
});

test('pagination walks every record exactly once, survives inserts, and rejects bad cursors',()=>{
 const r=createRegistry();for(let i=0;i<23;i++)r.ingest(rec({slot:100+(i%7)}));
 const seen=[];let cursor=null,pages=0;
 do{const p=r.page({cursor,limit:5});seen.push(...p.items.map(x=>x.mint));cursor=p.nextCursor;pages++;}while(cursor);
 assert.equal(pages,5);assert.equal(new Set(seen).size,23);assert.deepEqual(seen,r.list().map(x=>x.mint));
 const first=r.page({limit:5});r.ingest(rec({slot:9_999}));
 const second=r.page({cursor:first.nextCursor,limit:5});
 assert.deepEqual(second.items.map(x=>x.mint),r.list().slice(r.list().findIndex(x=>x.mint===first.items.at(-1).mint)+1).slice(0,5).map(x=>x.mint),'a new newest record does not shift later pages');
 assert.equal(r.page({limit:1000}).items.length,24);assert.equal(r.page({limit:0}).items.length,20,'bad limits fall back to the default');assert.equal(r.page({limit:'x'}).items.length,20);
 assert.equal(createRegistry().page().nextCursor,null);
 for(const bad of ['not base64!!',btoa('{}'),btoa(JSON.stringify({s:-1,g:'x'})),btoa(JSON.stringify({s:5,g:'short'}))])assert.throws(()=>r.page({cursor:bad}),/not valid/);
 const tail=r.page({cursor:encodeCursor({slot:1,signature:sig()}),limit:5});assert.equal(tail.items.length,0);assert.equal(tail.nextCursor,null);
 assert.deepEqual(decodeCursor(encodeCursor({slot:7,signature:'1'.repeat(64)})),{slot:7,signature:'1'.repeat(64)});
});

test('the registry keeps the newest MAX_RECORDS and drops the oldest',()=>{
 const r=createRegistry();const oldest=rec({slot:1});r.ingest(oldest);
 for(let i=0;i<MAX_RECORDS;i++)r.ingest(rec({slot:10+i}));
 assert.equal(r.size(),MAX_RECORDS);assert.equal(r.get(oldest.mint),null);
});

test('storage: round trip, corrupt data, foreign data and a failing store never throw',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const r=createRegistry();r.ingest(rec({slot:3}));r.ingest(rec({slot:4}));
 assert.equal(saveRegistry(r,storage),true);
 assert.deepEqual(loadRegistry(storage).list(),r.list());
 memory.set(REGISTRY_KEY,'{not json');assert.equal(loadRegistry(storage).size(),0);
 memory.set(REGISTRY_KEY,JSON.stringify({records:[rec(),{bad:1},'x',null]}));assert.equal(loadRegistry(storage).size(),1,'bad entries are dropped, good ones kept');
 memory.set(REGISTRY_KEY,JSON.stringify({records:'nope'}));assert.equal(loadRegistry(storage).size(),0);
 assert.equal(saveRegistry(r,{setItem(){throw Error('quota')}}),false);
 assert.equal(loadRegistry({getItem(){throw Error('blocked')}}).size(),0);
});

test('classifyLaunch: live, graduated, missing and every mismatch',async()=>{
 const record=normalizeLaunch(rec()),deps={PUMP_SDK:sdk.PUMP_SDK,PUMP_PROGRAM_ID:sdk.PUMP_PROGRAM_ID};
 const mint=info(TOKEN_2022.toBase58());
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:await curveInfo(record.creator)},deps).state,'live');
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:await curveInfo(record.creator,true)},deps).state,'graduated');
 assert.equal(classifyLaunch(record,{mintAccount:null,curveAccount:null},deps).state,'missing');
 assert.equal(classifyLaunch(record,{mintAccount:info('11111111111111111111111111111111'),curveAccount:await curveInfo(record.creator)},deps).state,'mismatch');
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:null},deps).state,'mismatch');
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:info('11111111111111111111111111111111')},deps).state,'mismatch');
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:await curveInfo(Keypair.generate().publicKey.toBase58())},deps).state,'mismatch');
 assert.equal(classifyLaunch(record,{mintAccount:mint,curveAccount:info(sdk.PUMP_PROGRAM_ID.toBase58(),Buffer.from([1,2,3]))},deps).state,'mismatch','undecodable curve data');
});

test('reconcile batches four launches per call, isolates failures, and writes states back',async()=>{
 const r=createRegistry(),launches=Array.from({length:9},(_,i)=>rec({slot:100+i}));launches.forEach(x=>r.ingest(x));
 const calls=[];
 const connection={async getMultipleAccountsInfo(keys){
  calls.push(keys.length);
  if(calls.length===2)throw Error('rate limited');
  const out=[];for(let i=0;i<keys.length;i+=2){const mint=keys[i].toBase58(),owner=r.get(mint).creator;out.push(info(TOKEN_2022.toBase58()),await curveInfo(owner));}
  return out;
 }};
 const results=await reconcileLaunches({connection,registry:r});
 assert.deepEqual(calls,[8,8,2],'4 launches = 8 accounts per call, which the relay allows');
 const states=Object.values(results).map(x=>x.state);
 assert.equal(states.filter(s=>s==='live').length,5);assert.equal(states.filter(s=>s==='unreachable').length,4);
 for(const [mint,{state}] of Object.entries(results))assert.equal(r.get(mint).state,state);
 const one=await reconcileLaunches({connection:{getMultipleAccountsInfo:async keys=>{assert.equal(keys.length,2);return [null,null];}},registry:r,mints:[launches[0].mint,'unknown-mint']});
 assert.deepEqual(Object.keys(one),[launches[0].mint]);assert.equal(r.get(launches[0].mint).state,'missing');
});

test('studio link carries only the mint and is safely encoded',()=>{
 assert.equal(studioLink('So11111111111111111111111111111111111111112'),'/?mint=So11111111111111111111111111111111111111112#studio');
 assert.equal(studioLink('a&b=c'),'/?mint=a%26b%3Dc#studio');
});

test('launches saved under the pre-rename key are still loaded, and saved forward under the new key',async()=>{
 const {LEGACY_REGISTRY_KEY}=await import('../src/launch-registry.mjs');
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const r=createRegistry();r.ingest(rec({slot:9}));
 memory.set(LEGACY_REGISTRY_KEY,JSON.stringify({version:1,records:r.list()}));
 const loaded=loadRegistry(storage);assert.equal(loaded.size(),1);
 saveRegistry(loaded,storage);assert.ok(memory.get(REGISTRY_KEY));
 assert.equal(REGISTRY_KEY,'nush-launches-v1');
});
