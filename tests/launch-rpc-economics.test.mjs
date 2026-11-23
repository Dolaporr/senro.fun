// The relay with Nush fees configured: only the exact launch + fee split + launch fee is simulated or sent.
// REAL: SDK-built transactions through the real lookup-table compile. MOCKED: the upstream RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,TransactionInstruction} from '@solana/web3.js';
import {prepareLaunchPlan} from '../src/launchpad-plan.mjs';
import {buildLaunchTransaction,expectedLaunchInstructions} from '../src/launchpad-create-tx.mjs';
import {validateLaunchRpc,inspectLaunchWire,handleLaunchRpc,UPDATE_FEE_SHARES_DISCRIMINATOR} from '../worker/launch-rpc.mjs';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {setupEconomics} from './helpers/nush-fixture.mjs';

const sdk=await loadPumpSdk();
const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const b64=tx=>Buffer.from(tx.serialize()).toString('base64');
const sim=tx=>({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[b64(tx),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false}]});
const send=tx=>({jsonrpc:'2.0',id:1,method:'sendTransaction',params:[b64(tx),{encoding:'base64',skipPreflight:false,maxRetries:0}]});
const {economics,table}=await setupEconomics();

async function launch(){
 const creator=Keypair.generate(),mint=Keypair.generate();
 const plan=prepareLaunchPlan({form:{name:'Orbit',symbol:'ORB'},creator:creator.publicKey.toBase58(),mint:mint.publicKey.toBase58(),metadataUri:'https://gateway.pinata.cloud/ipfs/'+'Q'.repeat(46),economics});
 const {transaction}=await buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BH,lastValidBlockHeight:100,lookupTable:table,computeUnitLimit:400000});
 return {transaction,plan,creator,mint};
}
async function variant(change){
 const {plan,creator,mint}=await launch();
 const ixs=await expectedLaunchInstructions(plan,{computeUnitLimit:400000});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:creator.publicKey,recentBlockhash:BH,instructions:change(ixs,plan)}).compileToV0Message([table]));
 tx.sign([creator,mint]);return tx;
}
const refused=(tx,pattern)=>assert.throws(()=>inspectLaunchWire(b64(tx),economics),pattern);

test('the real Nush launch simulates, and sends once both signatures are valid',async()=>{
 const {transaction,creator}=await launch();
 assert.ok(await validateLaunchRpc(sim(transaction),{economics}));
 await assert.rejects(validateLaunchRpc(send(transaction),{economics}),/signatures/);
 transaction.sign([creator]);
 assert.ok(await validateLaunchRpc(send(transaction),{economics}));
});

test('without the fees, with a plain launch, or without the Nush table: refused once fees are configured',async()=>{
 refused(await variant(ixs=>ixs.slice(0,2)),/nothing else/);
 const {plan,creator,mint}=await launch();
 const plain=new VersionedTransaction(new TransactionMessage({payerKey:creator.publicKey,recentBlockhash:BH,instructions:(await expectedLaunchInstructions(plan,{})).slice(0,1)}).compileToV0Message());
 refused(plain,/Nush lookup table/);
 const {transaction}=await launch();
 assert.throws(()=>inspectLaunchWire(b64(transaction),null),/without lookup tables/,'a server without fees refuses table launches');
});

test('every way to shortchange the treasury is refused',async()=>{
 const fee=(ixs,plan,lamports,to=economics.treasury)=>[...ixs.slice(0,-1),SystemProgram.transfer({fromPubkey:new PublicKey(plan.creator),toPubkey:new PublicKey(to),lamports})];
 refused(await variant((ixs,plan)=>fee(ixs,plan,1)),/amount is wrong/);
 refused(await variant((ixs,plan)=>fee(ixs,plan,20_000_000)),/amount is wrong/);
 refused(await variant((ixs,plan)=>fee(ixs,plan,10_000_000,Keypair.generate().publicKey.toBase58())),/to the Nush treasury/);
 // split: rewrite the update's shares to 90/10 and to a different treasury
 const reshare=(bpsCreator,bpsTreasury,treasury=economics.treasury)=>(ixs,plan)=>{const u=ixs.at(-2),d=Buffer.from(u.data);d.writeUInt16LE(bpsCreator,44);new PublicKey(treasury).toBuffer().copy(d,46);d.writeUInt16LE(bpsTreasury,78);return [...ixs.slice(0,-2),new TransactionInstruction({programId:u.programId,keys:u.keys,data:d}),ixs.at(-1)];};
 refused(await variant(reshare(9000,1000)),/agreed shares/);
 refused(await variant(reshare(7500,2500,Keypair.generate().publicKey.toBase58())),/agreed shares/);
 // swap the order of the fee instructions
 refused(await variant(ixs=>[...ixs.slice(0,-3),ixs.at(-2),ixs.at(-3),ixs.at(-1)]),/fee-sharing config must follow/);
 // an extra instruction anywhere
 refused(await variant((ixs,plan)=>[...ixs,SystemProgram.transfer({fromPubkey:new PublicKey(plan.creator),toPubkey:Keypair.generate().publicKey,lamports:1})]),/nothing else/);
});

