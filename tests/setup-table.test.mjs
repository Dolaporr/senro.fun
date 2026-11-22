import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableProgram,Keypair,PublicKey,TransactionMessage} from '@solana/web3.js';
import {buildLookupTableSetup} from '../src/setup-table.mjs';
import {lookupTableAddresses} from '../src/nush-economics.mjs';

test('setup creates, fills and freezes one table owned and paid by the treasury, in one small transaction',async()=>{
 const treasury=Keypair.generate().publicKey.toBase58();
 const {transaction,table,count}=await buildLookupTableSetup({treasury,recentSlot:123456,blockhash:PublicKey.default.toBase58()});
 assert.equal(count,(await lookupTableAddresses(treasury)).length);
 assert.ok(transaction.serialize().length<1232);
 assert.equal(transaction.message.header.numRequiredSignatures,1);assert.equal(transaction.message.staticAccountKeys[0].toBase58(),treasury);
 const ixs=TransactionMessage.decompile(transaction.message).instructions;
 assert.equal(ixs.length,3);for(const ix of ixs)assert.ok(ix.programId.equals(AddressLookupTableProgram.programId));
 assert.deepEqual(ixs.map(ix=>ix.data.readUInt32LE(0)),[0,2,1],'create, extend, freeze');
 const [,expected]=AddressLookupTableProgram.createLookupTable({authority:new PublicKey(treasury),payer:new PublicKey(treasury),recentSlot:123456});
 assert.equal(table,expected.toBase58());
 await assert.rejects(buildLookupTableSetup({treasury,recentSlot:0,blockhash:PublicKey.default.toBase58()}),/slot/);
});
