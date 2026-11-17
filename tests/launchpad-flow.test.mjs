// What is real here: the Pump SDK instruction building, the web3.js Connection, the launch relay's
// validation, the flow state machine, and signature checks (a local test keypair signs).
// What is MOCKED: the upstream Solana RPC (an in-memory fake that answers JSON-RPC), the wallet, and the
// storage provider. Nothing here touches a Solana cluster, so none of this is evidence of a live launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {createLaunchFlow,DISABLED_REASON} from '../src/launchpad-flow.mjs';
import {createLaunchConnection,uploadLaunchMetadata} from '../src/launch-client.mjs';
import {handleLaunchRpc} from '../worker/launch-rpc.mjs';
import {handleUpload,sniffImage} from '../worker/launchpad-upload.mjs';
import {GENESIS_HASH} from '../src/launchpad-create-tx.mjs';
import {loadPumpSdk} from '../src/pump-sdk.mjs';
import {base58} from '../src/guarded-trade.mjs';

const sdk=await loadPumpSdk();
const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,...Array(64).fill(1)]);
const ORIGIN='https://senro.test';
const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const b64=u8=>Buffer.from(u8).toString('base64');

async function curveData(creator){
 const zero=new BN(0);
 return b64(await sdk.PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN(1),virtualQuoteReserves:new BN(1),realTokenReserves:new BN(1),realQuoteReserves:zero,tokenTotalSupply:new BN(1),complete:false,creator:new PublicKey(creator),isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:zero,canEditCreatorFee:false,isHolderReward:false,creatorFee:zero,protocolFees:zero,depth:0,initialVirtualQuoteReserves:zero,postCompleteBaseOut:zero,postCompleteQuoteIn:zero}));
}

/** In-memory Solana JSON-RPC. `world.sent` records every transaction the relay forwarded. */
function fakeChain(creator,over={}){
 const world={sent:[],blockHeight:50,status:'confirmed',expired:false,calls:[],...over};
 const ok=value=>({context:{slot:42},value});
 const upstream=async(url,init)=>{
  const {method,params,id}=JSON.parse(init.body);world.calls.push(method);
  const result=await(async()=>{switch(method){
   case 'getGenesisHash':return GENESIS_HASH['mainnet-beta'];
   case 'getLatestBlockhash':return ok({blockhash:BH,lastValidBlockHeight:100});
   case 'isBlockhashValid':return ok(!world.expired);
   case 'getBalance':return ok(2_000_000_000);
   case 'getFeeForMessage':return ok(5000);
   case 'getBlockHeight':return world.blockHeight;
   case 'simulateTransaction':{
    const addresses=params[1].accounts.addresses;
    if(world.simErr)return ok({err:world.simErr,logs:['Program log: Instruction: CreateV2','Program failed'],unitsConsumed:1,accounts:null});
    return ok({err:null,logs:['ok'],unitsConsumed:150000,accounts:addresses.map((a,i)=>({lamports:i===0?1_970_000_000:1_000_000,owner:'11111111111111111111111111111111',data:['','base64'],executable:false,rentEpoch:0}))});
   }
   case 'sendTransaction':{
    const tx=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));world.sent.push(tx);return base58(tx.signatures[0]);
   }
   case 'getSignatureStatuses':return ok([world.sent.length&&world.status?{slot:43,confirmations:null,err:world.status==='failed'?{InstructionError:[0,'Custom']}:null,confirmationStatus:world.status==='failed'?'confirmed':world.status}:null]);
   case 'getMultipleAccounts':{
    const [mint]=params[0];
    return ok([{lamports:1,owner:TOKEN_2022,data:['','base64'],executable:false,rentEpoch:0},{lamports:1,owner:sdk.PUMP_PROGRAM_ID.toBase58(),data:[await curveData(world.curveCreator??creator),'base64'],executable:false,rentEpoch:0}]);
   }
   default:throw Error(`unexpected method ${method}`);
  }})().catch(e=>({__error:e.message}));
  if(result?.__error)return new Response(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:result.__error}}));
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));
 };
 return {world,upstream};
}

