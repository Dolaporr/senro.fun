// Read-only deployment evidence. No keypair, signing, send or config-write APIs.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Connection,PublicKey} from '@solana/web3.js';
import {LOCAL_PROGRAM_ID} from '../protocol/client/guard.mjs';
import {verifyDeployment} from '../src/guarded-trade.mjs';
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyGuardRelease({manifest,artifact,connection}){
 const programId=new PublicKey(manifest.programId);
 if(programId.equals(LOCAL_PROGRAM_ID)||programId.equals(PublicKey.default))throw Error('Use a final program identity, not the local test ID.');
 if(manifest.upgradeAuthority!==null&&!manifest.upgradeAuthority)throw Error('Record the expected upgrade authority explicitly.');
 const authority=manifest.upgradeAuthority===null?null:new PublicKey(manifest.upgradeAuthority).toBase58();
 const elf=Buffer.from(artifact);
 if(elf.length<4||elf.length>10*1024*1024||!elf.subarray(0,4).equals(Buffer.from([127,69,76,70])))throw Error('Provide the final built ELF artifact.');
 if(!/^[a-f0-9]{64}$/.test(manifest.artifactSha256??'')||hash(elf)!==manifest.artifactSha256)throw Error('Local artifact differs from the reviewed manifest.');
 if(await connection.getGenesisHash()!==MAINNET)throw Error('Deployment verifier requires Solana mainnet.');
 const [programData]=PublicKey.findProgramAddressSync([programId.toBuffer()],LOADER);
 const snapshot=await connection.getMultipleAccountsInfoAndContext([programId,programData],{commitment:'confirmed'});
 const data=snapshot.value?.[1];
 if(!data||data.executable||!data.owner.equals(LOADER)||data.data.length<45||data.data.readUInt32LE(0)!==3)throw Error('Expected deployed ProgramData account was not found.');
 const deployed=data.data.subarray(45);
 if(deployed.length<elf.length||!deployed.subarray(0,elf.length).equals(elf)||deployed.subarray(elf.length).some(byte=>byte!==0))throw Error('Deployed code does not match the reviewed artifact and zero-filled allocation.');
 // The browser pins the whole allocation, including loader padding, not just ELF bytes.
 const candidate={enabled:true,programId:programId.toBase58(),programData:programData.toBase58(),executableSha256:hash(deployed),upgradeAuthority:authority};
 const verifiedSlot=await verifyDeployment(connection,candidate,snapshot.context.slot);
 return {kind:'read-only-deployment-verification',cluster:'mainnet-beta',verifiedSlot,artifactSha256:hash(elf),artifactBytes:elf.length,allocationBytes:deployed.length,liveTradingEnabled:false,runtimeValidationRequired:true,candidate:{...candidate,enabled:false},notes:['Code/allocation hash and expected upgrade authority verified at the reported slot.','This does not prove embedded program identity, runtime compatibility, wallet transaction signing, rollback, or confirmation.','Do not enable the candidate until the final identity/build passes those release checks. No configuration was changed.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i+=2){if(!['--manifest','--artifact'].includes(args[i])||!args[i+1]||opts[args[i]])throw Error('Usage: node scripts/verify-guard-deployment.mjs --manifest REVIEWED_PUBLIC_JSON --artifact FINAL_SO');opts[args[i]]=args[i+1];}
  if(!opts['--manifest']||!opts['--artifact'])throw Error('Provide --manifest and --artifact.');
  const rpc=new URL(process.env.SENRO_RPC_URL||'https://api.mainnet-beta.solana.com');
  if(rpc.protocol!=='https:'||rpc.username||rpc.password||rpc.hash)throw Error('Provide an HTTPS RPC without basic credentials or a fragment.');
  const report=await verifyGuardRelease({manifest:JSON.parse(await readFile(opts['--manifest'],'utf8')),artifact:await readFile(opts['--artifact']),connection:new Connection(rpc.href,{commitment:'confirmed',disableRetryOnRateLimit:true})});
  console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(String(error.message).replace(/https?:\/\/[^\s"']+/g,'[RPC endpoint]'));process.exitCode=1;}
}