test('the update discriminator matches the SDK',async()=>{
 const ix=await sdk.PUMP_SDK.updateFeeShares({authority:Keypair.generate().publicKey,mint:Keypair.generate().publicKey,currentShareholders:[],newShareholders:[{address:Keypair.generate().publicKey,shareBps:10000}],bondingCurveComplete:false});
 assert.deepEqual([...ix.data.subarray(0,8)],UPDATE_FEE_SHARES_DISCRIMINATOR);
});

test('the HTTP relay passes economics through: a cheap launch never reaches an upstream',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:1},value:{err:null}}}));};
 const post=body=>new Request('https://nush.test/api/launch-rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const {transaction}=await launch();
 assert.equal((await handleLaunchRpc(post(sim(transaction)),fetcher,{economics})).status,200);
 const cheap=await variant((ixs,plan)=>[...ixs.slice(0,-1),SystemProgram.transfer({fromPubkey:new PublicKey(plan.creator),toPubkey:new PublicKey(economics.treasury),lamports:1})]);
 assert.equal((await handleLaunchRpc(post(sim(cheap)),fetcher,{economics})).status,400);
 assert.equal(calls,1);
});

test('server settings: treasury without table is setup mode (reads work, launches paused); bad RPC URL is fatal and named',async()=>{
 const {launchServerConfig}=await import('../worker/launch-rpc.mjs');
 const T=economics.treasury,L=economics.lookupTable;
 const setup=launchServerConfig({VITE_NUSH_TREASURY:T});
 assert.equal(setup.fatal,undefined);assert.match(setup.launchesBlocked,/VITE_NUSH_LOOKUP_TABLE is not set/);
 const read={jsonrpc:'2.0',id:1,method:'getSlot',params:[]};
 assert.ok(await validateLaunchRpc(read,setup));
 for(const m of [sim,send]){const {transaction}=await launch();await assert.rejects(validateLaunchRpc(m(transaction),setup),/setup is finished/);}
 assert.match(launchServerConfig({VITE_NUSH_LOOKUP_TABLE:L}).launchesBlocked,/VITE_NUSH_TREASURY/);
 assert.match(launchServerConfig({VITE_NUSH_TREASURY:'bad',VITE_NUSH_LOOKUP_TABLE:L}).launchesBlocked,/treasury/);
 const full=launchServerConfig({VITE_NUSH_TREASURY:T,VITE_NUSH_LOOKUP_TABLE:L});assert.equal(full.launchesBlocked,null);assert.equal(full.economics.treasury,T);
 assert.equal(launchServerConfig({}).economics,null);assert.equal(launchServerConfig({}).launchesBlocked,null);
 assert.match(launchServerConfig({LAUNCH_RPC_URL:'http://x.example'}).fatal,/HTTPS/);
 assert.ok(!JSON.stringify(launchServerConfig({LAUNCH_RPC_URL:'nope?api-key=SECRET'})).includes('SECRET'));
});

test('the deployed function in setup mode answers reads instead of failing',async()=>{
 process.env.VITE_NUSH_TREASURY=economics.treasury;delete process.env.VITE_NUSH_LOOKUP_TABLE;delete process.env.LAUNCH_RPC_URL;
 const {default:fn}=await import('../netlify/functions/launch-rpc.mjs?setup-mode');
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:123}));
 try{
  const r=await fn(new Request('https://nush.test/api/launch-rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSlot',params:[]})}),{ip:'9.9.9.9'});
  assert.equal(r.status,200);assert.equal((await r.json()).result,123);
 }finally{globalThis.fetch=realFetch;delete process.env.VITE_NUSH_TREASURY;}
});
