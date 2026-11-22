// Nush launch economics: a flat launch fee and a share of each coin's Pump creator fees, both paid to the
// Nush treasury, in the SAME transaction as the launch so a coin cannot be launched through Nush without them.
//
// Agreed with the owner on 2026-11-22: 0.01 SOL per launch, 25% of creator fees (creator keeps 75%).
//
// The launch plus the two Pump fee-sharing instructions is about 1.44 KB, over Solana's 1232-byte limit, so
// the launch uses an address lookup table holding the Pump accounts that are the same for every launch.
// The table is created once by the treasury wallet (see /setup.html). Nothing here trusts the table: every
// launch is decompiled through it and compared account-for-account with the SDK's own instructions.
import {AddressLookupTableAccount,Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {loadPumpSdk} from './pump-sdk.mjs';

export const LAUNCH_FEE_LAMPORTS=10_000_000; // 0.01 SOL
export const TREASURY_SHARE_BPS=2_500; // 25%
export const CREATOR_SHARE_BPS=10_000-TREASURY_SHARE_BPS; // 75%
const BASE58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Validates deployment config. Returns null when nothing is configured, throws when it is half-configured. */
export function readEconomicsConfig({treasury,lookupTable}={}){
 const t=String(treasury??'').trim(),l=String(lookupTable??'').trim();
 if(!t&&!l)return null;
 if(!BASE58.test(t))throw Error('The Nush treasury address is missing or invalid.');
 if(!BASE58.test(l))throw Error('The Nush lookup table address is missing or invalid.');
 new PublicKey(t);new PublicKey(l);
 if(t===l)throw Error('Treasury and lookup table must differ.');
 return Object.freeze({treasury:t,lookupTable:l,launchFeeLamports:LAUNCH_FEE_LAMPORTS,treasuryShareBps:TREASURY_SHARE_BPS});
}

/** The fee instructions that follow create_v2: create the sharing config, split 75/25, pay the launch fee. */
export async function economicsInstructions({creator,mint,economics}){
 const {PUMP_SDK}=await loadPumpSdk();
 const owner=new PublicKey(creator),coin=new PublicKey(mint),treasury=new PublicKey(economics.treasury);
 if(owner.equals(treasury))throw Error('The creator wallet cannot be the Nush treasury.');
 return [
  await PUMP_SDK.createFeeSharingConfig({creator:owner,mint:coin,pool:null}),
  await PUMP_SDK.updateFeeShares({authority:owner,mint:coin,currentShareholders:[owner],
   newShareholders:[{address:owner,shareBps:CREATOR_SHARE_BPS},{address:treasury,shareBps:TREASURY_SHARE_BPS}],bondingCurveComplete:false}),
  SystemProgram.transfer({fromPubkey:owner,toPubkey:treasury,lamports:LAUNCH_FEE_LAMPORTS})
 ];
}

/**
 * The accounts every Nush launch shares: present in two launches by different creators and mints, and not a
 * program id (programs must stay static) or the treasury (kept static so the fee transfer is plain to see).
 */
export async function lookupTableAddresses(treasury){
 const {PUMP_SDK}=await loadPumpSdk();
 const t=new PublicKey(treasury),economics={treasury:t.toBase58()};
 const sample=async seed=>{
  const creator=Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey,mint=Keypair.fromSeed(new Uint8Array(32).fill(seed+100)).publicKey;
  const create=await PUMP_SDK.createV2Instruction({mint,name:'N',symbol:'N',uri:'https://nush.fun/m.json',creator,user:creator,mayhemMode:false});
  return [create,...await economicsInstructions({creator,mint,economics})];
 };
 const [a,b]=await Promise.all([sample(1),sample(2)]);
 const programs=new Set([...a,...b].map(ix=>ix.programId.toBase58()));
 const keysOf=ixs=>new Set(ixs.flatMap(ix=>ix.keys.map(k=>k.pubkey.toBase58())));
 const kb=keysOf(b);
 return [...keysOf(a)].filter(k=>kb.has(k)&&!programs.has(k)&&k!==t.toBase58()).sort();
}

/**
 * Reads the lookup table through the launch connection and checks it holds every shared account. Extra or
 * missing entries never change what is signed (the launch is verified after decompiling), but a table
 * missing entries would make the launch too large, so it is refused here with a clear message.
 */
export async function loadLookupTable({connection,economics}){
 const key=new PublicKey(economics.lookupTable);
 const [info]=await connection.getMultipleAccountsInfo([key],'confirmed');
 if(!info)throw Error('The Nush lookup table was not found on-chain. Finish the one-time setup first.');
 if(!info.owner.equals(new PublicKey('AddressLookupTab1e1111111111111111111111111')))throw Error('The configured lookup table is not an address lookup table.');
 const table=new AddressLookupTableAccount({key,state:AddressLookupTableAccount.deserialize(info.data)});
 const have=new Set(table.state.addresses.map(a=>a.toBase58()));
 const missing=(await lookupTableAddresses(economics.treasury)).filter(a=>!have.has(a));
 if(missing.length)throw Error(`The Nush lookup table is missing ${missing.length} account(s). Run the setup again.`);
 return table;
}
