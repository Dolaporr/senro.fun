// Local test stack. REAL: built browser bundle, launch relay, upload handler, Pump SDK.
// MOCKED: Solana upstream RPC, IPFS provider/gateway, wallet (in-page, local test key). No network use.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import BN from '../../node_modules/bn.js/lib/bn.js';
import {Keypair,PublicKey,VersionedTransaction} from '../../node_modules/@solana/web3.js/lib/index.cjs.js';
import {handleLaunchRpc} from '../../worker/launch-rpc.mjs';
import {handleUpload} from '../../worker/launchpad-upload.mjs';
import {GENESIS_HASH} from '../../src/launchpad-create-tx.mjs';
import {loadPumpSdk} from '../../src/pump-sdk.mjs';
import {base58} from '../../src/guarded-trade.mjs';
import {readEconomicsConfig,lookupTableAddresses} from '../../src/nush-economics.mjs';
import {altData} from '../../tests/helpers/nush-fixture.mjs';
import {E2E_TREASURY,E2E_LOOKUP_TABLE} from './fixture.mjs';

const sdk=await loadPumpSdk();
// The live build is made with these fee settings (see build.mjs); the relay enforces the same ones.
export const economics=readEconomicsConfig({treasury:E2E_TREASURY,lookupTable:E2E_LOOKUP_TABLE});
const tableAddresses=await lookupTableAddresses(E2E_TREASURY);
export const SEED=Uint8Array.from({length:32},(_,i)=>i+1);
export const WALLET=Keypair.fromSeed(SEED).publicKey.toBase58();
const BH=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
export const world={feesOn:true,mintsByCurve:new Map(),curves:new Set(),sent:[],simErr:null,status:'confirmed',calls:[],uploads:0,uploadFail:false};
const ok=v=>({context:{slot:42},value:v});

async function curve(creator){const z=new BN(0);return Buffer.from(await sdk.PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN('800000000000000'),virtualQuoteReserves:new BN('40230000000'),realTokenReserves:new BN('547239000000000'),realQuoteReserves:new BN('10230000000'),tokenTotalSupply:new BN('1000000000000000'),complete:false,creator:new PublicKey(creator),isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:z,canEditCreatorFee:false,isHolderReward:false,creatorFee:z,protocolFees:z,depth:0,initialVirtualQuoteReserves:z,postCompleteBaseOut:z,postCompleteQuoteIn:z})).toString('base64');}

async function globalData(){
 const c=sdk.PUMP_SDK.offlinePumpProgram.coder,idl=sdk.PUMP_SDK.offlinePumpProgram.idl;
 const zeroOf=t=>t==='bool'?false:t==='pubkey'?PublicKey.default:['u8','u16','u32'].includes(t)?0:typeof t==='object'&&t.array?Array.from({length:t.array[1]},()=>zeroOf(t.array[0])):new BN(0);
 const obj={};for(const f of idl.types.find(t=>t.name==='global').type.fields)obj[f.name]=zeroOf(f.type);
 obj.initialRealTokenReserves=new BN('793100000000000');
 const layout=c.types.typeLayouts.get('global'),buf=Buffer.alloc(layout.span);layout.encode(obj,buf);
 return Buffer.concat([Buffer.from(idl.accounts.find(a=>a.name==='global').discriminator),buf]).toString('base64');
}
const upstream=async(url,init)=>{
 const {method,params,id}=JSON.parse(init.body);world.calls.push(method);
 try{
  const r=await(async()=>{switch(method){
   case 'getGenesisHash':return GENESIS_HASH['mainnet-beta'];
   case 'getLatestBlockhash':return ok({blockhash:BH,lastValidBlockHeight:100});
   case 'isBlockhashValid':return ok(true);
   case 'getBalance':return ok(2_000_000_000);
   case 'getFeeForMessage':return ok(5000);
   case 'getBlockHeight':return 50;
   case 'simulateTransaction':{const a=params[1].accounts.addresses;if(world.simErr)return ok({err:world.simErr,logs:['Program 6EF8… invoke [1]','Program log: Instruction: CreateV2','Program log: custom program error: 0x1','Program 6EF8… failed'],unitsConsumed:1,accounts:null});return ok({err:null,logs:['ok'],unitsConsumed:150000,accounts:a.map((x,i)=>({lamports:i===0?1_976_540_000:1_000_000,owner:'11111111111111111111111111111111',data:['','base64'],executable:false,rentEpoch:0}))});}
   case 'sendTransaction':{const tx=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));world.sent.push(tx);world.mintsByCurve.set(sdk.bondingCurvePda(tx.message.staticAccountKeys[1]).toBase58(),tx.message.staticAccountKeys[1]);world.curves.add(sdk.bondingCurvePda(tx.message.staticAccountKeys[1]).toBase58());return base58(tx.signatures[0]);}
   case 'getSignatureStatuses':return ok([world.sent.length&&world.status?{slot:43,confirmations:null,err:null,confirmationStatus:world.status}:null]);
   case 'getMultipleAccounts':{
    const out=[];
    for(const key of params[0]){
     if(key===sdk.GLOBAL_PDA.toBase58())out.push({lamports:1,owner:sdk.PUMP_PROGRAM_ID.toBase58(),data:[await globalData(),'base64'],executable:false,rentEpoch:0});
     else if(key===sdk.creatorVaultPda(new PublicKey(WALLET)).toBase58())out.push({lamports:890_880+12_340_000,owner:'11111111111111111111111111111111',data:['','base64'],executable:false,rentEpoch:0});
     else if(key===E2E_LOOKUP_TABLE)out.push({lamports:1,owner:'AddressLookupTab1e1111111111111111111111111',data:[altData(tableAddresses).toString('base64'),'base64'],executable:false,rentEpoch:0});
     else if(world.curves.has(key))out.push({lamports:1,owner:sdk.PUMP_PROGRAM_ID.toBase58(),data:[await curve(world.feesOn?sdk.feeSharingConfigPda(world.mintsByCurve.get(key)).toBase58():WALLET),'base64'],executable:false,rentEpoch:0});
     else out.push({lamports:1,owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:['','base64'],executable:false,rentEpoch:0});
    }
    return ok(out);
   }
   default:throw Error('unexpected '+method);}})();
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result:r}));
 }catch(e){return new Response(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:e.message}}));}
};

