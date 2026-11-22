// The launch flow with Nush fees, end to end through the REAL relay with fees enforced.
// MOCKED: the upstream Solana RPC (serves the lookup table and a fee-split curve), the wallet, the upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {createLaunchFlow} from '../src/launchpad-flow.mjs';
import {createLaunchConnection} from '../src/launch-client.mjs';
import {handleLaunchRpc} from '../worker/launch-rpc.mjs';
import {GENESIS_HASH} from '../src/launchpad-create-tx.mjs';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {base58} from '../src/guarded-trade.mjs';
import {altData,setupEconomics} from './helpers/nush-fixture.mjs';

const sdk=await loadPumpSdk();
const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,...Array(64).fill(1)]);
const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const {economics,addresses}=await setupEconomics();
const ok=value=>({context:{slot:42},value});
async function curveData(creator){const z=new BN(0);return Buffer.from(await sdk.PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN(1),virtualQuoteReserves:new BN(1),realTokenReserves:new BN(1),realQuoteReserves:z,tokenTotalSupply:new BN(1),complete:false,creator,isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:z,canEditCreatorFee:false,isHolderReward:false,creatorFee:z,protocolFees:z,depth:0,initialVirtualQuoteReserves:z,postCompleteBaseOut:z,postCompleteQuoteIn:z})).toString('base64');}

function setup({table=addresses,splitSet=true,economicsOn=true}={}){
 const creator=Keypair.generate(),world={sent:[],mints:new Map()};
 const upstream=async(url,init)=>{
  const {method,params,id}=JSON.parse(init.body);
  const result=await(async()=>{switch(method){
   case 'getGenesisHash':return GENESIS_HASH['mainnet-beta'];
   case 'getLatestBlockhash':return ok({blockhash:BH,lastValidBlockHeight:100});
   case 'isBlockhashValid':return ok(true);
   case 'getBalance':return ok(2_000_000_000);
   case 'getFeeForMessage':return ok(10000);
   case 'getBlockHeight':return 50;
   case 'simulateTransaction':return ok({err:null,logs:['ok'],unitsConsumed:250000,accounts:params[1].accounts.addresses.map((a,i)=>({lamports:i===0?1_960_000_000:10_000_000,owner:'11111111111111111111111111111111',data:['','base64'],executable:false,rentEpoch:0}))});
   case 'sendTransaction':{const tx=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));world.sent.push(tx);return base58(tx.signatures[0]);}
   case 'getSignatureStatuses':return ok([world.sent.length?{slot:43,confirmations:null,err:null,confirmationStatus:'confirmed'}:null]);
   case 'getMultipleAccounts':{const out=[];for(const k of params[0]){
     if(k===economics.lookupTable)out.push({lamports:1,owner:'AddressLookupTab1e1111111111111111111111111',data:[altData(table).toString('base64'),'base64'],executable:false,rentEpoch:0});
     else if(world.mints.has(k))out.push({lamports:1,owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:['','base64'],executable:false,rentEpoch:0});
     else{const mint=[...world.mints.values()].find(m=>sdk.bondingCurvePda(m).toBase58()===k);out.push(mint?{lamports:1,owner:sdk.PUMP_PROGRAM_ID.toBase58(),data:[await curveData(splitSet?sdk.feeSharingConfigPda(mint):creator.publicKey),'base64'],executable:false,rentEpoch:0}:null);}
    }return ok(out);}
   default:throw Error(method);}})();
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));
 };
 const fetcher=(url,init)=>handleLaunchRpc(new Request(url,{...init,headers:{...(init?.headers??{}),origin:'https://nush.test'}}),upstream,{economics:economicsOn?economics:null});
 const connection=createLaunchConnection({fetcher,base:'https://nush.test'});
 const account={address:creator.publicKey.toBase58(),chains:['solana:mainnet'],features:['solana:signTransaction']};
 const wallet={features:{'solana:signTransaction':{supportedTransactionVersions:[0],async signTransaction({transaction}){const tx=VersionedTransaction.deserialize(transaction);tx.sign([creator]);return [{signedTransaction:tx.serialize()}];}}}};
 const newMint=()=>{const k=Keypair.generate();world.mints.set(k.publicKey.toBase58(),k.publicKey);return k;};
 const upload=async({form})=>({verified:true,metadataUri:'https://gateway.pinata.cloud/ipfs/'+'Q'.repeat(46),imageUri:'https://gateway.pinata.cloud/ipfs/'+'R'.repeat(46),metadata:{name:form.name,symbol:form.symbol}});
 const form={name:'Orbit',symbol:'ORB',description:'d',image:new Blob([PNG],{type:'image/png'})};
 return {creator,world,connection,account,wallet,newMint,upload,form};
}

test('with fees: review shows them, launch pays them and sets the split, the chain check confirms the split',async()=>{
 const t=setup();
 const flow=createLaunchFlow({enabled:true,economics,requireEconomics:true,connection:t.connection,wallet:t.wallet,account:t.account,upload:t.upload,newMint:t.newMint,confirm:{wait:async()=>{},intervalMs:0}});
 const ready=await flow.prepare(t.form);
 assert.equal(ready.stage,'ready',ready.error);
 assert.deepEqual(ready.review.fees,{launchFeeLamports:10_000_000,treasuryShareBps:2500,treasury:economics.treasury});
 const done=await flow.launch({messageHash:ready.review.messageHash});
 assert.equal(done.stage,'launched',done.error);assert.equal(done.chain.feeSplit,true);
 assert.equal(t.world.sent.length,1);assert.equal(t.world.sent[0].message.addressTableLookups.length,1);
});

test('fees required but not configured, or the treasury tries to launch: stopped before any upload',async()=>{
 const t=setup();let uploads=0;const upload=async a=>{uploads++;return t.upload(a);};
 const off=createLaunchFlow({enabled:true,economics:null,requireEconomics:true,connection:t.connection,wallet:t.wallet,account:t.account,upload});
 assert.match((await off.prepare(t.form)).error,/not set up/);
 const self=createLaunchFlow({enabled:true,economics,connection:t.connection,wallet:t.wallet,account:{...t.account,address:economics.treasury},upload});
 assert.match((await self.prepare(t.form)).error,/treasury wallet cannot launch/);
 assert.equal(uploads,0);
});

test('a short lookup table stops at build with a setup message, nothing signed',async()=>{
 const t=setup({table:addresses.slice(3)});
 const flow=createLaunchFlow({enabled:true,economics,connection:t.connection,wallet:t.wallet,account:t.account,upload:t.upload,newMint:t.newMint});
 const state=await flow.prepare(t.form);
 assert.equal(state.stage,'error');assert.match(state.error,/missing 3/);assert.equal(t.world.sent.length,0);
});

test('a coin that lands without the split is reported as unverified, not launched',async()=>{
 const t=setup({splitSet:false});
 const flow=createLaunchFlow({enabled:true,economics,connection:t.connection,wallet:t.wallet,account:t.account,upload:t.upload,newMint:t.newMint,confirm:{wait:async()=>{},intervalMs:0}});
 const ready=await flow.prepare(t.form);const done=await flow.launch({messageHash:ready.review.messageHash});
 assert.equal(done.stage,'unverified');assert.match(done.error,/fee split was not set/);
});
