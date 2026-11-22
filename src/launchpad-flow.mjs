// Launch orchestration. The UI is a thin view over this state machine.
//
//   idle -> uploading -> building -> simulating -> ready            (no funds can move up to here)
//   ready -> launch(messageHash) -> signing -> submitting -> confirming -> launched | failed | expired | unknown
//
// Rules enforced here, not in the UI:
//  - Nothing is signed or sent unless `enabled` is true (a deployment decision made with explicit approval).
//  - launch() needs the exact message hash the user reviewed, and re-simulates right before signing so a
//    stale simulation can never be used.
//  - The mint keypair lives only in this closure; it is never serialized or logged.
//  - There is no retry. A submission whose outcome is unknown must be reconciled by signature.
import {Keypair} from '@solana/web3.js';
import {validateLaunch} from './launchpad-model.mjs';
import {prepareLaunchPlan} from './launchpad-plan.mjs';
import {loadLookupTable} from './nush-economics.mjs';
import {buildLaunchTransaction,simulateLaunch,signLaunchWithWallet,submitLaunch,verifyLaunchedMint} from './launchpad-create-tx.mjs';

export const DISABLED_REASON='Live launches are not enabled in this deployment. Everything up to simulation runs; nothing is signed or sent.';
const sameMetadata=(form,doc)=>doc&&doc.name===form.name&&doc.symbol===form.symbol;

export function createLaunchFlow({enabled=false,economics=null,requireEconomics=false,connection,wallet,account,upload,newMint=()=>Keypair.generate(),now=Date.now,confirm={},persist=()=>{},onLaunched=()=>{}}){
 let state={stage:'idle'},generation=0,session=null;
 const listeners=new Set();
 const set=(patch,gen=generation)=>{if(gen!==generation)return false;state={...patch};listeners.forEach(fn=>fn(state));return true;};
 const fail=(gen,error,stage='error')=>set({stage,error:String(error?.message??error).slice(0,300),fields:error?.fields},gen);

 async function prepare(form){
  const gen=++generation;session=null;
  const result=validateLaunch(form);
  if(!result.valid)return set({stage:'invalid',errors:result.errors},gen),state;
  if(!account?.address)return fail(gen,'Connect a wallet first.'),state;
  if(requireEconomics&&!economics)return fail(gen,'Launch fees are not set up on this site yet. Nothing was launched.'),state;
  if(economics&&account.address===economics.treasury)return fail(gen,'The Nush treasury wallet cannot launch tokens. Connect a different wallet.'),state;
  try{
   set({stage:'uploading'},gen);
   const uploaded=await upload({form,wallet,account});
   if(gen!==generation)return state;
   if(!sameMetadata(result.metadata,uploaded.metadata))throw Error('The stored metadata does not match what you entered. Nothing was launched.');
   set({stage:'building'},gen);
   const mintKeypair=newMint();
   const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash('confirmed');
   const lookupTable=economics?await loadLookupTable({connection,economics}):undefined;
   const plan=prepareLaunchPlan({form,creator:account.address,mint:mintKeypair.publicKey.toBase58(),metadataUri:uploaded.metadataUri,economics});
   const {transaction,binding}=await buildLaunchTransaction({plan,mintKeypair,blockhash,lastValidBlockHeight,lookupTable});
   if(gen!==generation)return state;
   set({stage:'simulating'},gen);
   const simulation=await simulateLaunch({connection,transaction,binding,plan,now});
   if(gen!==generation)return state;
   session={plan,transaction,binding,mintKeypair};
   const review={name:plan.name??form.name,symbol:plan.symbol??form.symbol,creator:binding.creator,mint:binding.mint,metadataUri:uploaded.metadataUri,imageUri:uploaded.imageUri,messageHash:binding.messageHash,lastValidBlockHeight,feeLamports:simulation.feeLamports,creatorDebitLamports:simulation.creatorDebitLamports,unitsConsumed:simulation.unitsConsumed,simulatedAt:simulation.simulatedAt,fees:economics?{launchFeeLamports:economics.launchFeeLamports,treasuryShareBps:economics.treasuryShareBps,treasury:economics.treasury}:null};
   if(simulation.err)return set({stage:'simulation-failed',review,error:'Simulation failed. Nothing was signed.',err:simulation.err,logs:simulation.logs.slice(-12)},gen),state;
   set({stage:'ready',review,enabled,disabledReason:enabled?null:DISABLED_REASON},gen);
  }catch(e){fail(gen,e);}
  return state;
 }

 async function launch({messageHash}={}){
  const gen=generation;
  if(!enabled)return set({...state,stage:'blocked',error:DISABLED_REASON},gen),state;
  if(state.stage!=='ready'||!session)throw Error('Prepare and review the launch first.');
  if(messageHash!==session.binding.messageHash)throw Error('Approval does not match the reviewed transaction.');
  const {plan,transaction,binding,mintKeypair}=session;
  try{
   set({stage:'signing',review:state.review},gen);
   const simulation=await simulateLaunch({connection,transaction,binding,plan,now});
   if(simulation.err)return set({stage:'simulation-failed',review:state.review,error:'Simulation failed just before signing. Nothing was signed.',err:simulation.err,logs:simulation.logs.slice(-12)},gen),state;
   const signed=await signLaunchWithWallet({wallet,account,transaction,binding,mintKeypair});
   set({stage:'submitting',review:state.review},gen);
   const outcome=await submitLaunch({connection,plan,binding,simulation,signedTransaction:signed,now,...confirm,onSubmitted:({signature,lastValidBlockHeight})=>{
    persist({signature,mint:binding.mint,creator:binding.creator,lastValidBlockHeight});
    set({stage:'confirming',review:state.review,signature},gen);
   }});
   session=null;
   if(outcome.status==='confirmed'){
    try{
     const chain=await verifyLaunchedMint({connection,plan});
     // Recording is best effort: a storage problem must never turn a real launch into an error.
     try{onLaunched({signature:outcome.signature,slot:outcome.slot,mint:binding.mint,creator:binding.creator,name:state.review.name,symbol:state.review.symbol,metadataUri:state.review.metadataUri,imageUri:state.review.imageUri,state:'live'});}catch{}
     return set({stage:'launched',review:state.review,signature:outcome.signature,slot:outcome.slot,chain},gen),state;
    }
    catch(e){return set({stage:'unverified',review:state.review,signature:outcome.signature,error:`Confirmed, but the on-chain check failed: ${e.message}`},gen),state;}
   }
   const messages={failed:'The transaction failed on-chain. Check the signature before trying again.',expired:'The transaction expired without landing. Prepare a new launch.',unknown:'Confirmation is still unknown. Check the signature before doing anything else; do not resubmit.'};
   set({stage:outcome.status,review:state.review,signature:outcome.signature,error:messages[outcome.status],err:outcome.err},gen);
  }catch(e){
   session=e.signature?null:session;
   fail(gen,e,e.signature?'unknown':'error');
   if(e.signature)state={...state,signature:e.signature};
  }
  return state;
 }

 return {
  get state(){return state;},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  prepare,launch,
  cancel(){generation++;session=null;state={stage:'idle'};listeners.forEach(fn=>fn(state));}
 };
}
