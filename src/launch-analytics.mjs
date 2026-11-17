// Creator analytics, read-only. Nothing here signs, claims or sends.
//
// Per launch: bonding-curve progress toward graduation, spot price and market cap in SOL, and the SOL held
// in the curve. Per creator: the Pump creator fee vault balance. That vault is shared by every Pump coin the
// wallet created, so it is shown once, not per launch, and it is not split between launches.
//
// Every number is derived from on-chain accounts decoded by the installed Pump SDK. SENRO takes no fee and
// no fee split is assumed here.
import {PublicKey} from '@solana/web3.js';
import {loadPumpSdk} from './pump-sdk.mjs';

export const TOKEN_DECIMALS=6;
export const RENT_EXEMPT_EMPTY=890_880n; // rent-exempt minimum for a 0-byte account, kept in the vault
const big=v=>BigInt(v.toString());

/** Pure maths on decoded accounts. Values are bigint lamports / raw units; percentages are basis points. */
export function curveStats(curve,global){
 const vQ=big(curve.virtualQuoteReserves),vT=big(curve.virtualTokenReserves),real=big(curve.realTokenReserves);
 const initial=big(global.initialRealTokenReserves),supply=big(curve.tokenTotalSupply);
 if(vT===0n)throw Error('The curve has no virtual token reserves.');
 let progressBps;
 if(curve.complete)progressBps=10_000;
 else if(initial===0n)progressBps=0;
 else{const sold=initial>real?initial-real:0n;progressBps=Number(sold*10_000n/initial);if(progressBps>10_000)progressBps=10_000;}
 return {
  complete:!!curve.complete,
  progressBps,
  // lamports per whole token (10^6 raw units)
  priceLamports:vQ*10n**BigInt(TOKEN_DECIMALS)/vT,
  marketCapLamports:vQ*supply/vT,
  curveSolLamports:big(curve.realQuoteReserves)
 };
}

export const claimableLamports=vaultLamports=>{const v=BigInt(vaultLamports??0);return v>RENT_EXEMPT_EMPTY?v-RENT_EXEMPT_EMPTY:0n;};

/** Lamports to a short SOL string; small values keep three significant digits instead of rounding to zero. */
export function formatSol(lamports){
 const sol=Number(BigInt(lamports))/1e9;
 if(sol===0)return '0 SOL';
 if(sol>=1000)return `${Math.round(sol).toLocaleString('en-US')} SOL`;
 if(sol>=1)return `${sol.toFixed(2)} SOL`;
 return `${Number(sol.toPrecision(3))} SOL`;
}

/**
 * Reads the Pump Global account and the creator vault, then every launch curve in batches of 8 (the launch
 * relay's per-call limit). A failed batch marks only those launches unavailable.
 */
export async function readCreatorAnalytics({connection,creator,mints,commitment='confirmed'}){
 const {PUMP_SDK,PUMP_PROGRAM_ID,GLOBAL_PDA,creatorVaultPda,bondingCurvePda,feeSharingConfigPda}=await loadPumpSdk();
 const owner=new PublicKey(creator);
 const [globalInfo,vaultInfo]=await connection.getMultipleAccountsInfo([GLOBAL_PDA,creatorVaultPda(owner)],commitment);
 if(!globalInfo||!globalInfo.owner.equals(PUMP_PROGRAM_ID))throw Error('The Pump global account could not be read.');
 const global=PUMP_SDK.decodeGlobal(globalInfo);
 const vaultLamports=BigInt(vaultInfo?.lamports??0);
 const launches={};
 for(let i=0;i<mints.length;i+=8){
  const batch=mints.slice(i,i+8);
  let infos;
  try{infos=await connection.getMultipleAccountsInfo(batch.map(m=>bondingCurvePda(new PublicKey(m))),commitment);}
  catch{for(const m of batch)launches[m]={available:false,reason:'The network could not be reached.'};continue;}
  batch.forEach((mint,n)=>{
   const info=infos[n];
   if(!info||!info.owner.equals(PUMP_PROGRAM_ID)){launches[mint]={available:false,reason:'No bonding curve found.'};return;}
   try{
    const curve=PUMP_SDK.decodeBondingCurve(info);
    const sharedFees=curve.creator.equals(feeSharingConfigPda(new PublicKey(mint)));
    launches[mint]={available:true,...curveStats(curve,global),sharedFees};
   }catch{launches[mint]={available:false,reason:'The bonding curve could not be read.'};}
  });
 }
 return {creator:owner.toBase58(),vaultLamports,claimableLamports:claimableLamports(vaultLamports),launches,readAt:Date.now()};
}
