// Nush fees: launch fee + 75/25 creator fee split, compiled through the Nush lookup table.
// REAL: Pump SDK instructions, web3.js compile/decompile, lookup-table encoding. MOCKED: the connection.
// Not proven here: that Pump's programs accept create + fee-sharing in ONE transaction. That needs a real
// mainnet simulation and is the first thing to check once the setup is done.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,TransactionInstruction} from '@solana/web3.js';
import {prepareLaunchPlan} from '../src/launchpad-plan.mjs';
import {buildLaunchTransaction,assertLaunchTransaction,expectedLaunchInstructions,PACKET_LIMIT,useLookupTable} from '../src/launchpad-create-tx.mjs';
import {readEconomicsConfig,economicsInstructions,lookupTableAddresses,loadLookupTable,LAUNCH_FEE_LAMPORTS,TREASURY_SHARE_BPS,CREATOR_SHARE_BPS} from '../src/nush-economics.mjs';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {altData,setupEconomics} from './helpers/nush-fixture.mjs';

const sdk=await loadPumpSdk();
const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const ALT_PROGRAM=new PublicKey('AddressLookupTab1e1111111111111111111111111');

async function launch({economics,table,name='Orbit'}){
 const creator=Keypair.generate(),mint=Keypair.generate();
 const plan=prepareLaunchPlan({form:{name,symbol:'ORB',description:'d'},creator:creator.publicKey.toBase58(),mint:mint.publicKey.toBase58(),metadataUri:'https://gateway.pinata.cloud/ipfs/'+'Q'.repeat(46),economics});
 const built=await buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BH,lastValidBlockHeight:100,lookupTable:table,computeUnitLimit:400000,computeUnitPriceMicroLamports:100000});
 return {...built,plan,creator,mint};
}

test('config: empty is off, half-configured or invalid is refused',()=>{
 assert.equal(readEconomicsConfig({}),null);assert.equal(readEconomicsConfig({treasury:'',lookupTable:' '}),null);
 const t=Keypair.generate().publicKey.toBase58(),l=Keypair.generate().publicKey.toBase58();
 assert.throws(()=>readEconomicsConfig({treasury:t}),/lookup table/);
 assert.throws(()=>readEconomicsConfig({lookupTable:l}),/treasury/);
 assert.throws(()=>readEconomicsConfig({treasury:'nope',lookupTable:l}),/treasury/);
 assert.throws(()=>readEconomicsConfig({treasury:t,lookupTable:t}),/differ/);
 const ok=readEconomicsConfig({treasury:` ${t} `,lookupTable:l});
 assert.equal(ok.treasury,t);assert.equal(ok.launchFeeLamports,10_000_000);assert.equal(ok.treasuryShareBps,2500);assert.ok(Object.isFrozen(ok));
 assert.equal(LAUNCH_FEE_LAMPORTS+0,10_000_000);assert.equal(TREASURY_SHARE_BPS+CREATOR_SHARE_BPS,10_000);
});

test('the lookup table holds only shared, non-program accounts, never the treasury',async()=>{
 const {treasury,addresses}=await setupEconomics();
 assert.ok(addresses.length>=10&&addresses.length<=20,`${addresses.length}`);
 assert.ok(!addresses.includes(treasury));
 for(const p of [sdk.PUMP_PROGRAM_ID,SystemProgram.programId])assert.ok(!addresses.includes(p.toBase58()));
 assert.deepEqual(await lookupTableAddresses(treasury),addresses,'deterministic');
});

