import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {LOCAL_PROGRAM_ID} from '../protocol/client/guard.mjs';
import {verifyGuardRelease} from '../scripts/verify-guard-deployment.mjs';
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),key=n=>new PublicKey(new Uint8Array(32).fill(n));
const elf=Buffer.from([127,69,76,70,1,2,3,4]);
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture({badTail=false,badAuthority=false,wrongCluster=false,wrongPointer=false}={}){
 const manifest={programId:key(80).toBase58(),upgradeAuthority:key(81).toBase58(),artifactSha256:hash(elf)};
 const [programData]=PublicKey.findProgramAddressSync([key(80).toBuffer()],loader);
 const p=Buffer.alloc(36);p.writeUInt32LE(2);(wrongPointer?key(82):programData).toBuffer().copy(p,4);
 const d=Buffer.concat([Buffer.alloc(45),elf,Buffer.alloc(16)]);d.writeUInt32LE(3);d[12]=1;(badAuthority?key(82):key(81)).toBuffer().copy(d,13);if(badTail)d[d.length-1]=1;
 const methods=[];
 const connection={async getGenesisHash(){methods.push('getGenesisHash');return wrongCluster?'devnet':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';},async getMultipleAccountsInfoAndContext(keys){methods.push('getMultipleAccounts');assert.ok(keys[0].equals(key(80))&&keys[1].equals(programData));return {context:{slot:100},value:[{owner:loader,executable:true,data:p},{owner:loader,executable:false,data:d}]};}};
 return {manifest,artifact:elf,connection,methods,d};
}
test('release verifier matches ELF plus allocation padding without enabling or signing',async()=>{
 const f=fixture(),report=await verifyGuardRelease(f);assert.equal(report.artifactSha256,hash(elf));assert.equal(report.candidate.executableSha256,hash(f.d.subarray(45)));assert.equal(report.candidate.enabled,false);assert.equal(report.liveTradingEnabled,false);assert.equal(report.runtimeValidationRequired,true);assert.equal(report.allocationBytes,24);assert.ok(f.methods.every(m=>['getGenesisHash','getMultipleAccounts'].includes(m)));
});
test('release verifier rejects mismatched code, authority, chain and program pointer',async()=>{
 for(const broken of [{badTail:true},{badAuthority:true},{wrongCluster:true},{wrongPointer:true}])await assert.rejects(verifyGuardRelease(fixture(broken)));
 const f=fixture();await assert.rejects(verifyGuardRelease({...f,artifact:Buffer.from([127,69,76,70,9])}),/reviewed manifest/);
});
test('local test identities and missing authority declarations cannot become release candidates',async()=>{
 const f=fixture();await assert.rejects(verifyGuardRelease({...f,manifest:{...f.manifest,programId:LOCAL_PROGRAM_ID.toBase58()}}),/local test ID/);
 await assert.rejects(verifyGuardRelease({...f,manifest:{...f.manifest,upgradeAuthority:undefined}}),/explicitly/);
 assert.equal(f.methods.length,0);
});
