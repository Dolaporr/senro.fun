// Analytics maths is pure and checked by hand. Account reading uses the REAL Pump SDK coder to encode Global
// and BondingCurve accounts, against a MOCKED connection. Not evidence of live-chain values.
import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair,PublicKey} from '@solana/web3.js';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {curveStats,claimableLamports,formatSol,readCreatorAnalytics,RENT_EXEMPT_EMPTY} from '../src/launch-analytics.mjs';
import {classifyLaunch,normalizeLaunch} from '../src/launch-registry.mjs';
import {base58} from '../src/guarded-trade.mjs';
import crypto from 'node:crypto';

const sdk=await loadPumpSdk();
const coder=sdk.PUMP_SDK.offlinePumpProgram.coder,idl=sdk.PUMP_SDK.offlinePumpProgram.idl;
const zeroOf=t=>t==='bool'?false:t==='pubkey'?PublicKey.default:['u8','u16','u32'].includes(t)?0:typeof t==='object'&&t.array?Array.from({length:t.array[1]},()=>zeroOf(t.array[0])):new BN(0);
const fields=name=>idl.types.find(t=>t.name.toLowerCase()===name.toLowerCase()).type.fields;
// Anchor's encoders use a 1000-byte scratch buffer and Global is 1080 bytes, so encode with the type's own
// layout and prepend the IDL discriminator. The result is decoded by the SDK's own decoder, which is what is under test.
async function account(name,values){
 const obj={};for(const f of fields(name))obj[f.name]=values[f.name]??zeroOf(f.type);
 const key=name==='Global'?'global':'bondingCurve';
 const disc=Buffer.from(idl.accounts.find(a=>a.name.toLowerCase()===key.toLowerCase()).discriminator);
 return {lamports:1,owner:sdk.PUMP_PROGRAM_ID,data:Buffer.concat([disc,(()=>{const layout=coder.types.typeLayouts.get(key),buf=Buffer.alloc(layout.span);layout.encode(obj,buf);return buf;})()]),executable:false,rentEpoch:0};
}
// Values close to Pump's launch defaults: 1.073B virtual tokens, 30 SOL virtual, 793.1M real tokens, 1B supply.
const INITIAL_REAL=793_100_000_000_000n,SUPPLY=1_000_000_000_000_000n;
const global={initialRealTokenReserves:new BN(INITIAL_REAL.toString())};
const curve=(over={})=>({virtualTokenReserves:new BN('1073000000000000'),virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN(INITIAL_REAL.toString()),realQuoteReserves:new BN(0),tokenTotalSupply:new BN(SUPPLY.toString()),complete:false,...over});

test('curveStats at launch: zero progress, about 2.8e-8 SOL per token, about 28 SOL market cap',()=>{
 const s=curveStats(curve(),global);
 assert.equal(s.progressBps,0);
 assert.equal(s.priceLamports,30_000_000_000n*1_000_000n/1_073_000_000_000_000n); // 27 lamports per whole token
 assert.equal(s.marketCapLamports,30_000_000_000n*SUPPLY/1_073_000_000_000_000n);
 assert.equal(formatSol(s.marketCapLamports),'28.0 SOL'.replace('28.0','27.96'));
});

test('curveStats: half sold is 50%, complete is 100%, oversold clamps, bad data throws',()=>{
 assert.equal(curveStats(curve({realTokenReserves:new BN((INITIAL_REAL/2n).toString())}),global).progressBps,5000);
 assert.equal(curveStats(curve({complete:true}),global).progressBps,10000);
 assert.equal(curveStats(curve({realTokenReserves:new BN(0)}),global).progressBps,10000);
 assert.equal(curveStats(curve({realTokenReserves:new BN((INITIAL_REAL+5n).toString())}),global).progressBps,0,'more reserves than at launch is 0%, not negative');
 assert.equal(curveStats(curve(),{initialRealTokenReserves:new BN(0)}).progressBps,0);
 assert.throws(()=>curveStats(curve({virtualTokenReserves:new BN(0)}),global),/no virtual token/);
 assert.equal(curveStats(curve({realQuoteReserves:new BN(12345)}),global).curveSolLamports,12345n);
});

