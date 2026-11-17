// Instruction building uses the REAL @pump-fun/pump-sdk (create_v2). The RPC connection and the
// wallet are MOCKS: these tests do not simulate or send anything on a Solana cluster.
import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {prepareLaunchPlan} from '../src/launchpad-plan.mjs';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {
 buildLaunchTransaction,assertLaunchTransaction,expectedLaunchInstructions,launchMessageHash,launchPlanDigest,
 hasValidLaunchSignatures,simulateLaunch,submitLaunch,verifyLaunchedMint,signLaunchWithWallet,GENESIS_HASH,PACKET_LIMIT
} from '../src/launchpad-create-tx.mjs';

const PUMP_PROGRAM='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BLOCKHASH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const LAST_VALID=123456;
const sdk=await loadPumpSdk();

function fixture(overrides={}){
 const creator=Keypair.generate(),mint=Keypair.generate();
 const plan=prepareLaunchPlan({form:{name:'Orbit',symbol:'ORB',description:'Test token'},creator:creator.publicKey.toBase58(),mint:mint.publicKey.toBase58(),metadataUri:'https://example.com/orbit.json',...overrides});
 return {creator,mint,plan};
}
async function built(overrides={},compute={}){
 const f=fixture(overrides);
 const result=await buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID,...compute});
 return {...f,...result};
}
function walletFor(keypair,{dropMint=false,mutate}={}){
 const account={address:keypair.publicKey.toBase58(),chains:['solana:mainnet'],features:['solana:signTransaction']};
 return {account,wallet:{features:{'solana:signTransaction':{supportedTransactionVersions:[0,'legacy'],async signTransaction({transaction}){
  const tx=VersionedTransaction.deserialize(transaction);
  if(mutate)return [{signedTransaction:mutate(tx,keypair).serialize()}];
  if(dropMint)tx.signatures[1]=new Uint8Array(64);
  tx.sign([keypair]);
  if(dropMint)tx.signatures[1]=new Uint8Array(64);
  return [{signedTransaction:tx.serialize()}];
 }}}}};
}
async function fullySigned(ctx){
 const {wallet,account}=walletFor(ctx.creator);
 return signLaunchWithWallet({wallet,account,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint});
}
function simulationFor(ctx,over={}){return {err:null,logs:[],unitsConsumed:150000,slot:10,simulatedAt:1000,messageHash:ctx.binding.messageHash,...over};}
function mockConnection(over={}){
 const calls=[];
 const c={calls,
  getGenesisHash:async()=>GENESIS_HASH['mainnet-beta'],
  isBlockhashValid:async()=>({value:true}),
  getBalance:async()=>2_000_000_000,
  getFeeForMessage:async()=>({value:5000}),
  simulateTransaction:async(tx,config)=>{calls.push(['simulate',config]);return {context:{slot:42},value:{err:null,logs:['ok'],unitsConsumed:123456,accounts:config.accounts.addresses.map((a,i)=>({lamports:i===0?1_970_000_000:1_000_000,owner:'11111111111111111111111111111111',data:['','base64']}))}};},
  sendRawTransaction:async(wire)=>{calls.push(['send']);return VersionedTransaction.deserialize(wire).signatures[0]?bs58ish(VersionedTransaction.deserialize(wire).signatures[0]):'';},
  getSignatureStatuses:async()=>({value:[{err:null,confirmationStatus:'confirmed'}]}),
  getBlockHeight:async()=>LAST_VALID-10,
  getSignatureStatus:async()=>({value:null}),
  ...over};
 return c;
}
import {base58 as bs58ish} from '../src/guarded-trade.mjs';

test('real SDK create_v2 instruction: Pump program, two signers, SOL curve, within packet limit',async()=>{
 const ctx=await built();
 const message=ctx.transaction.message;
 assert.equal(ctx.transaction.version,0);
 assert.equal(message.header.numRequiredSignatures,2);
 assert.ok(message.staticAccountKeys[0].equals(ctx.creator.publicKey));
 assert.ok(message.staticAccountKeys[1].equals(ctx.mint.publicKey));
 const programs=message.compiledInstructions.map(i=>message.staticAccountKeys[i.programIdIndex].toBase58());
 assert.deepEqual(programs,[PUMP_PROGRAM]);
 assert.equal(sdk.PUMP_PROGRAM_ID.toBase58(),PUMP_PROGRAM,'SDK program id is the published Pump program');
 assert.ok(ctx.transaction.serialize().length<=PACKET_LIMIT);
 assert.equal(await assertLaunchTransaction(ctx.transaction,ctx.plan),true);
});

