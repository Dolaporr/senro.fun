// Read-only: no keypairs, signatures, transactions or wallet extensions.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export function deploymentSizes(byteLength,allocationBytes=byteLength){
 if(!Number.isSafeInteger(byteLength)||byteLength<4||byteLength>10*1024*1024||!Number.isSafeInteger(allocationBytes)||allocationBytes<byteLength||allocationBytes>10*1024*1024-45)throw Error('Invalid executable size or allocation.');
 return {program:36,programData:45+allocationBytes,uploadBuffer:37+byteLength};
}
export async function preflight({wallet,artifact,allocationBytes,reference=false,rpcUrl='https://api.mainnet-beta.solana.com',fetcher=fetch}){
 const payer=new PublicKey(wallet);if(!PublicKey.isOnCurve(payer.toBytes()))throw Error('Provide an on-curve fee-payer public address.');
 const url=new URL(rpcUrl);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('RPC must be HTTPS without basic credentials or a fragment.');
 const bytes=await readFile(artifact);if(!bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))throw Error('Artifact is not an ELF executable.');
 const sizes=deploymentSizes(bytes.length,allocationBytes);
 const allowed=new Set(['getGenesisHash','getBalance','getMinimumBalanceForRentExemption']);
 async function rpc(method,params=[]){
  if(!allowed.has(method))throw Error('Read-only RPC method required.');
  let data;
  try{const response=await fetcher(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('RPC unavailable. Check your endpoint privately; no transaction was submitted.');}
  if(data.error||!Object.hasOwn(data,'result'))throw Error('RPC returned an error; no transaction was submitted.');return data.result;
 }
 if(await rpc('getGenesisHash')!==MAINNET)throw Error('RPC is not Solana mainnet.');
 const balance=await rpc('getBalance',[payer.toBase58(),{commitment:'confirmed'}]);
 const rent={};for(const [name,size]of Object.entries(sizes)){rent[name]=await rpc('getMinimumBalanceForRentExemption',[size,{commitment:'confirmed'}]);if(!Number.isSafeInteger(rent[name])||rent[name]<0)throw Error('RPC returned invalid rent.');}
 if(!Number.isSafeInteger(balance.value)||balance.value<0)throw Error('RPC returned invalid balance.');
 const permanent=rent.program+rent.programData;
 return {kind:reference?'reference-build-estimate':'unverified-build-estimate',readyToDeploy:false,wallet:payer.toBase58(),cluster:'mainnet-beta',snapshotSlot:balance.context.slot,artifactBytes:bytes.length,artifactSha256:createHash('sha256').update(bytes).digest('hex'),allocationBytes:sizes.programData-45,accountSizes:sizes,balanceLamports:balance.value,rentLamports:rent,permanentAccountRentLamports:permanent,conservativeSeparateAccountFundingLamports:permanent+rent.uploadBuffer,permanentRentShortfallLamports:Math.max(0,permanent-balance.value),transactionFeesIncluded:false,notes:['Not a deployment budget or approval. Identity, final-build provenance, runtime validation and signing setup are not verified.','Temporary buffer funding and recovery depend on the CLI deployment flow; combined account funding is conservative, not an exact peak quote.','Upload transaction fees and any priority fees are additional. The selected CLI allocation must match this report.','No keypair is loaded and no transaction is signed or submitted.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),o={};
  for(let i=0;i<args.length;i++){const a=args[i];if(a==='--reference'){o.reference=true;continue;}const names={'--wallet':'wallet','--artifact':'artifact','--allocation-bytes':'allocationBytes'};if(!names[a]||!args[i+1])throw Error('Usage: node scripts/deployment-preflight.mjs --wallet PUBLIC_ADDRESS --artifact PATH [--allocation-bytes BYTES] [--reference]');o[names[a]]=args[++i];}
  if(!o.wallet||!o.artifact)throw Error('Provide --wallet and --artifact.');
  if(o.allocationBytes!==undefined)o.allocationBytes=Number(o.allocationBytes);
  console.log(JSON.stringify(await preflight({...o,rpcUrl:process.env.SENRO_RPC_URL??'https://api.mainnet-beta.solana.com'}),null,2));
 }catch(e){console.error(e instanceof Error?e.message:'Preflight failed');process.exitCode=1;}
}
