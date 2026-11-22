// MOCKED upstream: the relay's validation runs for real against REAL create_v2 transactions built with
// the Pump SDK, but the upstream RPC is an in-memory fake. Nothing here touches a Solana cluster.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,TransactionInstruction} from '@solana/web3.js';
import {prepareLaunchPlan} from '../src/launchpad-plan.mjs';
import {buildLaunchTransaction} from '../src/launchpad-create-tx.mjs';
import {handleLaunchRpc,validateLaunchRpc,inspectLaunchWire,PUMP_PROGRAM_ID} from '../worker/launch-rpc.mjs';

const BLOCKHASH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const b64=tx=>Buffer.from(tx.serialize()).toString('base64');

async function launch({sign=false}={}){
 const creator=Keypair.generate(),mint=Keypair.generate();
 const plan=prepareLaunchPlan({form:{name:'Orbit',symbol:'ORB',description:'Test'},creator:creator.publicKey.toBase58(),mint:mint.publicKey.toBase58(),metadataUri:'https://example.com/o.json'});
 const {transaction}=await buildLaunchTransaction({plan,mintKeypair:mint,blockhash:BLOCKHASH,lastValidBlockHeight:100});
 if(sign)transaction.sign([creator,mint]);
 return {creator,mint,transaction};
}
const sim=(tx,over={})=>({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[b64(tx),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',...over}]});
const send=(tx,over={})=>({jsonrpc:'2.0',id:1,method:'sendTransaction',params:[b64(tx),{encoding:'base64',skipPreflight:false,maxRetries:0,...over}]});
const post=(body,{headers={}}={})=>new Request('https://nush.test/api/launch-rpc',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const rejects=(body,pattern)=>assert.rejects(validateLaunchRpc(body),pattern);

test('a real create_v2 launch passes inspection; simulation needs no signatures, sending needs both',async()=>{
 const {transaction}=await launch();
 assert.ok(inspectLaunchWire(b64(transaction)));
 await validateLaunchRpc(sim(transaction));
 await rejects(send(transaction),/Both launch signatures/);
});

test('send accepts a fully and validly signed launch',async()=>{
 const {transaction}=await launch({sign:true});
 assert.ok(await validateLaunchRpc(send(transaction)));
});

test('send rejects a forged or half-signed launch',async()=>{
 const full=await launch({sign:true});
 const forged=VersionedTransaction.deserialize(full.transaction.serialize());forged.signatures[1]=new Uint8Array(64).fill(9);
 await rejects(send(forged),/Both launch signatures/);
 // the builder partial-signs with the mint key, so an unsigned-by-creator launch is the half-signed case
 const noCreator=await launch();
 await rejects(send(noCreator.transaction),/Both launch signatures/);
 const noMint=VersionedTransaction.deserialize(full.transaction.serialize());noMint.signatures[1]=new Uint8Array(64);
 await rejects(send(noMint),/Both launch signatures/);
 const swapped=VersionedTransaction.deserialize(full.transaction.serialize());[swapped.signatures[0],swapped.signatures[1]]=[swapped.signatures[1],swapped.signatures[0]];
 await rejects(send(swapped),/Both launch signatures/);
});

test('rejects transactions that are not a Pump create_v2 launch',async()=>{
 const payer=Keypair.generate(),other=Keypair.generate();
 const make=(instructions,signers=[payer])=>{const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:BLOCKHASH,instructions}).compileToV0Message());tx.sign(signers);return tx;};
 const transfer=SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:other.publicKey,lamports:1});
 await rejects(sim(make([transfer])),/two signers/);
 const twoSignerTransfer=make([SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:other.publicKey,lamports:1}),new TransactionInstruction({programId:SystemProgram.programId,keys:[{pubkey:other.publicKey,isSigner:true,isWritable:false}],data:Buffer.alloc(0)})],[payer,other]);
 await rejects(sim(twoSignerTransfer),/Only the Pump program/);
 const wrongIx=new TransactionInstruction({programId:new PublicKey(PUMP_PROGRAM_ID),keys:[{pubkey:other.publicKey,isSigner:true,isWritable:false}],data:Buffer.from([1,2,3,4,5,6,7,8])});
 await rejects(sim(make([wrongIx],[payer,other])),/create_v2/);
 const budgetAbuse=new TransactionInstruction({programId:ComputeBudgetProgram.programId,keys:[],data:Buffer.from([4,0,0,0,0])});
 const {transaction}=await launch();
 const base=transaction.message;
 const withBudget=new VersionedTransaction(new TransactionMessage({payerKey:base.staticAccountKeys[0],recentBlockhash:BLOCKHASH,instructions:[budgetAbuse,...base.compiledInstructions.map(ix=>new TransactionInstruction({programId:base.staticAccountKeys[ix.programIdIndex],keys:ix.accountKeyIndexes.map(i=>({pubkey:base.staticAccountKeys[i],isSigner:base.isAccountSigner(i),isWritable:base.isAccountWritable(i)})),data:Buffer.from(ix.data)}))]}).compileToV0Message());
 await rejects(sim(withBudget),/compute limit and price/);
});