const stored=new Map();
const provider={name:'fake-ipfs',async pinFile({bytes}){if(world.uploadFail)throw Object.assign(Error('x'),{status:502});world.uploads++;const c='Qm'+'a'.repeat(44);stored.set(c,bytes);return {cid:c,uri:`https://gateway.test/ipfs/${c}`};},async pinJson({document}){const c='Qm'+'b'.repeat(44);stored.set(c,JSON.stringify(document));return {cid:c,uri:`https://gateway.test/ipfs/${c}`};}};
const gateway=async u=>{const v=stored.get(String(u).split('/ipfs/')[1]);return typeof v==='string'?new Response(v,{headers:{'content-type':'application/json'}}):new Response(v);};

const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.wasm':'application/wasm'};
const walletScript=fs.readFileSync(new URL('./wallet-mock.js',import.meta.url),'utf8').replace('__SEED__',JSON.stringify([...SEED])).replace('__ADDR__',JSON.stringify(WALLET));

export function serve(root,port){
 return new Promise(resolve=>{
  const server=http.createServer(async(req,res)=>{
   const url=new URL(req.url,`http://localhost:${port}`);
   if(url.pathname.startsWith('/__')){
    const [,k]=url.pathname.split('/__');
    if(k==='reset'){Object.assign(world,{mintsByCurve:new Map(),curves:new Set(),sent:[],simErr:null,status:'confirmed',calls:[],uploads:0,uploadFail:false});}
    if(k==='simfail')world.simErr={InstructionError:[0,{Custom:1}]};
    if(k==='uploadfail')world.uploadFail=true;
    if(k==='pending')world.status=null;
    res.setHeader('content-type','application/json');return res.end(JSON.stringify({lookups:world.sent.map(t=>t.message.addressTableLookups.length),sent:world.sent.length,calls:world.calls,uploads:world.uploads}));
   }
   if(url.pathname==='/api/launch-rpc'||url.pathname==='/api/launchpad/upload'){
    const body=req.method==='POST'?Buffer.concat(await(async()=>{const c=[];for await(const x of req)c.push(x);return c;})()):undefined;
    const request=new Request(url,{method:req.method,headers:{...req.headers,origin:`http://localhost:${port}`},body});
    const response=url.pathname==='/api/launch-rpc'?await handleLaunchRpc(request,upstream,{economics:world.feesOn?economics:null}):await handleUpload(request,{provider,fetcher:gateway,seen:new Map(),retries:{attempts:1,delayMs:0,wait:async()=>{}}});
    res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
   }
   let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
   if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
   let data=fs.readFileSync(file);
   if((file.endsWith('launchpad.html')||file.endsWith('setup.html'))&&!url.searchParams.has('nowallet'))data=Buffer.from(String(data).replace('<head>',`<head><script>${walletScript}</script>`));
   res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream'});res.end(data);
  });
  server.listen(port,()=>resolve(server));
 });
}
