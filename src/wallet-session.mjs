import {PublicKey} from '@solana/web3.js';
const MAINNET='solana:mainnet';
export function validateWalletAccount(account){
 if(!account||!account.chains?.includes(MAINNET))throw Error('Choose a wallet account supporting Solana mainnet.');
 const address=new PublicKey(account.address),bytes=Uint8Array.from(account.publicKey??[]);
 if(bytes.length!==32||!address.equals(new PublicKey(bytes))||!PublicKey.isOnCurve(bytes))throw Error('Wallet public key does not match its address.');
 return account;
}
export function selectMainnetAccount(accounts){
 const account=accounts?.find(a=>a.chains?.includes(MAINNET));
 return validateWalletAccount(account);
}
/** Synchronous epochs invalidate approval work before React has a chance to render. */
export function createWalletSession(){
 let epoch=0,current=null;
 return {
  replace(wallet,account){validateWalletAccount(account);epoch++;current=Object.freeze({epoch,wallet,account,address:account.address});return current;},
  invalidate(){epoch++;current=null;},
  capture(){if(!current)throw Error('Connect a wallet first.');return current;},
  isCurrent(snapshot){return !!snapshot&&current===snapshot&&snapshot.epoch===epoch&&snapshot.account.address===snapshot.address;},
 };
}
export function walletCapabilities(wallet,account){
 const message=wallet?.features?.['solana:signMessage'],transaction=wallet?.features?.['solana:signTransaction'];
 return {messageSigning:typeof message?.signMessage==='function'&&!!account?.features?.includes('solana:signMessage'),versionedTransactions:typeof transaction?.signTransaction==='function'&&!!transaction.supportedTransactionVersions?.includes(0)&&!!account?.features?.includes('solana:signTransaction')};
}