function setup({enabled=true,chainOver={},walletOver={},uploadOver}={}){
 const creator=Keypair.generate();
 const {world,upstream}=fakeChain(creator.publicKey.toBase58(),chainOver);
 const fetcher=(url,init)=>handleLaunchRpc(new Request(url,{...init,headers:{...(init?.headers??{}),origin:ORIGIN}}),upstream);
 const connection=createLaunchConnection({fetcher,base:ORIGIN});
 const account={address:creator.publicKey.toBase58(),chains:['solana:mainnet'],features:['solana:signTransaction','solana:signMessage']};
 const signedCalls=[];
 const wallet={features:{'solana:signTransaction':{supportedTransactionVersions:[0],async signTransaction({transaction}){signedCalls.push(1);const tx=VersionedTransaction.deserialize(transaction);if(walletOver.tamper)walletOver.tamper(tx);tx.sign([creator]);return [{signedTransaction:tx.serialize()}];}}}};
 const upload=uploadOver??(async({form})=>({verified:true,metadataUri:'https://gateway.test/ipfs/Qm'+'1'.repeat(44),imageUri:'https://gateway.test/ipfs/Qm'+'2'.repeat(44),metadata:{name:form.name,symbol:form.symbol}}));
 const persisted=[];
 const flow=createLaunchFlow({enabled,connection,wallet,account,upload,persist:s=>persisted.push(s),confirm:{wait:async()=>{},intervalMs:0}});
 const form={name:'Orbit',symbol:'ORB',description:'Test token',website:'',twitter:'',telegram:'',image:new Blob([PNG],{type:'image/png'})};
 return {creator,world,flow,form,signedCalls,persisted,connection,account};
}

test('prepare runs upload, build and a real-client simulation through the relay, then stops at ready',async()=>{
 const t=setup({enabled:false});
 const stages=[];t.flow.subscribe(s=>stages.push(s.stage));
 const state=await t.flow.prepare(t.form);
 assert.deepEqual(stages,['uploading','building','simulating','ready']);
 assert.equal(state.stage,'ready');assert.equal(state.review.creator,t.account.address);
 assert.equal(state.review.feeLamports,5000);assert.equal(state.review.creatorDebitLamports,30_000_000);
 assert.equal(state.disabledReason,DISABLED_REASON);
 assert.ok(t.world.calls.includes('simulateTransaction'));
 assert.equal(t.world.sent.length,0);assert.equal(t.signedCalls.length,0);
});

test('with live launch disabled, launch() refuses: nothing is signed or sent',async()=>{
 const t=setup({enabled:false});
 const {review}=await t.flow.prepare(t.form);
 const state=await t.flow.launch({messageHash:review.messageHash});
 assert.equal(state.stage,'blocked');assert.equal(t.signedCalls.length,0);assert.equal(t.world.sent.length,0);
});

test('enabled: approval of the reviewed hash signs, sends through the relay, confirms and verifies the mint',async()=>{
 const t=setup();
 const {review}=await t.flow.prepare(t.form);
 const state=await t.flow.launch({messageHash:review.messageHash});
 assert.equal(state.stage,'launched');assert.equal(t.world.sent.length,1);assert.equal(t.signedCalls.length,1);
 assert.equal(state.signature,base58(t.world.sent[0].signatures[0]));
 assert.equal(state.chain.creator,t.account.address);assert.equal(state.chain.complete,false);
 assert.equal(t.persisted.length,1,'the signature is persisted before confirmation for later reconciliation');
 assert.equal(t.persisted[0].signature,state.signature);
 assert.ok(!JSON.stringify(t.persisted).includes('secret'));
});

test('launch needs the exact reviewed hash and a prepared review',async()=>{
 const t=setup();
 await assert.rejects(t.flow.launch({messageHash:'x'}),/Prepare and review/);
 await t.flow.prepare(t.form);
 await assert.rejects(t.flow.launch({messageHash:'0'.repeat(64)}),/does not match/);
 assert.equal(t.signedCalls.length,0);assert.equal(t.world.sent.length,0);
});

test('a launch cannot be approved twice: the second approval finds nothing prepared',async()=>{
 const t=setup();
 const {review}=await t.flow.prepare(t.form);
 await t.flow.launch({messageHash:review.messageHash});
 await assert.rejects(t.flow.launch({messageHash:review.messageHash}),/Prepare and review/);
 assert.equal(t.world.sent.length,1);
});