test('a launch with fees fits the packet limit and carries create, config, 75/25 split and the 0.01 SOL fee',async()=>{
 const {economics,table}=await setupEconomics();
 for(const name of ['Orbit','x'.repeat(32)]){
  const {transaction,plan}=await launch({economics,table,name});
  const size=transaction.serialize().length;
  assert.ok(size<=PACKET_LIMIT,`size ${size}`);
  assert.equal(transaction.message.addressTableLookups.length,1);
  const ixs=TransactionMessage.decompile(transaction.message,{addressLookupTableAccounts:[table]}).instructions;
  const programs=ixs.map(ix=>ix.programId.toBase58());
  assert.deepEqual(programs.slice(2),[sdk.PUMP_PROGRAM_ID.toBase58(),'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ','pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',SystemProgram.programId.toBase58()]);
  const transfer=ixs.at(-1);
  assert.equal(transfer.keys[0].pubkey.toBase58(),plan.creator);assert.equal(transfer.keys[1].pubkey.toBase58(),economics.treasury);
  assert.equal(Buffer.from(transfer.data).readBigUInt64LE(4),10_000_000n);
  // shares: the update's data names creator 7500 and treasury 2500
  const update=Buffer.from(ixs.at(-2).data);
  const shares=[];for(let i=0;i<update.readUInt32LE(8);i++){const o=12+i*34;shares.push([new PublicKey(update.subarray(o,o+32)).toBase58(),update.readUInt16LE(o+32)]);}
  assert.deepEqual(shares,[[plan.creator,7500],[economics.treasury,2500]]);
 }
});

test('the inspector refuses a launch without the table, with another table, or with a changed fee',async()=>{
 const {economics,table}=await setupEconomics();
 const {transaction,plan,mint}=await launch({economics,table});
 assert.ok(await assertLaunchTransaction(transaction,plan,{computeUnitLimit:400000,computeUnitPriceMicroLamports:100000}));
 await assert.rejects(buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BH,lastValidBlockHeight:100}),/lookup table is required/);
 const other=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:table.state});
 await assert.rejects(buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BH,lastValidBlockHeight:100,lookupTable:other}),/lookup table is required/);
 // a transaction that pays 1 lamport instead of the fee, compiled with the same table, is refused
 const good=await expectedLaunchInstructions(plan,{});
 const cheap=[...good.slice(0,-1),SystemProgram.transfer({fromPubkey:new PublicKey(plan.creator),toPubkey:new PublicKey(economics.treasury),lamports:1})];
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(plan.creator),recentBlockhash:BH,instructions:cheap}).compileToV0Message([table]));
 await assert.rejects(assertLaunchTransaction(tx,plan,{}),/differs/);
 // the same launch with no fee instructions at all is refused
 const bare=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(plan.creator),recentBlockhash:BH,instructions:good.slice(0,1)}).compileToV0Message([table]));
 await assert.rejects(assertLaunchTransaction(bare,plan,{}),/unexpected instructions|Nush lookup table/);
 // a plan without economics refuses a lookup table
 const plain=prepareLaunchPlan({form:{name:'Plain',symbol:'PLN'},creator:plan.creator,mint:plan.mint,metadataUri:plan.metadataUri});
 await assert.rejects(assertLaunchTransaction(transaction,plain,{computeUnitLimit:400000,computeUnitPriceMicroLamports:100000}),/must not use address lookup tables/);
});

test('the creator cannot be the treasury',async()=>{
 const {economics}=await setupEconomics();
 assert.throws(()=>prepareLaunchPlan({form:{name:'Plain',symbol:'PLN'},creator:economics.treasury,mint:Keypair.generate().publicKey.toBase58(),metadataUri:'https://a.b/c',economics}),/treasury/);
 await assert.rejects(economicsInstructions({creator:economics.treasury,mint:Keypair.generate().publicKey.toBase58(),economics}),/treasury/);
});

test('loadLookupTable reads, checks owner and contents, and refuses a missing or short table',async()=>{
 const {economics,addresses}=await setupEconomics();
 const conn=info=>({getMultipleAccountsInfo:async()=>[info]});
 const good=await loadLookupTable({connection:conn({owner:ALT_PROGRAM,data:altData(addresses),lamports:1}),economics});
 assert.equal(good.key.toBase58(),economics.lookupTable);assert.equal(good.state.addresses.length,addresses.length);
 await assert.rejects(loadLookupTable({connection:conn(null),economics}),/not found/);
 await assert.rejects(loadLookupTable({connection:conn({owner:PublicKey.default,data:altData(addresses)}),economics}),/not an address lookup table/);
 await assert.rejects(loadLookupTable({connection:conn({owner:ALT_PROGRAM,data:altData(addresses.slice(2))}),economics}),/missing 2/);
 const extra=await loadLookupTable({connection:conn({owner:ALT_PROGRAM,data:altData([...addresses,Keypair.generate().publicKey.toBase58()])}),economics});
 assert.ok(extra,'extra entries are harmless: every launch is checked after decompiling');
});
