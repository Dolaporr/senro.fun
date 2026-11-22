// Shared fixture: a Nush treasury and a lookup table encoded exactly as the on-chain program stores it.
import {AddressLookupTableAccount,Keypair,PublicKey} from '@solana/web3.js';
import {readEconomicsConfig,lookupTableAddresses} from '../../src/nush-economics.mjs';

/** Encodes lookup-table account data the way the on-chain program stores it (56-byte header + keys). */
export function altData(addresses){
 const buf=Buffer.alloc(56+32*addresses.length);
 buf.writeUInt32LE(1,0);buf.writeBigUInt64LE(0xffffffffffffffffn,4);buf.writeBigUInt64LE(1n,12);buf.writeUInt8(0,20);buf.writeUInt8(0,21);
 addresses.forEach((a,i)=>new PublicKey(a).toBuffer().copy(buf,56+32*i));
 return buf;
}
export async function setupEconomics(){
 const treasury=Keypair.generate().publicKey.toBase58(),tableKey=Keypair.generate().publicKey;
 const addresses=await lookupTableAddresses(treasury);
 const table=new AddressLookupTableAccount({key:tableKey,state:AddressLookupTableAccount.deserialize(altData(addresses))});
 const economics=readEconomicsConfig({treasury,lookupTable:tableKey.toBase58()});
 return {treasury,table,economics,addresses};
}