test('simulation failure at review stops with logs and never reaches the wallet',async()=>{
 const t=setup({chainOver:{simErr:{InstructionError:[0,'Custom']}}});
 const state=await t.flow.prepare(t.form);
 assert.equal(state.stage,'simulation-failed');assert.ok(state.logs.length);
 await assert.rejects(t.flow.launch({messageHash:state.review.messageHash}),/Prepare and review/);
 assert.equal(t.signedCalls.length,0);
});

test('simulation that starts failing after review is caught by the pre-sign re-simulation',async()=>{
 const t=setup();
 const {review}=await t.flow.prepare(t.form);
 t.world.simErr={InstructionError:[0,'Custom']};
 const state=await t.flow.launch({messageHash:review.messageHash});
 assert.equal(state.stage,'simulation-failed');assert.equal(t.signedCalls.length,0);assert.equal(t.world.sent.length,0);
});

test('a wallet that changes the transaction is caught and nothing is sent',async()=>{
 const t=setup({walletOver:{tamper:tx=>{tx.message.recentBlockhash=new PublicKey(new Uint8Array(32).fill(9)).toBase58();}}});
 const {review}=await t.flow.prepare(t.form);
 const state=await t.flow.launch({messageHash:review.messageHash});
 assert.equal(state.stage,'error');assert.match(state.error,/changed/);assert.equal(t.world.sent.length,0);
});

test('on-chain failure, expiry and unknown outcomes are reported distinctly and never retried',async()=>{
 const failed=setup({chainOver:{status:'failed'}});
 let r=await failed.flow.prepare(failed.form);
 assert.equal((await failed.flow.launch({messageHash:r.review.messageHash})).stage,'failed');
 assert.equal(failed.world.sent.length,1);

 const expired=setup({chainOver:{status:null,blockHeight:500}});
 r=await expired.flow.prepare(expired.form);
 assert.equal((await expired.flow.launch({messageHash:r.review.messageHash})).stage,'expired');
 assert.equal(expired.world.sent.length,1);

 const unknown=setup({chainOver:{status:null,blockHeight:60}});
 const flow=createLaunchFlow({enabled:true,connection:unknown.connection,wallet:{features:unknown.flow&&{'solana:signTransaction':{supportedTransactionVersions:[0],async signTransaction({transaction}){const tx=VersionedTransaction.deserialize(transaction);tx.sign([unknown.creator]);return [{signedTransaction:tx.serialize()}];}}}},account:unknown.account,upload:async({form})=>({verified:true,metadataUri:'https://g.test/ipfs/Qm'+'1'.repeat(44),imageUri:'https://g.test/ipfs/Qm'+'2'.repeat(44),metadata:{name:form.name,symbol:form.symbol}}),confirm:{wait:async()=>{},intervalMs:0,maxMs:-1}});
 r=await flow.prepare(unknown.form);
 const state=await flow.launch({messageHash:r.review.messageHash});
 assert.equal(state.stage,'unknown');assert.match(state.error,/do not resubmit/);assert.ok(state.signature);
});

test('confirmed but the on-chain mint check fails: reported as unverified, not launched',async()=>{
 const t=setup({chainOver:{curveCreator:Keypair.generate().publicKey.toBase58()}});
 const {review}=await t.flow.prepare(t.form);
 const state=await t.flow.launch({messageHash:review.messageHash});
 assert.equal(state.stage,'unverified');assert.match(state.error,/creator/);
});

test('validation, missing wallet, metadata mismatch and upload errors stop before any chain call',async()=>{
 const t=setup();
 assert.equal((await t.flow.prepare({...t.form,symbol:'!'})).stage,'invalid');
 const bad=setup({uploadOver:async()=>({verified:true,metadataUri:'https://g.test/x',metadata:{name:'Other',symbol:'ORB'}})});
 const s=await bad.flow.prepare(bad.form);assert.equal(s.stage,'error');assert.match(s.error,/does not match/);
 const failing=setup({uploadOver:async()=>{throw Object.assign(Error('Upload failed.'),{fields:{image:'bad'}})}});
 const f=await failing.flow.prepare(failing.form);assert.equal(f.stage,'error');assert.deepEqual(f.fields,{image:'bad'});
 for(const x of [t,bad,failing])assert.equal(x.world.calls.length,0,'no RPC traffic before a successful upload');
 const noWallet=createLaunchFlow({connection:t.connection,wallet:{},account:null,upload:async()=>{throw Error('no')}});
 assert.equal((await noWallet.prepare(t.form)).stage,'error');
});