test('rejects a second Pump instruction smuggled next to the create',async()=>{
 const {transaction}=await launch();
 const m=transaction.message;
 const ixs=m.compiledInstructions.map(ix=>new TransactionInstruction({programId:m.staticAccountKeys[ix.programIdIndex],keys:ix.accountKeyIndexes.map(i=>({pubkey:m.staticAccountKeys[i],isSigner:m.isAccountSigner(i),isWritable:m.isAccountWritable(i)})),data:Buffer.from(ix.data)}));
 const pump=ixs.find(ix=>ix.programId.toBase58()===PUMP_PROGRAM_ID);
 const doubled=new VersionedTransaction(new TransactionMessage({payerKey:m.staticAccountKeys[0],recentBlockhash:BLOCKHASH,instructions:[...ixs,pump]}).compileToV0Message());
 await rejects(sim(doubled),/exactly one Pump create/);
});

test('simulation must be an unsigned check of the exact message',async()=>{
 const {transaction}=await launch();
 await rejects(sim(transaction,{replaceRecentBlockhash:true}),/exact message/);
 await rejects(sim(transaction,{sigVerify:true}),/exact message/);
 await rejects(sim(transaction,{encoding:'base58'}),/exact message/);
 await rejects(sim(transaction,{accounts:{addresses:Array(9).fill('11111111111111111111111111111111')}}),/at most eight/);
});

test('send must use preflight and no relay retries',async()=>{
 const {transaction}=await launch({sign:true});
 await rejects(send(transaction,{skipPreflight:true}),/preflight/);
 await rejects(send(transaction,{maxRetries:5}),/preflight/);
 await rejects(send(transaction,{encoding:'base58'}),/preflight/);
});

test('garbage, oversized and malformed transactions are refused',async()=>{
 await rejects({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:['!!!notbase64',{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false}]},/Invalid/);
 await rejects({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:['A'.repeat(2000),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false}]},/size/);
 await rejects({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[Buffer.alloc(300).toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false}]},/Invalid|v0|signers/);
 await rejects({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[]},/Invalid|exact message/);
});

test('method allow-list: reads pass with limits; everything else, including batches, is refused',async()=>{
 for(const method of ['getGenesisHash','getBalance','getFeeForMessage','isBlockhashValid','getLatestBlockhash','getBlockHeight'])assert.ok(await validateLaunchRpc({jsonrpc:'2.0',id:1,method,params:[]}));
 await rejects({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[Array(9).fill('x')]},/at most 8/);
 await rejects({jsonrpc:'2.0',id:1,method:'getSignatureStatuses',params:[['a','b']]},/one signature/);
 assert.ok(await validateLaunchRpc({jsonrpc:'2.0',id:1,method:'getSignatureStatuses',params:[['a'],{searchTransactionHistory:true}]}));
 for(const method of ['requestAirdrop','getProgramAccounts','getAccountInfo','sendBundle','getTokenLargestAccounts','simulateBundle'])await rejects({jsonrpc:'2.0',id:1,method,params:[]},/not allowed/);
 await rejects([{jsonrpc:'2.0',id:1,method:'getBlockHeight'}],/Invalid JSON-RPC/);
 await rejects({id:1,method:'getBlockHeight'},/Invalid JSON-RPC/);
 await rejects({jsonrpc:'2.0',id:1,method:'getBlockHeight',params:{a:1}},/parameters/);
});

test('HTTP layer: method, origin, size, bad JSON',async()=>{
 const ok={jsonrpc:'2.0',id:1,method:'getBlockHeight',params:[]};
 const fetcher=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:5}));
 assert.equal((await handleLaunchRpc(new Request('https://nush.test/api/launch-rpc'),fetcher)).status,405);
 assert.equal((await handleLaunchRpc(post(ok,{headers:{origin:'https://evil.test'}}),fetcher)).status,403);
 assert.equal((await handleLaunchRpc(post('{nope'),fetcher)).status,400);
 assert.equal((await handleLaunchRpc(post('x'.repeat(9000)),fetcher)).status,413);
 const good=await handleLaunchRpc(post(ok,{headers:{origin:'https://nush.test'}}),fetcher);
 assert.equal(good.status,200);assert.equal((await good.json()).result,5);
 assert.equal(good.headers.get('cache-control'),'no-store');
});