test('build is deterministic and bound to every reviewed input',async()=>{
 const f=fixture();
 const a=await buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID});
 const b=await buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID});
 assert.equal(a.binding.messageHash,b.binding.messageHash);
 assert.equal(a.binding.planDigest,b.binding.planDigest);
 const other=await buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:new PublicKey(new Uint8Array(32).fill(8)).toBase58(),lastValidBlockHeight:LAST_VALID});
 assert.notEqual(a.binding.messageHash,other.binding.messageHash);
 const renamed=prepareLaunchPlan({form:{name:'Orbit2',symbol:'ORB'},creator:f.plan.creator,mint:f.plan.mint,metadataUri:f.plan.metadataUri});
 const c=await buildLaunchTransaction({plan:renamed,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID});
 assert.notEqual(a.binding.messageHash,c.binding.messageHash);
 assert.notEqual(await launchPlanDigest(f.plan),await launchPlanDigest(renamed));
});

test('rejects wrong mint signer, bad blockhash, bad height and any initial buy',async()=>{
 const f=fixture();
 await assert.rejects(buildLaunchTransaction({plan:f.plan,mintKeypair:Keypair.generate(),blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID}),/Mint signer/);
 await assert.rejects(buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:'nope',lastValidBlockHeight:LAST_VALID}),/blockhash/);
 await assert.rejects(buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:0}),/block height/);
 const buy=fixture({initialBuyLamports:'1000000'});
 await assert.rejects(buildLaunchTransaction({plan:buy.plan,mintKeypair:buy.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID}),/initial buy/i);
 await assert.rejects(buildLaunchTransaction({plan:{...f.plan,execution:'enabled'},mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID}),/Unknown launch plan/);
});

test('compute budget is optional, bounded, and part of the verified instruction set',async()=>{
 const ctx=await built({},{computeUnitLimit:400000,computeUnitPriceMicroLamports:1000});
 const programs=ctx.transaction.message.compiledInstructions.map(i=>ctx.transaction.message.staticAccountKeys[i.programIdIndex].toBase58());
 assert.deepEqual(programs,[ComputeBudgetProgram.programId.toBase58(),ComputeBudgetProgram.programId.toBase58(),PUMP_PROGRAM]);
 assert.equal(await assertLaunchTransaction(ctx.transaction,ctx.plan,ctx.binding.compute),true);
 await assert.rejects(assertLaunchTransaction(ctx.transaction,ctx.plan),/unexpected instructions/);
 const f=fixture();
 for(const bad of [{computeUnitLimit:0},{computeUnitLimit:1_400_001},{computeUnitPriceMicroLamports:-1},{computeUnitPriceMicroLamports:1_000_001},{computeUnitLimit:1.5}])
  await assert.rejects(buildLaunchTransaction({plan:f.plan,mintKeypair:f.mint,blockhash:BLOCKHASH,lastValidBlockHeight:LAST_VALID,...bad}));
});

async function tampered(ctx,editInstructions,{payer=ctx.creator.publicKey}={}){
 const original=await expectedLaunchInstructions(ctx.plan);
 const message=new TransactionMessage({payerKey:payer,recentBlockhash:BLOCKHASH,instructions:editInstructions(original)}).compileToV0Message();
 return new VersionedTransaction(message);
}