test('claimable fees keep the rent-exempt minimum in the vault',()=>{
 assert.equal(claimableLamports(0),0n);assert.equal(claimableLamports(RENT_EXEMPT_EMPTY),0n);assert.equal(claimableLamports(RENT_EXEMPT_EMPTY+100n),100n);assert.equal(claimableLamports(undefined),0n);
});

test('formatSol keeps small values readable',()=>{
 assert.equal(formatSol(0n),'0 SOL');assert.equal(formatSol(5000n),'0.000005 SOL');assert.equal(formatSol(23_500_000n),'0.0235 SOL');
 assert.equal(formatSol(1_500_000_000n),'1.50 SOL');assert.equal(formatSol(85_000_000_000_000n),'85,000 SOL');
});

test('readCreatorAnalytics decodes real-format accounts, batches by 8 and isolates failures',async()=>{
 const creator=Keypair.generate().publicKey;
 const mints=Array.from({length:10},()=>Keypair.generate().publicKey.toBase58());
 const g=await account('Global',{initialRealTokenReserves:new BN(INITIAL_REAL.toString())});
 const sold=await account('BondingCurve',{...curve({realTokenReserves:new BN((INITIAL_REAL/4n).toString())}),creator,quoteMint:PublicKey.default});
 const shared=await account('BondingCurve',{...curve(),creator:sdk.feeSharingConfigPda(new PublicKey(mints[1]))});
 const calls=[];
 const connection={async getMultipleAccountsInfo(keys){
  calls.push(keys.length);
  if(calls.length===1){assert.ok(keys[0].equals(sdk.GLOBAL_PDA));assert.ok(keys[1].equals(sdk.creatorVaultPda(creator)));return [g,{lamports:Number(RENT_EXEMPT_EMPTY)+2_000_000,owner:PublicKey.default,data:Buffer.alloc(0)}];}
  if(calls.length===3)throw Error('rate limited');
  return keys.map((k,i)=>i===0?sold:i===1?shared:i===2?null:{...sold,data:Buffer.from([1,2,3])});
 }};
 const out=await readCreatorAnalytics({connection,creator:creator.toBase58(),mints});
 assert.deepEqual(calls,[2,8,2],'global+vault, then curves in eights');
 assert.equal(out.claimableLamports,2_000_000n);
 assert.equal(out.launches[mints[0]].progressBps,7500);assert.equal(out.launches[mints[0]].sharedFees,false);
 assert.equal(out.launches[mints[1]].sharedFees,true);
 assert.equal(out.launches[mints[2]].available,false);assert.match(out.launches[mints[2]].reason,/No bonding curve/);
 assert.equal(out.launches[mints[3]].available,false);assert.match(out.launches[mints[3]].reason,/could not be read/);
 for(const m of mints.slice(8))assert.match(out.launches[m].reason,/network/);
});

test('readCreatorAnalytics refuses a Global account not owned by Pump',async()=>{
 const connection={getMultipleAccountsInfo:async()=>[{lamports:1,owner:PublicKey.default,data:Buffer.alloc(8)},null]};
 await assert.rejects(readCreatorAnalytics({connection,creator:Keypair.generate().publicKey.toBase58(),mints:[]}),/global account/);
});

test('reconciliation treats a fee-sharing config as the same launch, not a mismatch',async()=>{
 const record=normalizeLaunch({signature:base58(crypto.randomBytes(64)),mint:Keypair.generate().publicKey.toBase58(),creator:Keypair.generate().publicKey.toBase58(),slot:5,name:'A',symbol:'A',metadataUri:'https://g.test/x'});
 const curveInfo=await account('BondingCurve',{...curve(),creator:sdk.feeSharingConfigPda(new PublicKey(record.mint))});
 const mintInfo={lamports:1,owner:new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),data:Buffer.alloc(0)};
 assert.equal(classifyLaunch(record,{mintAccount:mintInfo,curveAccount:curveInfo},sdk).state,'live');
});
