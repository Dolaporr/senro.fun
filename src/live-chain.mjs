import {Buffer} from 'buffer';
import {Connection,PublicKey,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import BN from 'bn.js';
import {prepareGuardedInstructions,sealGuardReview} from './guarded-trade.mjs';
import {decodePolicy,policyFingerprint as guardFingerprint} from '../protocol/client/guard.mjs';
import {sha256,hex,parseAmount} from './policy-client.mjs';
export const DEFAULT_RPC='https://solana-rpc.publicnode.com';
export const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SOL_MINT=new PublicKey('So11111111111111111111111111111111111111112');
export const TOKEN_PROGRAM=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const shortAddress=a=>`${String(a).slice(0,5)}…${String(a).slice(-5)}`;
export function publicKey(text){try{return new PublicKey(String(text).trim());}catch{throw Error('Enter a valid Solana address.');}}
export function validateRpc(value){let u;try{u=new URL(value);}catch{throw Error('Enter an HTTPS Solana RPC URL.');}if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Use an HTTPS RPC URL without a username, password, or fragment.');return u.href;}
export function pacedFetch(fetcher=fetch){let pending=Promise.resolve(),lastStart=0;return (url,options)=>{const execute=async()=>{const wait=Math.max(0,500-(Date.now()-lastStart));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastStart=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{return await fetcher(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}};const job=pending.then(execute,execute);pending=job.catch(()=>{});return job;};}
export function browserRpcFetch(endpoint,{fetcher=fetch,origin=typeof location!=='undefined'?location.origin:null}={}){const useRelay=!!origin&&validateRpc(endpoint)===validateRpc(DEFAULT_RPC);return async(url,options)=>{if(!useRelay)return fetcher(url,options);try{const response=await fetcher(url,options);if(![403,429,502,503,504].includes(response.status))return response;}catch(error){if(options?.signal?.aborted)throw error;}return fetcher(new URL('/api/solana',origin).href,options);};}
export function connectionFor(endpoint){const configured=validateRpc(endpoint);return new Connection(configured,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:pacedFetch(browserRpcFetch(configured))});}

export function friendlyError(error){const s=String(error?.message??error);if(/Cross-origin/.test(s))return 'The simulation relay rejected the request origin.';if(/reject|declin|cancel/i.test(s))return 'Request cancelled. Nothing was signed or sent.';if(/429|rate.?limit/i.test(s))return 'The RPC is rate limited. Try again later or choose another mainnet RPC in Connection settings.';if(/403|forbidden|failed to fetch|network|fetch failed/i.test(s))return 'The RPC could not be reached. Check your connection or choose another mainnet RPC in Connection settings.';if(/abort|timeout|timed out|502|503|504/i.test(s))return 'The RPC timed out. Try again or choose another mainnet RPC.';return s.replace(/https?:\/\/[^\s"']+/g,'[RPC endpoint]').slice(0,350);}
let sdkPromise;
async function sdks(){return sdkPromise??=Promise.all([import('@pump-fun/pump-sdk'),import('@pump-fun/pump-sdk/swap')]);}
export async function requireMainnet(connection){if(await connection.getGenesisHash()!==MAINNET_GENESIS)throw Error('This connection is not Solana mainnet. Choose a mainnet RPC.');}
export function readMint(info){if(!info||info.executable||(!info.owner.equals(TOKEN_PROGRAM)&&!info.owner.equals(TOKEN_2022))||info.data.length<82||info.data[45]!==1||(info.owner.equals(TOKEN_PROGRAM)&&info.data.length!==82)||(info.owner.equals(TOKEN_2022)&&info.data.length!==82&&(info.data.length<166||info.data[165]!==1||info.data.subarray(82,165).some(v=>v!==0))))throw Error('This address is not an initialized SPL token mint.');return {decimals:info.data[44],tokenProgram:info.owner};}
export function requireSolQuote(quoteMint){if(quoteMint&&!quoteMint.equals(PublicKey.default)&&!quoteMint.equals(SOL_MINT))throw Error('This contract address is paired with a non-SOL asset. SENRO currently simulates SOL-paired tokens only.');}
export async function inspectMarket(connection,address){
 const mint=publicKey(address);await requireMainnet(connection);const [pump,amm]=await sdks();
 const curveAddress=pump.bondingCurvePda(mint),poolAddress=amm.canonicalPumpPoolPda(mint,SOL_MINT);
 const response=await connection.getMultipleAccountsInfoAndContext([mint,curveAddress,poolAddress]);
 const [mintInfo,curveInfo,poolInfo]=response.value,parsed=readMint(mintInfo);let curve=null,pool=null;
 if(curveInfo){if(!curveInfo.owner.equals(pump.PUMP_PROGRAM_ID))throw Error('The bonding curve has an unexpected program owner.');curve=pump.PUMP_SDK.decodeBondingCurve(curveInfo);}
 if(poolInfo){if(!poolInfo.owner.equals(amm.PUMP_AMM_PROGRAM_ID))throw Error('The pool has an unexpected program owner.');pool=amm.PUMP_AMM_SDK.decodePool(poolInfo);if(!pool.baseMint.equals(mint)||!pool.quoteMint.equals(SOL_MINT))throw Error('The canonical pool mint pair does not match.');}
 requireSolQuote(curve?.quoteMint);
 let venue,venueProgram,venueAddress;
 if(curve&&!curve.complete){venue='Pump bonding curve';venueProgram=pump.PUMP_PROGRAM_ID;venueAddress=curveAddress;}
 else if(pool){venue='PumpSwap';venueProgram=amm.PUMP_AMM_PROGRAM_ID;venueAddress=poolAddress;}
 else if(curve?.complete)throw Error('The curve has completed, but no supported canonical SOL pool was found. Migration may be pending, or the token may use a different pool.');
 else throw Error('No supported Pump curve or canonical SOL PumpSwap pool was found for this mint.');
 return {mint:mint.toBase58(),decimals:parsed.decimals,tokenProgram:parsed.tokenProgram.toBase58(),venue,venueProgram:venueProgram.toBase58(),venueAddress:venueAddress.toBase58(),slot:response.context.slot};
}
export function minimumOutput(expected,bps){if(typeof expected!=='bigint'||expected<=0n)throw Error('The quote produced no tokens.');if(!Number.isInteger(bps)||bps<1||bps>500)throw Error('Choose slippage between 0.01% and 5%.');const n=expected*BigInt(10000-bps)/10000n;if(n<1n)throw Error('Trade is too small for a positive minimum output.');return n;}
export function tokenAmount(info,mint,user,program){
 if(!info)return 0n;const data=Array.isArray(info.data)?Buffer.from(info.data[0],'base64'):Buffer.from(info.data);
 if(new PublicKey(info.owner).toBase58()!==program||data.length<165||new PublicKey(data.subarray(0,32)).toBase58()!==mint||new PublicKey(data.subarray(32,64)).toBase58()!==user)throw Error('Token account mint, owner, or token program does not match.');
 return data.readBigUInt64LE(64);
}
export function assessRules(config,{input,postBalance,decimals,simulationOk}){
 const checks=[];
 if(config.capOn)checks.push({name:'Trade size',state:config.quote!=='SOL'?'unknown':input<=parseAmount(config.cap,9)?'pass':'block',detail:config.quote!=='SOL'?'Switch rule limits to SOL to compare this buy.':'Compared with the exact SOL input budget.'});
 if(config.rollingOn)checks.push({name:'Rolling volume',state:'unknown',detail:'Requires authoritative routed trade history. Not verified in this venue-only simulation.'});
 if(config.cooldownOn)checks.push({name:'Sell cooldown',state:'na',detail:'This is a buy. The cooldown applies to sells.'});
 if(config.accountOn)checks.push({name:'Account balance',state:!simulationOk||postBalance===null?'unknown':postBalance<=parseAmount(config.account,decimals)?'pass':'block',detail:simulationOk?'Uses the simulated balance of this wallet’s associated token account.':'The simulation did not provide a post-trade token balance.'});
 return checks;
}
export async function requestFingerprint(request){return hex(await sha256(new TextEncoder().encode(JSON.stringify(request))));}
export function assertFreshResult(result,fingerprint,now=Date.now()){if(!result||result.requestFingerprint!==fingerprint)throw Error('The inputs changed. Run a fresh simulation.');if(now>=result.expiresAt)throw Error('This simulation has expired. Run it again.');if(!result.ok)throw Error('The venue simulation failed.');return true;}
export async function simulateBuy({connection,market:initialMarket,wallet,amount,slippageBps,config,revision,guarded=null,onProgress=()=>{}}){
 const input=parseAmount(amount,9);if(input===0n)throw Error('Enter a SOL amount greater than zero.');
 const user=publicKey(wallet);if(!PublicKey.isOnCurve(user.toBytes()))throw Error('The simulation address must be a wallet public key.');
 onProgress('Refreshing market');const market=await inspectMarket(connection,initialMarket.mint),mint=publicKey(market.mint),tokenProgram=publicKey(market.tokenProgram);
 const [pump,amm]=await sdks();const budget=new BN(input.toString());let expected,instructions,minOut;
 onProgress('Building venue transaction');
 if(market.venue==='Pump bonding curve'){
  const online=new pump.OnlinePumpSdk(connection);
  const [global,feeConfig,state]=await Promise.all([online.fetchGlobal(),online.fetchFeeConfig(),online.fetchBuyState(mint,user,tokenProgram)]);
  if(state.bondingCurve.complete)throw Error('This curve just migrated. Load the token again.');
  if(!state.quoteMint.equals(SOL_MINT))throw Error('Only SOL-quoted buys are supported.');
  if(state.bondingCurve.isCashbackCoin)throw Error('Legacy cashback curves are not supported by this adapter.');
  expected=BigInt(pump.getBuyV3TokenAmountFromQuoteAmount({global,feeConfig,mintSupply:state.bondingCurve.tokenTotalSupply,bondingCurve:state.bondingCurve,amount:budget,curveBaseTokenBalance:state.curveBaseTokenBalance,quoteTransferFee:state.quoteTransferFee}).toString());
  minOut=minimumOutput(expected,slippageBps);
  instructions=await pump.PUMP_SDK.buyExactQuoteInV3Instructions({bondingCurve:state.bondingCurve,associatedUserAccountInfo:state.associatedUserAccountInfo,mint,user,amount:new BN(minOut.toString()),quoteAmount:budget,slippage:0,tokenProgram,quoteTokenProgram:state.quoteTokenProgram,partialFill:false});
 }else{
  const state=await new amm.OnlinePumpAmmSdk(connection).swapSolanaState(publicKey(market.venueAddress),user);
  if(!state.pool.baseMint.equals(mint)||!state.pool.quoteMint.equals(SOL_MINT))throw Error('The pool changed its mint pair.');
  const quote=amm.buyQuoteInput({quote:budget,slippage:0,baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,virtualQuoteReserves:state.pool.virtualQuoteReserves,globalConfig:state.globalConfig,baseMintAccount:state.baseMintAccount,baseMint:mint,coinCreator:state.pool.coinCreator,creator:state.pool.creator,feeConfig:state.feeConfig,quoteMint:state.pool.quoteMint,isMayhemMode:state.pool.isMayhemMode,creatorFeeBps:state.pool.creatorFeeBps,quoteTransferFee:state.quoteTransferFee,tradeV2:true});
  expected=BigInt(quote.base.toString());minOut=minimumOutput(expected,slippageBps);
  instructions=await amm.PUMP_AMM_SDK.buyExactQuoteInV2Instructions(state,budget,new BN(minOut.toString()));
 }
 let guard=null;
 if(guarded){onProgress('Verifying guard and wallet policy');const prepared=await prepareGuardedInstructions({connection,deployment:guarded.deployment,market,wallet:user,config,instructions,maxNativeDebit:guarded.maxNativeDebit});instructions=prepared.instructions;guard=prepared.guard;}
 const ata=PublicKey.findProgramAddressSync([user.toBuffer(),tokenProgram.toBuffer(),mint.toBuffer()],ATA_PROGRAM)[0];
 const before=await connection.getMultipleAccountsInfoAndContext([user,ata]);
 if(!before.value[0])throw Error('This wallet has no mainnet SOL account. Fund it before simulating a buy.');
 const preBalance=tokenAmount(before.value[1],market.mint,user.toBase58(),market.tokenProgram);
 const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash('confirmed');
 const message=new TransactionMessage({payerKey:user,recentBlockhash:blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToV0Message();
 const transaction=new VersionedTransaction(message);const wire=transaction.serialize();if(wire.length>1232)throw Error('This transaction exceeds Solana’s packet limit. No split transaction will be simulated.');
 const request={cluster:'mainnet-beta',wallet:user.toBase58(),mint:market.mint,venue:market.venueProgram,amount:input.toString(),slippageBps,revision,config,...(guard?{guard}: {})};
 const fingerprint=await requestFingerprint(request),messageHash=hex(await sha256(message.serialize()));
 onProgress('Simulating on mainnet');
 const [sim,fee]=await Promise.all([connection.simulateTransaction(transaction,{sigVerify:false,replaceRecentBlockhash:!guard,commitment:'confirmed',minContextSlot:Math.max(before.context.slot,market.slot,guard?.minContextSlot??0),accounts:{encoding:'base64',addresses:[user.toBase58(),ata.toBase58(),...(guard?[guard.policyAddress]:[])]}}),connection.getFeeForMessage(message,'confirmed').catch(()=>({value:null}))]);
 let postBalance=null,observedOutput=null,walletAfter=null;
 if(!sim.value.err&&sim.value.accounts?.[1]){postBalance=tokenAmount(sim.value.accounts[1],market.mint,user.toBase58(),market.tokenProgram);observedOutput=postBalance-preBalance;}
 if(!sim.value.err&&sim.value.accounts?.[0])walletAfter=sim.value.accounts[0].lamports;
 if(!sim.value.err&&(observedOutput===null||observedOutput<minOut))throw Error('RPC reported success without the required token output. Treat this result as unverified.');
 if(guard&&!sim.value.err){
  if(walletAfter===null||!Number.isSafeInteger(walletAfter)||!Number.isSafeInteger(fee.value))throw Error('Guarded review requires a wallet balance and network fee estimate.');
  const info=sim.value.accounts?.[2];if(!info||info.owner!==guard.programId)throw Error('Guard simulation did not return the expected policy.');
  const policy=decodePolicy(Buffer.from(info.data[0],'base64'));
  if(policy.nonce!==BigInt(guard.nonce)+1n||hex(guardFingerprint(policy,guard.programId))!==guard.policyHash)throw Error('Guard simulation did not consume the expected policy nonce.');
 }
 const createdAt=Date.now();const result={ok:!sim.value.err,error:sim.value.err,logs:sim.value.logs??[],units:sim.value.unitsConsumed??null,slot:sim.context.slot,market,input:input.toString(),expected:expected.toString(),minOut:minOut.toString(),observedOutput:observedOutput?.toString()??null,postBalance:postBalance?.toString()??null,walletBefore:before.value[0].lamports,walletAfter,networkFee:fee.value,lastValidBlockHeight,blockhash,messageHash,requestFingerprint:fingerprint,createdAt,expiresAt:createdAt+30000,checks:assessRules(config,{input,postBalance,decimals:market.decimals,simulationOk:!sim.value.err}),enforcement:guard?'senro-guard':'venue-only',request,...(guard?{guard}:{})};
 if(guard&&result.ok)result.guardTicket=await sealGuardReview(result,transaction);
 return result;
}