test('cancel and a newer prepare supersede in-flight work',async()=>{
 const t=setup();
 let release;const gate=new Promise(r=>release=r);
 const slow=createLaunchFlow({enabled:true,connection:t.connection,wallet:{},account:t.account,upload:async({form})=>{await gate;return {verified:true,metadataUri:'https://g.test/ipfs/Qm'+'1'.repeat(44),imageUri:'https://g.test/ipfs/Qm'+'2'.repeat(44),metadata:{name:form.name,symbol:form.symbol}}}});
 const pending=slow.prepare(t.form);
 slow.cancel();release();await pending;
 assert.equal(slow.state.stage,'idle','cancelled work cannot move the state');
 assert.equal(t.world.calls.length,0);
});

test('real web3.js client and relay agree: the relay accepted every request the flow made',async()=>{
 const t=setup();
 const {review}=await t.flow.prepare(t.form);await t.flow.launch({messageHash:review.messageHash});
 const allowed=new Set(['getGenesisHash','getLatestBlockhash','isBlockhashValid','getBalance','getFeeForMessage','simulateTransaction','sendTransaction','getSignatureStatuses','getBlockHeight','getMultipleAccounts']);
 for(const m of t.world.calls)assert.ok(allowed.has(m),m);
});

// ---- client upload against the real upload handler (storage mocked) ----
test('uploadLaunchMetadata: wallet-signed message is accepted by the real upload handler',async()=>{
 const creator=Keypair.generate();
 const crypto=await import('node:crypto');
 const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(creator.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 const account={address:creator.publicKey.toBase58(),features:['solana:signMessage']};
 const wallet={features:{'solana:signMessage':{async signMessage({message}){return [{signedMessage:message,signature:new Uint8Array(crypto.sign(null,Buffer.from(message),key))}];}}}};
 const stored=new Map();
 const provider={name:'fake',async pinFile({bytes}){const c='Qm'+'3'.repeat(44);stored.set(c,bytes);return {cid:c,uri:`https://gw.test/ipfs/${c}`};},async pinJson({document}){const c='Qm'+'4'.repeat(44);stored.set(c,JSON.stringify(document));return {cid:c,uri:`https://gw.test/ipfs/${c}`};}};
 const gateway=async url=>{const v=stored.get(String(url).split('/ipfs/')[1]);return typeof v==='string'?new Response(v,{headers:{'content-type':'application/json'}}):new Response(v);};
 const fetcher=(url,init)=>handleUpload(new Request(url,init),{provider,fetcher:gateway,seen:new Map(),retries:{attempts:1,delayMs:0,wait:async()=>{}}});
 const form={name:'Orbit',symbol:'ORB',description:'d',image:new Blob([PNG],{type:'image/png'})};
 const result=await uploadLaunchMetadata({form,wallet,account,fetcher,base:ORIGIN});
 assert.equal(result.verified,true);assert.equal(result.metadata.symbol,'ORB');
 await assert.rejects(uploadLaunchMetadata({form:{...form,image:null},wallet,account,fetcher,base:ORIGIN}),/artwork/);
 await assert.rejects(uploadLaunchMetadata({form,wallet:{features:{}},account,fetcher,base:ORIGIN}),/message/);
 assert.equal(sniffImage(PNG),'image/png');
});

test('upload errors tell the person what to do, by status',async()=>{
 const creator=Keypair.generate();
 const account={address:creator.publicKey.toBase58(),features:['solana:signMessage']};
 const wallet={features:{'solana:signMessage':{async signMessage({message}){return [{signedMessage:message,signature:new Uint8Array(64)}];}}}};
 const form={name:'Orbit',symbol:'ORB',image:new Blob([PNG],{type:'image/png'})};
 const expect={401:/Reconnect/,413:/under 5 MB/,415:/PNG, JPG or WebP/,429:/Wait a few minutes/,502:/nothing was kept/,503:/not set up/};
 for(const [status,pattern] of Object.entries(expect)){
  const fetcher=async()=>new Response(JSON.stringify({error:'internal text'}),{status:Number(status)});
  await assert.rejects(uploadLaunchMetadata({form,wallet,account,fetcher,base:ORIGIN}),e=>pattern.test(e.message)&&e.status===Number(status),String(status));
 }
});
