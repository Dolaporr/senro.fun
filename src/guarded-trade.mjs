import {Buffer} from 'buffer';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {sha256,hex,parseAmount} from './policy-client.mjs';
import {LOCAL_PROGRAM_ID,POLICY_LENGTH,policyAddress,policyFingerprint,decodePolicy,createPolicyInstruction,updatePolicyInstruction,guardPumpSwapInstructions} from '../protocol/client/guard.mjs';
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const key=x=>new PublicKey(x);
const digest=async bytes=>hex(await sha256(bytes));
export function deploymentReady(d){
 if(d?.enabled!==true||!d.programId||!d.programData||!/^\w{64}$/.test(d.executableSha256??'')||!/^[0-9a-f]{64}$/.test(d.executableSha256))return false;
 try{return !key(d.programId).equals(LOCAL_PROGRAM_ID)&&!key(d.programId).equals(PublicKey.default)&&!!key(d.programData)&&(d.upgradeAuthority===null||!!key(d.upgradeAuthority));}catch{return false;}
}
export function requireSupportedDraft(config){
 if(!config.capOn||config.quote!=='SOL'||parseAmount(config.cap,9)===0n)throw Error('Guarded buys require an enabled SOL trade cap.');
 if(config.rollingOn||config.cooldownOn||config.accountOn)throw Error('This guard supports trade caps only. Turn off rolling volume, sell cooldown and account balance rules for guarded trading.');
}
export async function verifyDeployment(connection,d,minContextSlot=0){
 if(!deploymentReady(d))throw Error('Guarded trading is unavailable until a verified deployment is configured.');
 if(await connection.getGenesisHash()!==MAINNET)throw Error('Guarded trading requires Solana mainnet.');
 const response=await connection.getMultipleAccountsInfoAndContext([key(d.programId),key(d.programData)],{commitment:'confirmed',minContextSlot});
 if(response.context.slot<minContextSlot)throw Error('RPC returned a stale deployment snapshot.');
 const [program,programData]=response.value;
 if(!program?.executable||!program.owner.equals(LOADER)||program.data.length!==36||program.data.readUInt32LE(0)!==2||!new PublicKey(program.data.subarray(4,36)).equals(key(d.programData)))throw Error('Guard program does not match the configured deployment.');
 const bytes=programData?.data;
 if(!programData||programData.executable||!programData.owner.equals(LOADER)||!bytes||bytes.length<45||bytes.readUInt32LE(0)!==3||bytes[12]>1)throw Error('Invalid guard programdata account.');
 const authority=bytes[12]===1?new PublicKey(bytes.subarray(13,45)).toBase58():null;
 if(authority!==d.upgradeAuthority||await digest(bytes.subarray(45))!==d.executableSha256)throw Error('Guard code or upgrade authority changed. Trading is disabled.');
 return response.context.slot;
}
export async function prepareGuardedInstructions({connection,deployment,market,wallet,config,instructions,maxNativeDebit}){
 requireSupportedDraft(config);
 if(market.venue!=='PumpSwap')throw Error('Guarded trading supports canonical SOL PumpSwap buys only.');
 if(typeof maxNativeDebit!=='bigint'||maxNativeDebit<0n)throw Error('Review an explicit maximum additional CPI SOL debit.');
 const verifiedSlot=await verifyDeployment(connection,deployment,market.slot);
 const programId=key(deployment.programId),user=key(wallet),mint=key(market.mint),pool=key(market.venueAddress),tokenProgram=key(market.tokenProgram),cap=parseAmount(config.cap,9);
 const [address,bump]=policyAddress({programId,wallet:user,mint,pool});
 const snapshot=await connection.getAccountInfoAndContext(address,{commitment:'confirmed',minContextSlot:verifiedSlot});
 if(snapshot.context.slot<verifiedSlot)throw Error('RPC returned a stale policy snapshot.');
 const original=snapshot.value;let policy,write=[],action='Keep existing cap';
 // A prefunded system account is accepted by the program, but the browser conservatively
 // refuses occupied addresses of any other owner or unexpected layout.
 if(!original){policy={wallet:user,mint,pool,tokenProgram,maxQuote:cap,revision:1n,nonce:0n,bump,active:true};write=[createPolicyInstruction({programId,wallet:user,mint,pool,tokenProgram,maxQuote:cap})];action='Create wallet policy';}
 else{
  if(!original.owner.equals(programId)||original.executable)throw Error('Unexpected policy account owner.');
  policy=decodePolicy(original.data);
  if(!policy.wallet.equals(user)||!policy.mint.equals(mint)||!policy.pool.equals(pool)||!policy.tokenProgram.equals(tokenProgram)||policy.bump!==bump)throw Error('Policy does not match this wallet and market.');
  if(policy.maxQuote!==cap||!policy.active){write=[updatePolicyInstruction({programId,policy:address,wallet:user,expectedRevision:policy.revision,maxQuote:cap,active:true})];policy={...policy,maxQuote:cap,revision:policy.revision+1n,active:true};action='Update wallet policy';}
 }
 const deadlineSlot=BigInt(snapshot.context.slot)+100n;
 const guarded=guardPumpSwapInstructions({instructions,programId,policy,policyAddress:address,deadlineSlot,maxNativeDebit});
 const rent=original?0:await connection.getMinimumBalanceForRentExemption(POLICY_LENGTH,'confirmed');
 return {instructions:[...write,...guarded],guard:{programId:programId.toBase58(),policyAddress:address.toBase58(),policyBefore:original?await digest(original.data):null,policyHash:hex(policyFingerprint(policy,programId)),nonce:policy.nonce.toString(),deadlineSlot:deadlineSlot.toString(),maxQuote:cap.toString(),maxNativeDebit:maxNativeDebit.toString(),policyRent:rent,policyAction:action,minContextSlot:snapshot.context.slot}};
}
export async function sealGuardReview(result,transaction){
 if(!result.ok||result.enforcement!=='senro-guard'||!result.guard||result.checks.some(c=>c.state==='block'||c.state==='unknown'))throw Error('Only a successful guarded simulation can be reviewed.');
 const bytes=transaction.serialize(),messageHash=await digest(transaction.message.serialize());
 if(messageHash!==result.messageHash)throw Error('Simulation message changed.');
 return Object.freeze({wire:Buffer.from(bytes).toString('base64'),messageHash,requestFingerprint:result.requestFingerprint,expiresAt:result.expiresAt,blockhash:result.blockhash,lastValidBlockHeight:result.lastValidBlockHeight,wallet:result.request.wallet,guard:Object.freeze({...result.guard})});
}
export function base58(bytes){let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let text='';const chars='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';while(n){text=chars[Number(n%58n)]+text;n/=58n;}let zeros=0;while(zeros<bytes.length&&bytes[zeros]===0)zeros++;return '1'.repeat(zeros)+text;}
async function checkReview({connection,deployment,ticket,fingerprint,isCurrent,now}){
 if(!isCurrent()||fingerprint!==ticket.requestFingerprint)throw Error('Trade inputs changed. Review a fresh simulation.');
 if(now()>=ticket.expiresAt)throw Error('Trade review expired. Simulate again.');
 if(ticket.guard.programId!==deployment.programId)throw Error('Deployment changed.');
 await verifyDeployment(connection,deployment,ticket.guard.minContextSlot);
 const snapshot=await connection.getAccountInfoAndContext(key(ticket.guard.policyAddress),{commitment:'confirmed',minContextSlot:ticket.guard.minContextSlot});
 if(snapshot.context.slot<ticket.guard.minContextSlot)throw Error('RPC returned a stale policy snapshot.');
 const account=snapshot.value;
 if(ticket.guard.policyBefore===null?account!==null:!account||!account.owner.equals(key(deployment.programId))||await digest(account.data)!==ticket.guard.policyBefore)throw Error('Policy or nonce changed. Simulate again.');
 const [epoch,height]=await Promise.all([connection.getEpochInfo('confirmed'),connection.getBlockHeight('confirmed')]);
 if(BigInt(epoch.absoluteSlot)>=BigInt(ticket.guard.deadlineSlot)||height>ticket.lastValidBlockHeight)throw Error('Trade deadline expired. Simulate again.');
 if(!isCurrent()||now()>=ticket.expiresAt)throw Error('Trade review changed or expired. Simulate again.');
}
// Sign only (never wallet sign-and-send), inspect exactly what the wallet returned, then
// submit once. Transport errors carry the locally derived signature: never auto-rebuy.
const consumedReviews=new WeakSet();
export async function signAndSubmitGuarded({connection,deployment,ticket,fingerprint,wallet,account,isCurrent=()=>true,onProgress=()=>{},onSubmitted=()=>{},now=Date.now}){
 if(!ticket||!deploymentReady(deployment))throw Error('Guarded trading is unavailable.');
 if(consumedReviews.has(ticket))throw Error('This review was already used. Simulate again.');
 consumedReviews.add(ticket);
 const feature=wallet?.features?.['solana:signTransaction'];
 if(!feature?.supportedTransactionVersions?.includes(0)||!account?.features?.includes('solana:signTransaction')||account.address!==ticket.wallet||!account.chains.includes('solana:mainnet'))throw Error('Connect a mainnet wallet supporting versioned transaction signing.');
 const original=VersionedTransaction.deserialize(Buffer.from(ticket.wire,'base64'));
 if(original.signatures.length!==1||original.signatures[0].some(Boolean)||!original.message.staticAccountKeys[0].equals(key(ticket.wallet))||await digest(original.message.serialize())!==ticket.messageHash)throw Error('Invalid reviewed transaction.');
 await checkReview({connection,deployment,ticket,fingerprint,isCurrent,now});
 onProgress('Approve in your wallet');
 const output=await feature.signTransaction({account,chain:'solana:mainnet',transaction:original.serialize()});
 if(output?.length!==1)throw Error('Wallet returned an unexpected transaction count.');
 const signed=VersionedTransaction.deserialize(output[0].signedTransaction);
 if(signed.signatures.length!==1||signed.serialize().length>1232||await digest(signed.message.serialize())!==ticket.messageHash)throw Error('Wallet changed the reviewed transaction. Nothing was submitted by SENRO.');
 const publicKey=await crypto.subtle.importKey('raw',key(ticket.wallet).toBytes(),{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',publicKey,signed.signatures[0],signed.message.serialize()))throw Error('Wallet returned an invalid signature.');
 await checkReview({connection,deployment,ticket,fingerprint,isCurrent,now});
 const signature=base58(signed.signatures[0]);
 onSubmitted({signature,state:'pending',lastValidBlockHeight:ticket.lastValidBlockHeight});
 onProgress('Submitting guarded buy');
 try{
  const received=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0,minContextSlot:ticket.guard.minContextSlot});
  if(received!==signature)throw Error('RPC returned a different signature');
 }catch{
  return {signature,state:'unknown',lastValidBlockHeight:ticket.lastValidBlockHeight};
 }
 return {signature,state:'pending',lastValidBlockHeight:ticket.lastValidBlockHeight};
}
export async function checkGuardedConfirmation(connection,receipt){
 const result=await connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true}),status=result.value[0];
 if(status?.err)return {...receipt,state:'failed',error:status.err};
 if(status&&(status.confirmationStatus==='confirmed'||status.confirmationStatus==='finalized'))return {...receipt,state:'confirmed'};
 if(status)return {...receipt,state:'pending'};
 // An absent status after expiry can also mean an unavailable history node. Do not
 // interpret it as proof that nothing landed or automatically enable a second buy.
 if(await connection.getBlockHeight('confirmed')>receipt.lastValidBlockHeight)return {...receipt,state:'unknown'};
 return {...receipt,state:'pending'};
}