test('inspection rejects drain instructions, swapped data, swapped accounts, other payers and extra programs',async()=>{
 const ctx=await built();
 const drain=SystemProgram.transfer({fromPubkey:ctx.creator.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1});
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>[drain,...i]),ctx.plan),/unexpected instructions/);
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>[...i,drain]),ctx.plan),/unexpected instructions/);
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>{const x=i[0];return [{...x,data:Buffer.concat([x.data.subarray(0,8),Buffer.alloc(x.data.length-8,1)])}];}),ctx.plan),/differs from the verified SDK instruction/);
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>{const x=i[0];const keys=x.keys.map((k,n)=>n===1?{...k,pubkey:Keypair.generate().publicKey}:k);return [{...x,keys}];}),ctx.plan),/differs from the verified SDK instruction/);
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>[{...i[0],programId:SystemProgram.programId}]),ctx.plan),/differs from the verified SDK instruction/);
 const other=Keypair.generate();
 await assert.rejects(assertLaunchTransaction(await tampered(ctx,i=>i,{payer:other.publicKey}),ctx.plan),/Fee payer|signers/);
});

test('signature checks: unsigned, mint-only and wrong-message signatures are not accepted',async()=>{
 const ctx=await built();
 assert.equal(await hasValidLaunchSignatures(ctx.transaction),false,'creator slot is still empty');
 const signed=await fullySigned(ctx);
 assert.equal(await hasValidLaunchSignatures(signed),true);
 const forged=VersionedTransaction.deserialize(signed.serialize());
 forged.signatures[0]=new Uint8Array(64).fill(9);
 assert.equal(await hasValidLaunchSignatures(forged),false);
 const wrongCreator=Keypair.generate();
 const mixed=VersionedTransaction.deserialize(ctx.transaction.serialize());
 assert.throws(()=>mixed.sign([wrongCreator]),/non signer key/,'web3.js refuses a key that is not a required signer');
 const seed=Buffer.from(wrongCreator.secretKey.subarray(0,32));
 const privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
 mixed.signatures[0]=new Uint8Array(crypto.sign(null,mixed.message.serialize(),privateKey));
 assert.equal(await hasValidLaunchSignatures(mixed),false,'a valid signature from another key cannot fill the creator slot');
});

