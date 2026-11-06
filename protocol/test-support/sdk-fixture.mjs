/** Offline official SDK fixture adapter. Never connects to a network or real wallet. */
import {readFile} from 'node:fs/promises';
import {PublicKey} from '@solana/web3.js';
import {OnlinePumpAmmSdk} from '@pump-fun/pump-sdk/swap';
const directory=new URL('../tests/fixtures/6DNxwecbtdNNstpB5tdnxZsfGe3HmsNgEUZhdue4b1PH/',import.meta.url);
export async function officialSwapFixture(user){
 const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8')),accounts=new Map();
 for(const address of Object.values(manifest.accounts)){
  const {account}=JSON.parse(await readFile(new URL(`${address}.json`,directory),'utf8'));
  accounts.set(address,{...account,owner:new PublicKey(account.owner),data:Buffer.from(account.data[0],'base64')});
 }
 const connection={getMultipleAccountsInfo:async keys=>keys.map(k=>accounts.get(k.toBase58())??null)};
 const state=await new OnlinePumpAmmSdk(connection).swapSolanaState(new PublicKey(manifest.pool),user);
 const chosen=new PublicKey(manifest.buyback_fee_recipient);
 if(!state.globalConfig.buybackFeeRecipients.some(k=>k.equals(chosen)))throw Error('Captured buyback recipient is not in the captured global configuration.');
 // Select one already-listed recipient whose token account is in this fixture. Do not
 // mutate the on-chain global account, replace the SDK or mock instruction layouts.
 state.globalConfig={...state.globalConfig,buybackFeeRecipients:[chosen]};
 return {state,manifest,accounts,connection};
}
