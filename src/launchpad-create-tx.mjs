// Pump token creation: build, inspect, simulate, submit and verify.
//
// Everything here is derived from the installed @pump-fun/pump-sdk (create_v2). The transaction is
// rebuilt from the validated launch plan and compared byte-for-byte with what is about to be signed
// or sent, so a swapped account, program, instruction or data blob is rejected.
//
// Scope of this version: launch WITHOUT an initial buy (SOL-quoted curve, no mayhem mode, no holder
// reward, no custom creator fee). An initial buy stays disabled until its quote, slippage and
// fee/rent maths are verified against a live Global account.
import {Buffer} from 'buffer';
import {ComputeBudgetProgram,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {sha256,hex} from './policy-client.mjs';
import {base58} from './guarded-trade.mjs';
import {assertSimulatedLaunch} from './launchpad-plan.mjs';
import {loadPumpSdk} from './pump-sdk.mjs';

export const PACKET_LIMIT=1232;
export const GENESIS_HASH=Object.freeze({
 'mainnet-beta':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
 devnet:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
});
export const MAX_COMPUTE_UNIT_LIMIT=1_400_000;
export const MAX_COMPUTE_UNIT_PRICE=1_000_000; // micro-lamports per CU

const TOKEN_PROGRAMS=[
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
].map(a=>new PublicKey(a));

const pumpSdk=loadPumpSdk;
const digest=async bytes=>hex(await sha256(bytes));

function boundedInt(value,label,max,min=0){
 if(value==null)return undefined;
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error(`${label} must be an integer between ${min} and ${max}.`);
 return value;
}
function computeOptions({computeUnitLimit,computeUnitPriceMicroLamports}={}){
 return {
  computeUnitLimit:boundedInt(computeUnitLimit,'Compute unit limit',MAX_COMPUTE_UNIT_LIMIT,1),
  computeUnitPriceMicroLamports:boundedInt(computeUnitPriceMicroLamports,'Compute unit price',MAX_COMPUTE_UNIT_PRICE,0)
 };
}
function assertPlan(plan){
 if(!plan||plan.version!==1||plan.chain!=='solana'||plan.venue!=='pump'||plan.execution!=='not-enabled')throw Error('Unknown launch plan.');
 if(plan.initialBuyLamports!=='0')throw Error('Launch with an initial buy is disabled until its quote and fee maths are verified. Set the initial buy to 0.');
 if(!plan.metadata?.name||!plan.metadata?.symbol)throw Error('Launch plan is missing token details.');
}

/** Stable digest of the validated plan; binds a prepared transaction to the exact reviewed inputs. */
export const launchPlanDigest=plan=>digest(new TextEncoder().encode(JSON.stringify(plan)));

/** Message hash that wallets, simulations and submissions are all compared against. */
export const launchMessageHash=tx=>digest(tx.message.serialize());

/** Instructions the plan must compile to. The only source of truth for what may be signed. */
export async function expectedLaunchInstructions(plan,options={}){
 assertPlan(plan);
 const {computeUnitLimit,computeUnitPriceMicroLamports}=computeOptions(options);
 const {PUMP_SDK}=await pumpSdk();
 const creator=new PublicKey(plan.creator),mint=new PublicKey(plan.mint);
 const instructions=[];
 if(computeUnitLimit!==undefined)instructions.push(ComputeBudgetProgram.setComputeUnitLimit({units:computeUnitLimit}));
 if(computeUnitPriceMicroLamports!==undefined)instructions.push(ComputeBudgetProgram.setComputeUnitPrice({microLamports:computeUnitPriceMicroLamports}));
 instructions.push(await PUMP_SDK.createV2Instruction({
  mint,name:plan.metadata.name,symbol:plan.metadata.symbol,uri:plan.metadataUri,
  creator,user:creator,mayhemMode:false
 }));
 return instructions;
}

const sameKeys=(a,b)=>a.length===b.length&&a.every((k,i)=>k.pubkey.equals(b[i].pubkey)&&k.isSigner===b[i].isSigner&&k.isWritable===b[i].isWritable);

/**
 * Throws unless `tx` is exactly the SDK's create_v2 transaction for `plan`: version 0, no address
 * lookup tables, fee payer = creator, signers = {creator, mint}, within the packet limit, and every
 * instruction identical (program, accounts, flags, data) to the SDK output.
 */
export async function assertLaunchTransaction(tx,plan,options={}){
 const expected=await expectedLaunchInstructions(plan,options);
 const creator=new PublicKey(plan.creator),mint=new PublicKey(plan.mint);
 if(tx.version!==0)throw Error('Launch transaction must be a v0 message.');
 const message=tx.message;
 if(message.addressTableLookups.length)throw Error('Launch transaction must not use address lookup tables.');
 if(!message.staticAccountKeys[0].equals(creator))throw Error('Fee payer must be the creator wallet.');
 if(message.header.numRequiredSignatures!==2)throw Error('Launch needs exactly two signers: the creator and the new mint.');
 const signers=message.staticAccountKeys.slice(0,2);
 if(!signers[0].equals(creator)||!signers[1].equals(mint))throw Error('Launch signers do not match the plan.');
 if(tx.serialize().length>PACKET_LIMIT)throw Error('Launch transaction exceeds the packet limit.');
 const actual=TransactionMessage.decompile(message).instructions;
 if(actual.length!==expected.length)throw Error('Launch transaction has unexpected instructions.');
 actual.forEach((ix,i)=>{
  const want=expected[i];
  if(!ix.programId.equals(want.programId)||!Buffer.from(ix.data).equals(Buffer.from(want.data))||!sameKeys(ix.keys,want.keys))throw Error(`Launch instruction ${i} differs from the verified SDK instruction.`);
 });
 return true;
}

/**
 * Builds the unsigned launch transaction. The mint keypair signs its own slot here (create_v2
 * needs the mint as a signer); the creator signature is left empty for the wallet.
 * The mint keypair must live only in memory and be discarded after the launch settles or expires.
 */
export async function buildLaunchTransaction({plan,mintKeypair,blockhash,lastValidBlockHeight,...compute}={}){
 assertPlan(plan);
 const options=computeOptions(compute);
 if(!mintKeypair?.publicKey||mintKeypair.publicKey.toBase58()!==plan.mint)throw Error('Mint signer does not match the launch plan.');
 let bh;try{bh=new PublicKey(blockhash)}catch{throw Error('A valid recent blockhash is required.');}
 if(!Number.isSafeInteger(lastValidBlockHeight)||lastValidBlockHeight<=0)throw Error('A valid last-valid block height is required.');
 const instructions=await expectedLaunchInstructions(plan,options);
 const message=new TransactionMessage({payerKey:new PublicKey(plan.creator),recentBlockhash:bh.toBase58(),instructions}).compileToV0Message();
 const transaction=new VersionedTransaction(message);
 transaction.sign([mintKeypair]);
 await assertLaunchTransaction(transaction,plan,options);
 const binding=Object.freeze({
  version:1,cluster:plan.cluster,creator:plan.creator,mint:plan.mint,
  planDigest:await launchPlanDigest(plan),messageHash:await launchMessageHash(transaction),
  blockhash:bh.toBase58(),lastValidBlockHeight,compute:Object.freeze(options)
 });
 return {transaction,binding};
}

async function verifySignature(publicKey,signature,message){
 if(!signature||signature.length!==64||signature.every(b=>b===0))return false;
 const key=await crypto.subtle.importKey('raw',publicKey.toBytes(),{name:'Ed25519'},false,['verify']);
 return crypto.subtle.verify('Ed25519',key,signature,message);
}
/** True only when both required signatures (creator, mint) are present and valid for this message. */
export async function hasValidLaunchSignatures(tx){
 const message=tx.message.serialize(),keys=tx.message.staticAccountKeys;
 for(let i=0;i<tx.message.header.numRequiredSignatures;i++)if(!await verifySignature(keys[i],tx.signatures[i],message))return false;
 return true;
}

/**
 * Simulates the exact unsigned message on the intended cluster. Returns the data needed by
 * assertSimulatedLaunch plus logs, units, slot, fee and the creator's simulated SOL debit.
 * A failed simulation is returned (err set) rather than thrown so the UI can show the logs.
 */
export async function simulateLaunch({connection,transaction,binding,plan,now=Date.now}){
 const expectedGenesis=GENESIS_HASH[binding.cluster];
 if(!expectedGenesis)throw Error('Unsupported Solana cluster.');
 if(await connection.getGenesisHash()!==expectedGenesis)throw Error(`RPC is not connected to ${binding.cluster}.`);
 if(await launchMessageHash(transaction)!==binding.messageHash)throw Error('Transaction changed after it was prepared.');
 const valid=await connection.isBlockhashValid(binding.blockhash,{commitment:'confirmed'});
 if(!valid?.value)throw Error('The blockhash expired. Prepare the launch again.');
 const creator=new PublicKey(binding.creator);
 const writable=(await expectedLaunchInstructions(plan,binding.compute)).flatMap(ix=>ix.keys.filter(k=>k.isWritable&&!k.isSigner).map(k=>k.pubkey.toBase58()));
 const addresses=[...new Set([binding.creator,...writable])];
 const [before,feeResult]=await Promise.all([connection.getBalance(creator,'confirmed'),connection.getFeeForMessage(transaction.message,'confirmed')]);
 const response=await connection.simulateTransaction(transaction,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',accounts:{encoding:'base64',addresses}});
 const accounts=(response.value.accounts??[]).map((a,i)=>a?{address:addresses[i],lamports:a.lamports,owner:a.owner,dataLength:Buffer.from(a.data[0],'base64').length}:{address:addresses[i],lamports:null});
 const after=accounts.find(a=>a.address===binding.creator)?.lamports;
 return {
  err:response.value.err??null,logs:response.value.logs??[],unitsConsumed:response.value.unitsConsumed??null,
  slot:response.context.slot,simulatedAt:now(),messageHash:binding.messageHash,
  feeLamports:feeResult?.value??null,
  creatorDebitLamports:typeof after==='number'?before-after:null,
  accounts
 };
}

const inFlight=new Map();

/**
 * Sends the reviewed, fully signed transaction. Rejects anything that is not byte-identical to the
 * simulated message, then confirms. Never retries: transport errors carry the locally derived
 * signature so the UI can reconcile instead of resubmitting.
 */
export async function submitLaunch({connection,plan,binding,simulation,signedTransaction,now=Date.now,onSubmitted=()=>{}}){
 if(!(signedTransaction instanceof VersionedTransaction))throw Error('Signed transaction is required.');
 const actualHash=await launchMessageHash(signedTransaction);
 assertSimulatedLaunch({plan,simulation,expectedMessageHash:binding.messageHash,actualMessageHash:actualHash,now:now()});
 if(simulation.messageHash!==binding.messageHash)throw Error('Simulation belongs to a different transaction.');
 if(await launchPlanDigest(plan)!==binding.planDigest)throw Error('Launch plan changed after it was prepared.');
 await assertLaunchTransaction(signedTransaction,plan,binding.compute);
 if(!await hasValidLaunchSignatures(signedTransaction))throw Error('Transaction is missing a valid creator or mint signature.');
 const valid=await connection.isBlockhashValid(binding.blockhash,{commitment:'confirmed'});
 if(!valid?.value)throw Error('The blockhash expired before submission. Prepare the launch again.');
 const signature=base58(signedTransaction.signatures[0]);
 if(inFlight.has(binding.messageHash))throw Error('This launch was already submitted.');
 inFlight.set(binding.messageHash,signature);
 onSubmitted({signature,state:'pending',lastValidBlockHeight:binding.lastValidBlockHeight});
 try{
  const received=await connection.sendRawTransaction(signedTransaction.serialize(),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});
  if(received!==signature)throw Error('RPC returned a different signature.');
 }catch(error){
  const status=await connection.getSignatureStatus(signature,{searchTransactionHistory:true}).catch(()=>null);
  if(!status?.value){inFlight.delete(binding.messageHash);const e=Error(`Submission failed: ${error.message}`);e.signature=signature;throw e;}
 }
 try{
  const result=await connection.confirmTransaction({signature,blockhash:binding.blockhash,lastValidBlockHeight:binding.lastValidBlockHeight},'confirmed');
  if(result.value?.err)return {status:'failed',signature,err:result.value.err};
  return {status:'confirmed',signature};
 }catch(error){
  const status=await connection.getSignatureStatus(signature,{searchTransactionHistory:true}).catch(()=>null);
  if(status?.value&&!status.value.err&&['confirmed','finalized'].includes(status.value.confirmationStatus))return {status:'confirmed',signature};
  if(status?.value?.err)return {status:'failed',signature,err:status.value.err};
  return {status:'expired',signature,detail:error.message};
 }
}

/**
 * Independently reads chain state after confirmation: the mint is a token mint owned by one of the
 * SPL token programs used by create_v2, and the Pump bonding curve exists under the Pump program
 * with the wallet as creator and is not complete. On-chain token metadata is not checked here.
 */
export async function verifyLaunchedMint({connection,plan,commitment='confirmed'}){
 const {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda}=await pumpSdk();
 const mint=new PublicKey(plan.mint),curveAddress=bondingCurvePda(mint);
 const [mintAccount,curveAccount]=await connection.getMultipleAccountsInfo([mint,curveAddress],commitment);
 if(!mintAccount)throw Error('Mint account was not found.');
 if(!TOKEN_PROGRAMS.some(p=>mintAccount.owner.equals(p)))throw Error('Mint is not owned by an SPL token program.');
 const createKeys=(await expectedLaunchInstructions(plan,{})).at(-1).keys;
 if(!createKeys.some(k=>k.pubkey.equals(mintAccount.owner)))throw Error('Mint token program is not the one create_v2 uses.');
 if(!curveAccount||!curveAccount.owner.equals(PUMP_PROGRAM_ID))throw Error('Pump bonding curve was not found under the Pump program.');
 const curve=PUMP_SDK.decodeBondingCurve(curveAccount);
 if(!curve.creator.equals(new PublicKey(plan.creator)))throw Error('Bonding curve creator is not the launching wallet.');
 if(curve.complete)throw Error('Bonding curve is already complete.');
 return {mint:mint.toBase58(),bondingCurve:curveAddress.toBase58(),creator:curve.creator.toBase58(),tokenProgram:mintAccount.owner.toBase58(),complete:false};
}

/**
 * Wallet Standard signing for the creator slot. The wallet receives the partially signed
 * transaction; whatever it returns must hash to the reviewed message. The mint signature is
 * re-applied locally in case the wallet dropped it.
 */
export async function signLaunchWithWallet({wallet,account,transaction,binding,mintKeypair,chain}){
 const feature=wallet?.features?.['solana:signTransaction'];
 const wanted=chain??(binding.cluster==='mainnet-beta'?'solana:mainnet':'solana:devnet');
 if(!feature?.supportedTransactionVersions?.includes(0)||!account?.features?.includes('solana:signTransaction')||!account.chains?.includes(wanted))throw Error('Connect a wallet that signs versioned transactions on this network.');
 if(account.address!==binding.creator)throw Error('The connected wallet is not the launch creator.');
 if(await launchMessageHash(transaction)!==binding.messageHash)throw Error('Transaction changed after it was prepared.');
 const output=await feature.signTransaction({account,chain:wanted,transaction:transaction.serialize()});
 if(output?.length!==1)throw Error('Wallet returned an unexpected transaction count.');
 const signed=VersionedTransaction.deserialize(output[0].signedTransaction);
 if(await launchMessageHash(signed)!==binding.messageHash)throw Error('Wallet changed the reviewed transaction. Nothing was submitted.');
 if(mintKeypair)signed.sign([mintKeypair]);
 return signed;
}
