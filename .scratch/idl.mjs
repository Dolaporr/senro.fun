import {loadPumpSdk} from '../src/pump-sdk.mjs';
const s=await loadPumpSdk();const idl=s.PUMP_SDK.offlinePumpFeeProgram.idl;
for(const n of ['createFeeSharingConfig','updateFeeShares']){const ix=idl.instructions.find(i=>i.name===n);console.log('==',n,'args',JSON.stringify(ix.args));
for(const a of ix.accounts)console.log(' ',a.name,a.writable?'W':'',a.signer?'S':'',a.optional?'optional':'',a.address?'fixed':'',a.pda?'pda:'+JSON.stringify(a.pda.seeds.map(x=>x.kind==='const'?Buffer.from(x.value).toString().replace(/[^ -~]/g,'.'):x.path)):'',a.relations?'rel:'+a.relations:'')}
const t=idl.types.find(t=>/sharingconfig/i.test(t.name));console.log(t?.name,JSON.stringify(t?.type?.fields?.map(f=>[f.name,f.type])));
console.log('errors',idl.errors?.filter(e=>/shareholder|share|creator|curve|admin|authority/i.test(e.name)).map(e=>e.code+':'+e.name).join(', '));
