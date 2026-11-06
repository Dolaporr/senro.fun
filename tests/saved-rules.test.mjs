import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSnapshots,saveSnapshots,validateSnapshot} from '../src/saved-rules.mjs';
import {DEFAULT_CONFIG} from '../src/model.mjs';
const snapshot=()=>({id:'test-snapshot',name:'Steady hands',revision:2,createdAt:1793965000000,config:{...DEFAULT_CONFIG}});
function storage(){let data;return {getItem:()=>data??null,setItem:(k,v)=>{data=v}};}
test('saved rule copies round-trip and do not share mutable configuration',()=>{const store=storage(),item=snapshot();saveSnapshots(store,[item]);item.config.cap='0.9';assert.equal(loadSnapshots(store)[0].config.cap,'0.20');assert.notEqual(validateSnapshot(item).config,item.config);});
test('invalid and corrupted saved configurations never replace a draft',()=>{assert.deepEqual(loadSnapshots({getItem:()=>'{broken'}),[]);const good=snapshot(),bad={...good,config:{...good.config,cap:'0'}};assert.deepEqual(loadSnapshots({getItem:()=>JSON.stringify([bad,good])}),[good]);assert.throws(()=>validateSnapshot({...good,name:' '.repeat(3)}));assert.throws(()=>validateSnapshot({...good,config:{...good.config,capOn:'true'}}));});
test('saved copy count is bounded and unrecognized fields are excluded',()=>{const store=storage();saveSnapshots(store,Array.from({length:30},(_,i)=>({...snapshot(),id:'copy-'+i,signature:'never-store',config:{...DEFAULT_CONFIG,endpoint:'never-store'}})));const items=loadSnapshots(store);assert.equal(items.length,24);assert.equal(items[0].signature,undefined);assert.equal(items[0].config.endpoint,undefined);});
test('a storage write failure is surfaced rather than reported as saved',()=>{assert.throws(()=>saveSnapshots({setItem:()=>{throw Error('Storage full')}},[snapshot()]),/Storage full/);});
