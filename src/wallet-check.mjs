// An off-chain diagnostic only. This module has no RPC, transaction or broadcast API.
import {PublicKey} from '@solana/web3.js';
import {hex} from './policy-client.mjs';
import {validateWalletAccount,walletCapabilities} from './wallet-session.mjs';
export function createWalletChallenge({address,origin,now=Date.now()}){
 const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','terminal.local'].includes(url.hostname)))throw Error('Wallet check requires a secure app origin.');
 const wallet=new PublicKey(address).toBase58(),nonce=hex(crypto.getRandomValues(new Uint8Array(32))),expiresAt=now+120000;
 const message=['SENRO wallet compatibility check','Purpose: test off-chain message signing only.','This is not a trade, transfer, token approval or login request.',`Origin: ${origin}`,`Wallet: ${wallet}`,`Nonce: ${nonce}`,`Issued at: ${new Date(now).toISOString()}`,`Expires at: ${new Date(expiresAt).toISOString()}`].join('\n');
 return Object.freeze({address:wallet,origin,nonce,message,issuedAt:now,expiresAt});
}
const used=new WeakSet();
export async function checkWalletMessage({session,snapshot,challenge,origin,now=Date.now}){
 function current(){if(!session.isCurrent(snapshot))throw Error('Wallet session changed. Start a new check.');if(now()>=challenge.expiresAt||challenge.origin!==origin||challenge.address!==snapshot.address)throw Error('Wallet check expired or belongs to another account or site.');validateWalletAccount(snapshot.account);}
 current();
 if(used.has(challenge))throw Error('Start a new check before asking for another signature.');
 const {wallet,account}=snapshot;
 if(!walletCapabilities(wallet,account).messageSigning)throw Error('This wallet does not support this message-signing check. Simulation is still available.');
 used.add(challenge);
 const message=new TextEncoder().encode(challenge.message);
 const output=await wallet.features['solana:signMessage'].signMessage({account,message:Uint8Array.from(message)});
 current();
 if(output?.length!==1)throw Error('Wallet returned an unexpected number of signatures.');
 const {signedMessage,signature,signatureType}=output[0];
 if(signatureType&&signatureType!=='ed25519'||!ArrayBuffer.isView(signedMessage)||!ArrayBuffer.isView(signature)||signature.byteLength!==64)throw Error('Wallet returned an unsupported signature.');
 const returned=Uint8Array.from(signedMessage);
 if(returned.length!==message.length||returned.some((b,i)=>b!==message[i]))throw Error('Wallet changed the diagnostic message.');
 const publicKey=await crypto.subtle.importKey('raw',new PublicKey(challenge.address).toBytes(),{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',publicKey,Uint8Array.from(signature),message))throw Error('Wallet returned an invalid message signature.');
 current();
 // Discard raw signature bytes. No authentication token, persistent proof or server call.
 return Object.freeze({address:challenge.address,checkedAt:now(),messageSigning:'verified',transactionSigning:'not-tested',versionedTransactionsAdvertised:walletCapabilities(wallet,account).versionedTransactions});
}
