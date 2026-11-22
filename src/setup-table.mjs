// Builds the one-time transaction that creates and freezes the Nush address lookup table.
// The treasury wallet signs and sends it itself (Wallet Standard signAndSendTransaction); the launch relay is
// only used to read a recent slot and blockhash. Freezing makes the table permanent: nobody, including the
// treasury, can change its entries afterwards, so creators can trust it.
import {AddressLookupTableProgram,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {lookupTableAddresses} from './nush-economics.mjs';

export async function buildLookupTableSetup({treasury,recentSlot,blockhash}){
 const authority=new PublicKey(treasury);
 if(!Number.isSafeInteger(recentSlot)||recentSlot<=0)throw Error('A recent slot is required.');
 const addresses=(await lookupTableAddresses(authority.toBase58())).map(a=>new PublicKey(a));
 const [create,table]=AddressLookupTableProgram.createLookupTable({authority,payer:authority,recentSlot});
 const extend=AddressLookupTableProgram.extendLookupTable({lookupTable:table,authority,payer:authority,addresses});
 const freeze=AddressLookupTableProgram.freezeLookupTable({lookupTable:table,authority});
 const message=new TransactionMessage({payerKey:authority,recentBlockhash:blockhash,instructions:[create,extend,freeze]}).compileToV0Message();
 return {transaction:new VersionedTransaction(message),table:table.toBase58(),count:addresses.length};
}
