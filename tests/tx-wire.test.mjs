// The relay's dependency-free parser must read transactions exactly as web3.js does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,Transaction,ComputeBudgetProgram} from '@solana/web3.js';
import {parseTransaction} from '../worker/tx-wire.mjs';
import {base58Encode,base58Decode,readEconomicsConfig} from '../src/nush-config.mjs';
import {prepareLaunchPlan} from '../src/launchpad-plan.mjs';
import {buildLaunchTransaction} from '../src/launchpad-create-tx.mjs';
import {setupEconomics} from './helpers/nush-fixture.mjs';

const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
function same(bytes){
 const ours=parseTransaction(bytes),theirs=VersionedTransaction.deserialize(bytes),m=theirs.message;
 assert.equal(ours.version,theirs.version);
 assert.deepEqual(ours.header,m.header);
 assert.deepEqual(ours.staticAccountKeys,m.staticAccountKeys.map(k=>k.toBase58()));
 assert.equal(ours.recentBlockhash,m.recentBlockhash);
 assert.deepEqual(ours.compiledInstructions.map(i=>[i.programIdIndex,i.accountKeyIndexes,[...i.data]]),m.compiledInstructions.map(i=>[i.programIdIndex,[...i.accountKeyIndexes],[...i.data]]));
 assert.deepEqual(ours.addressTableLookups.map(l=>[l.accountKey,l.writableIndexes,l.readonlyIndexes]),(m.addressTableLookups??[]).map(l=>[l.accountKey.toBase58(),[...l.writableIndexes],[...l.readonlyIndexes]]));
 assert.deepEqual([...ours.messageBytes],[...m.serialize()]);
 assert.deepEqual(ours.signatures.map(s=>[...s]),theirs.signatures.map(s=>[...s]));
}

test('matches web3.js on real Nush launches with the lookup table',async()=>{
 const {economics,table}=await setupEconomics();
 for(let i=0;i<5;i++){
  const c=Keypair.generate(),mint=Keypair.generate();
  const plan=prepareLaunchPlan({form:{name:'Orbit'+i,symbol:'ORB'},creator:c.publicKey.toBase58(),mint:mint.publicKey.toBase58(),metadataUri:'https://gateway.pinata.cloud/ipfs/'+'Q'.repeat(46),economics});
  const {transaction}=await buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BH,lastValidBlockHeight:9,lookupTable:table,computeUnitLimit:400000});
  transaction.sign([c]);same(transaction.serialize());
 }
});

test('matches web3.js on v0 without tables and on legacy transactions',()=>{
 const a=Keypair.generate(),b=Keypair.generate();
 const ixs=[ComputeBudgetProgram.setComputeUnitLimit({units:1}),SystemProgram.transfer({fromPubkey:a.publicKey,toPubkey:b.publicKey,lamports:123456789})];
 const v0=new VersionedTransaction(new TransactionMessage({payerKey:a.publicKey,recentBlockhash:BH,instructions:ixs}).compileToV0Message());v0.sign([a]);
 same(v0.serialize());
 const legacy=new Transaction({feePayer:a.publicKey,recentBlockhash:BH}).add(...ixs);legacy.sign(a);
 const p=parseTransaction(legacy.serialize());assert.equal(p.version,'legacy');assert.equal(p.staticAccountKeys[0],a.publicKey.toBase58());
});

test('rejects truncated, padded and unknown-version bytes',async()=>{
 const a=Keypair.generate();
 const v0=new VersionedTransaction(new TransactionMessage({payerKey:a.publicKey,recentBlockhash:BH,instructions:[SystemProgram.transfer({fromPubkey:a.publicKey,toPubkey:a.publicKey,lamports:1})]}).compileToV0Message());
 const bytes=v0.serialize();
 assert.throws(()=>parseTransaction(bytes.subarray(0,bytes.length-1)),/truncated/);
 assert.throws(()=>parseTransaction(Uint8Array.from([...bytes,0])),/trailing/);
 const v1=Uint8Array.from(bytes);v1[65]=0x81;assert.throws(()=>parseTransaction(v1),/version/);
});

test('base58 round-trips keys, including leading zero bytes, and config validates without web3.js',()=>{
 for(const k of [PublicKey.default,new PublicKey('11111111111111111111111111111112'),Keypair.generate().publicKey,new PublicKey('3kGQvw8K3iNXsts6RHhqxDCfMzHrMKa749mhFzV6pKMd')]){
  assert.equal(base58Encode(k.toBytes()),k.toBase58());assert.deepEqual([...base58Decode(k.toBase58())],[...k.toBytes()]);
 }
 assert.throws(()=>readEconomicsConfig({treasury:'1'.repeat(44),lookupTable:Keypair.generate().publicKey.toBase58()}),/treasury/,'44 ones is not 32 bytes');
 assert.ok(readEconomicsConfig({treasury:'3kGQvw8K3iNXsts6RHhqxDCfMzHrMKa749mhFzV6pKMd',lookupTable:Keypair.generate().publicKey.toBase58()}));
});