test('forwarding: validated body only, falls back across upstreams, surfaces rate limits and outages',async()=>{
 const ok={jsonrpc:'2.0',id:7,method:'getBlockHeight',params:[]};
 const seen=[];
 const fallback=async url=>{seen.push(url);if(seen.length===1)return new Response('',{status:500});return new Response(JSON.stringify({jsonrpc:'2.0',id:7,result:9}));};
 const r=await handleLaunchRpc(post(ok),fallback);
 assert.equal((await r.json()).result,9);assert.equal(seen.length,2);
 const limited=await handleLaunchRpc(post(ok),async()=>new Response('',{status:429}));
 assert.equal(limited.status,429);
 const down=await handleLaunchRpc(post(ok),async()=>{throw Error('offline')});
 assert.equal(down.status,502);
 const rpcRate=await handleLaunchRpc(post(ok),async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:7,error:{code:-32005,message:'slow'}})));
 assert.equal(rpcRate.status,429);
 // an upstream only ever receives the validated request body
 let forwarded;
 await handleLaunchRpc(post({...ok,extra:'ignored'}),async(url,init)=>{forwarded=JSON.parse(init.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:7,result:1}));});
 assert.equal(forwarded.method,'getBlockHeight');
});

test('end to end through the HTTP layer: a real launch simulates, a transfer is stopped before any upstream call',async()=>{
 const {transaction}=await launch();
 let upstreamCalls=0;
 const fetcher=async()=>{upstreamCalls++;return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:1},value:{err:null}}}));};
 assert.equal((await handleLaunchRpc(post(sim(transaction)),fetcher)).status,200);
 assert.equal(upstreamCalls,1);
 const payer=Keypair.generate();
 const evil=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:BLOCKHASH,instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message());
 evil.sign([payer]);
 assert.equal((await handleLaunchRpc(post(send(evil)),fetcher)).status,400);
 assert.equal(upstreamCalls,1,'the arbitrary transfer never reached an upstream');
});

// ---- rate limits and private RPC (added with the production hardening) ----
import {createLaunchLimiters,clientKey,launchUpstreams,PUBLIC_UPSTREAMS,LIMITS} from '../worker/launch-rpc.mjs';

test('per-client limits: reads, simulations and sends have separate budgets; a spoofed forwarded-for does not help',async()=>{
 let t=0;const limiters=createLaunchLimiters(()=>t);
 const fetcher=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:1}));
 const read=(ip,headers={})=>handleLaunchRpc(post({jsonrpc:'2.0',id:1,method:'getBlockHeight',params:[]},{headers}),fetcher,{limiters,ip});
 for(let i=0;i<LIMITS.read.limit;i++)assert.equal((await read('1.1.1.1')).status,200);
 const blocked=await read('1.1.1.1');assert.equal(blocked.status,429);assert.match((await blocked.json()).error.message,/Too many requests/);
 assert.equal((await read('1.1.1.1',{'x-forwarded-for':'9.9.9.9'})).status,429,'rotating x-forwarded-for does not reset the budget');
 assert.equal((await read('2.2.2.2')).status,200,'another client is unaffected');
 const {transaction}=await launch();
 assert.equal((await handleLaunchRpc(post(sim(transaction)),fetcher,{limiters,ip:'1.1.1.1'})).status,200,'simulation has its own budget');
 t+=LIMITS.read.windowMs+1;assert.equal((await read('1.1.1.1')).status,200,'the window slides');
});

test('sends are limited to a handful per connection',async()=>{
 const limiters=createLaunchLimiters(()=>0);
 const fetcher=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'sig'}));
 const statuses=[];
 for(let i=0;i<LIMITS.send.limit+1;i++){const {transaction}=await launch({sign:true});statuses.push((await handleLaunchRpc(post(send(transaction)),fetcher,{limiters,ip:'3.3.3.3'})).status);}
 assert.deepEqual(statuses,[...Array(LIMITS.send.limit).fill(200),429]);
});

test('client key trusts only platform addresses',()=>{
 const req=h=>new Request('https://nush.test/api/launch-rpc',{headers:h});
 assert.equal(clientKey(req({'x-forwarded-for':'6.6.6.6'})),'shared');
 assert.equal(clientKey(req({'x-nf-client-connection-ip':'5.5.5.5','x-forwarded-for':'6.6.6.6'})),'5.5.5.5');
 assert.equal(clientKey(req({}),'7.7.7.7'),'7.7.7.7');
});

test('a private RPC goes first, public ones stay as fallback; bad config is refused; the key never leaks',async()=>{
 assert.deepEqual(launchUpstreams(undefined),PUBLIC_UPSTREAMS);
 const ups=launchUpstreams('https://mainnet.helius-rpc.com/?api-key=SECRETKEY');
 assert.equal(ups[0],'https://mainnet.helius-rpc.com/?api-key=SECRETKEY');assert.deepEqual(ups.slice(1),PUBLIC_UPSTREAMS);
 assert.throws(()=>launchUpstreams('http://insecure.example'),/HTTPS/);assert.throws(()=>launchUpstreams('nope'),/valid URL/);
 const tried=[];
 const r=await handleLaunchRpc(post({jsonrpc:'2.0',id:1,method:'getBlockHeight',params:[]}),async url=>{tried.push(url);throw Error('down');},{upstreams:ups});
 assert.equal(tried[0],ups[0]);assert.equal(r.status,502);assert.ok(!JSON.stringify(await r.json()).includes('SECRETKEY'));
});
