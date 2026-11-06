import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_CONFIG,makeCases,makePolicy,quantities,evaluate} from '../src/model.mjs';
import {parseAmount,policyFingerprint,encodePolicy,simulationTicket,validateSimulationTicket} from '../src/policy-client.mjs';
const bytes=await readFile(new URL('../public/engine/senro_browser_guard.wasm',import.meta.url));
const {instance}=await WebAssembly.instantiate(bytes,{});const engine=instance.exports;
test('browser-shipped Rust engine matches all default scenarios',()=>{
 const cases=makeCases(engine,DEFAULT_CONFIG);assert.equal(cases.length,6);
 assert.ok(cases.every(r=>r.matched));assert.deepEqual(cases.map(r=>r.code),[0,1,2,3,6,7]);
});
test('changing limits changes the actual engine decision',()=>{
 const amount=parseAmount('0.25',9);
 assert.equal(evaluate(engine,DEFAULT_CONFIG,amount),1);
 assert.equal(evaluate(engine,{...DEFAULT_CONFIG,cap:'0.30'},amount),0);
});
test('SOL and USDC exercise equivalent limits with their own decimal scales',()=>{
 const config={...DEFAULT_CONFIG,quote:'USDC'};
 assert.equal(quantities(config).cap,200000n);assert.equal(quantities(DEFAULT_CONFIG).cap,200000000n);
 assert.ok(makeCases(engine,config).every(r=>r.matched));
});
test('the optional account cap is checked after the synthetic fill',()=>{
 const config={...DEFAULT_CONFIG,accountOn:true};const c=makeCases(engine,config);
 assert.ok(c.every(r=>r.matched));assert.equal(c.find(r=>r.key==='balance').code,4);
});
test('review becomes invalid after an actual policy edit',async()=>{
 const policy=makePolicy(DEFAULT_CONFIG,1),messageBytes=encodePolicy(policy);
 const ticket=await simulationTicket({policy,messageBytes,cluster:'local-preview',simulatedAtSlot:100n,succeeded:true});
 assert.ok(await validateSimulationTicket(ticket,{policy,messageBytes,cluster:'local-preview',currentSlot:100n}));
 const changed=makePolicy({...DEFAULT_CONFIG,cap:'0.30'},2);
 assert.notEqual(await policyFingerprint(policy),await policyFingerprint(changed));
 await assert.rejects(validateSimulationTicket(ticket,{policy:changed,messageBytes:encodePolicy(changed),cluster:'local-preview',currentSlot:100n}),/rules changed/);
});
test('invalid editable limits are rejected before engine invocation',()=>{
 for(const config of [{...DEFAULT_CONFIG,cap:'0'},{...DEFAULT_CONFIG,minutes:'-1'},{...DEFAULT_CONFIG,cap:'0.0000000001'},{...DEFAULT_CONFIG,quote:'OTHER'}])assert.throws(()=>quantities(config));
});
test('synthetic window cases distinguish history capacity from a rolling-volume rejection',()=>{for(const cap of ['0.0005','0.000000001']){const cases=makeCases(engine,{...DEFAULT_CONFIG,cap});assert.ok(cases.every(r=>r.matched));assert.equal(cases.find(r=>r.key==='window').expected,8);}for(const rolling of ['0.000000001','0.000000003']){const cases=makeCases(engine,{...DEFAULT_CONFIG,cap:'0.000000001',rolling,cooldown:'1'});assert.ok(cases.every(r=>r.matched));assert.equal(cases.find(r=>r.key==='window').expected,0);}});
test('scenarios do not invent unrepresentable trades or post-balances above u64 maximum',()=>{const max='18446744073709.551615',cases=makeCases(engine,{...DEFAULT_CONFIG,cap:max,quote:'USDC',capOn:false,accountOn:true,account:max,rollingOn:false});assert.ok(!cases.some(r=>r.key==='balance'));assert.ok(cases.every(r=>r.matched));});
test('time windows that cannot fit the local scenario clock are rejected before WASM truncation',()=>{assert.throws(()=>quantities({...DEFAULT_CONFIG,minutes:'18446744073709551615'}),/Time window/);});