test('wallet signing: reviewed message only, mint signature restored, wrong wallet or chain refused',async()=>{
 const ctx=await built();
 const {wallet,account}=walletFor(ctx.creator,{dropMint:true});
 const signed=await signLaunchWithWallet({wallet,account,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint});
 assert.equal(await hasValidLaunchSignatures(signed),true,'mint signature re-applied after the wallet dropped it');
 const evil=walletFor(ctx.creator,{mutate:(tx)=>{const m=new TransactionMessage({payerKey:ctx.creator.publicKey,recentBlockhash:BLOCKHASH,instructions:[SystemProgram.transfer({fromPubkey:ctx.creator.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message();return new VersionedTransaction(m);}});
 await assert.rejects(signLaunchWithWallet({...evil,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint}),/changed the reviewed transaction/);
 const stranger=walletFor(Keypair.generate());
 await assert.rejects(signLaunchWithWallet({...stranger,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint}),/not the launch creator/);
 const devnetOnly={wallet,account:{...account,chains:['solana:devnet']}};
 await assert.rejects(signLaunchWithWallet({...devnetOnly,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint}),/versioned transactions on this network/);
 const noFeature={wallet:{features:{}},account};
 await assert.rejects(signLaunchWithWallet({...noFeature,transaction:ctx.transaction,binding:ctx.binding,mintKeypair:ctx.mint}),/versioned transactions/);
});

test('MOCK simulation: wrong network, expired blockhash and changed transaction are refused; result carries logs, units, fee and debit',async()=>{
 const ctx=await built();
 const connection=mockConnection();
 const sim=await simulateLaunch({connection,transaction:ctx.transaction,binding:ctx.binding,plan:ctx.plan,now:()=>5000});
 assert.equal(sim.err,null);assert.equal(sim.unitsConsumed,123456);assert.equal(sim.slot,42);assert.equal(sim.simulatedAt,5000);
 assert.equal(sim.feeLamports,5000);assert.equal(sim.creatorDebitLamports,30_000_000);
 assert.equal(sim.messageHash,ctx.binding.messageHash);
 const config=connection.calls.find(c=>c[0]==='simulate')[1];
 assert.equal(config.sigVerify,false);assert.equal(config.replaceRecentBlockhash,false);
 assert.equal(config.accounts.addresses[0],ctx.plan.creator);
 await assert.rejects(simulateLaunch({connection:mockConnection({getGenesisHash:async()=>GENESIS_HASH.devnet}),transaction:ctx.transaction,binding:ctx.binding,plan:ctx.plan}),/not connected to mainnet-beta/);
 await assert.rejects(simulateLaunch({connection:mockConnection({isBlockhashValid:async()=>({value:false})}),transaction:ctx.transaction,binding:ctx.binding,plan:ctx.plan}),/blockhash expired/);
 const other=await built();
 await assert.rejects(simulateLaunch({connection,transaction:other.transaction,binding:ctx.binding,plan:ctx.plan}),/changed after it was prepared/);
 const failing=mockConnection({simulateTransaction:async()=>({context:{slot:1},value:{err:{InstructionError:[0,{Custom:6000}]},logs:['Program log: boom'],unitsConsumed:10,accounts:[]}})});
 const failed=await simulateLaunch({connection:failing,transaction:ctx.transaction,binding:ctx.binding,plan:ctx.plan});
 assert.deepEqual(failed.err,{InstructionError:[0,{Custom:6000}]});assert.deepEqual(failed.logs,['Program log: boom']);
});

test('MOCK submit: sends only the simulated, fully signed, unchanged transaction and confirms once',async()=>{
 const ctx=await built();
 const signed=await fullySigned(ctx);
 const connection=mockConnection();
 const seen=[];
 const result=await submitLaunch({connection,plan:ctx.plan,binding:ctx.binding,simulation:simulationFor(ctx),signedTransaction:signed,now:()=>1500,onSubmitted:s=>seen.push(s)});
 assert.equal(result.status,'confirmed');
 assert.equal(seen.length,1);assert.equal(seen[0].signature,result.signature);
 assert.equal(connection.calls.filter(c=>c[0]==='send').length,1);
 await assert.rejects(submitLaunch({connection,plan:ctx.plan,binding:ctx.binding,simulation:simulationFor(ctx),signedTransaction:signed,now:()=>1500}),/already submitted/);
 assert.equal(connection.calls.filter(c=>c[0]==='send').length,1,'duplicate submission never reaches the network');
});

test('MOCK submit gates: stale, failed, foreign or missing-signature input never reaches the network',async()=>{
 const ctx=await built();
 const signed=await fullySigned(ctx);
 const run=(over={})=>{const connection=mockConnection();return submitLaunch({connection,plan:ctx.plan,binding:ctx.binding,simulation:simulationFor(ctx),signedTransaction:signed,now:()=>1500,...over}).then(r=>({r,connection}));};
 await assert.rejects(run({now:()=>1000+31000}),/stale/);
 await assert.rejects(run({simulation:simulationFor(ctx,{err:{InstructionError:[0,'x']}})}),/did not succeed/);
 await assert.rejects(run({simulation:simulationFor(ctx,{messageHash:'abc'})}),/different transaction/);
 await assert.rejects(run({signedTransaction:ctx.transaction}),/missing a valid creator or mint signature/);
 const other=await built();
 await assert.rejects(run({signedTransaction:await fullySigned(other)}),/changed after simulation/);
 await assert.rejects(run({plan:{...ctx.plan,metadataUri:'https://evil.example/x.json'}}),/Launch plan changed/);
 const stale=mockConnection({isBlockhashValid:async()=>({value:false})});
 await assert.rejects(submitLaunch({connection:stale,plan:ctx.plan,binding:ctx.binding,simulation:simulationFor(ctx),signedTransaction:signed,now:()=>1500}),/blockhash expired/);
});

test('MOCK submit outcomes: rpc failure keeps the signature; on-chain failure, expiry, late confirmation and unknown are reported',async()=>{
 const noWait={wait:async()=>{},intervalMs:0};
 const run=async(over,opts={})=>{const c=await built();const signed=await fullySigned(c);return submitLaunch({connection:mockConnection(over),plan:c.plan,binding:c.binding,simulation:simulationFor(c),signedTransaction:signed,now:()=>1500,...noWait,...opts});};
 const base=await built();const signed=await fullySigned(base);
 await assert.rejects(submitLaunch({connection:mockConnection({sendRawTransaction:async()=>{throw Error('node unavailable')}}),plan:base.plan,binding:base.binding,simulation:simulationFor(base),signedTransaction:signed,now:()=>1500,...noWait}),e=>/Submission failed/.test(e.message)&&typeof e.signature==='string');
 assert.equal((await run({getSignatureStatuses:async()=>({value:[{err:{InstructionError:[0,'Custom']},confirmationStatus:'confirmed'}]})})).status,'failed');
 assert.equal((await run({getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>LAST_VALID+5})).status,'expired');
 let calls=0;
 const late=await run({getSignatureStatuses:async()=>({value:[++calls<3?null:{err:null,confirmationStatus:'finalized'}]}),getBlockHeight:async()=>LAST_VALID-1});
 assert.equal(late.status,'confirmed');assert.ok(calls>=3,'polled until the status appeared');
 let n=0;
 const raced=await run({getSignatureStatuses:async()=>({value:[++n<2?null:{err:null,confirmationStatus:'confirmed'}]}),getBlockHeight:async()=>LAST_VALID+5});
 assert.equal(raced.status,'confirmed','a transaction that lands right at expiry is reconciled, not reported as expired');
 const unknown=await run({getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>LAST_VALID-1},{maxMs:-1});
 assert.equal(unknown.status,'unknown');
});

async function curveAccount(plan,{creator=plan.creator,complete=false,owner=PUMP_PROGRAM}={}){
 const coder=sdk.PUMP_SDK.offlinePumpProgram.coder;
 const zero=new BN(0),key=new PublicKey(creator);
 const data=await coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN(1),virtualQuoteReserves:new BN(1),realTokenReserves:new BN(1),realQuoteReserves:zero,tokenTotalSupply:new BN(1),complete,creator:key,isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:zero,canEditCreatorFee:false,isHolderReward:false,creatorFee:zero,protocolFees:zero,depth:0,initialVirtualQuoteReserves:zero,postCompleteBaseOut:zero,postCompleteQuoteIn:zero});
 return {owner:new PublicKey(owner),data,lamports:1,executable:false};
}
const mintAccount=owner=>({owner:new PublicKey(owner),data:Buffer.alloc(82),lamports:1,executable:false});
const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

test('MOCK chain verification: checks mint owner, Pump curve ownership, creator and venue state',async()=>{
 const ctx=await built();
 const good=await curveAccount(ctx.plan);
 const ok=await verifyLaunchedMint({connection:{getMultipleAccountsInfo:async()=>[mintAccount(TOKEN_2022),good]},plan:ctx.plan});
 assert.equal(ok.mint,ctx.plan.mint);assert.equal(ok.creator,ctx.plan.creator);assert.equal(ok.complete,false);
 assert.equal(ok.bondingCurve,sdk.bondingCurvePda(new PublicKey(ctx.plan.mint)).toBase58());
 const run=accounts=>verifyLaunchedMint({connection:{getMultipleAccountsInfo:async()=>accounts},plan:ctx.plan});
 await assert.rejects(run([null,good]),/Mint account was not found/);
 await assert.rejects(run([mintAccount(PUMP_PROGRAM),good]),/not owned by an SPL token program/);
 await assert.rejects(run([mintAccount(TOKEN_2022),null]),/bonding curve was not found/i);
 await assert.rejects(run([mintAccount(TOKEN_2022),await curveAccount(ctx.plan,{owner:'11111111111111111111111111111111'})]),/bonding curve was not found/i);
 await assert.rejects(run([mintAccount(TOKEN_2022),await curveAccount(ctx.plan,{creator:Keypair.generate().publicKey.toBase58()})]),/creator is not the launching wallet/);
 await assert.rejects(run([mintAccount(TOKEN_2022),await curveAccount(ctx.plan,{complete:true})]),/already complete/);
});

test('Node loader exposes the named Pump SDK symbols the curve path and launchpad rely on',async()=>{
 const pump=await loadPumpSdk();
 for(const name of ['OnlinePumpSdk','PUMP_SDK','PUMP_PROGRAM_ID','bondingCurvePda','getBuyV3TokenAmountFromQuoteAmount'])assert.ok(pump[name],`${name} is exported`);
 for(const method of ['createV2Instruction','buyExactQuoteInV3Instructions','decodeBondingCurve'])assert.equal(typeof pump.PUMP_SDK[method],'function',`${method} is a function`);
 assert.equal(await loadPumpSdk(),pump,'loader is cached');
});
