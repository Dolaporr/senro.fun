import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRule} from '../src/studio-preview.mjs';

test('trade-size examples compare exact quote units and allow the inclusive boundary',()=>{
 const below=previewRule({id:'cap',value:'0.20',quote:'SOL',percent:75});
 assert.equal(below.status,'pass');assert.equal(below.amount,150000000n);
 const at=previewRule({id:'cap',value:'0.20',quote:'SOL',percent:100});
 assert.equal(at.status,'pass');assert.equal(at.over,0n);
 const above=previewRule({id:'cap',value:'0.20',quote:'SOL',percent:125});
 assert.equal(above.status,'block');assert.equal(above.amount,250000000n);assert.equal(above.over,50000000n);
 assert.equal(above.detail,'0.05 SOL over your limit.');
});
test('USDC examples preserve six-decimal precision and do not round an excess away',()=>{
 const result=previewRule({id:'cap',value:'0.000001',quote:'USDC',percent:150});
 assert.equal(result.amount,2n);assert.equal(result.over,1n);assert.equal(result.status,'block');
});
test('rolling examples combine synthetic used volume and the next trade, including an exact fit',()=>{
 const at=previewRule({id:'rolling',value:'0.80',quote:'SOL',percent:75,exampleAmount:'0.20',minutes:'60'});
 assert.equal(at.amount,800000000n);assert.equal(at.status,'pass');
 const above=previewRule({id:'rolling',value:'0.80',quote:'SOL',percent:100,exampleAmount:'0.10',minutes:'60'});
 assert.equal(above.over,100000000n);assert.equal(above.status,'block');
});
test('cooldown examples allow a sell at the threshold and report the remaining wait',()=>{
 const early=previewRule({id:'cooldown',value:'30',elapsed:'10'});
 assert.equal(early.status,'block');assert.equal(early.remaining,20n);
 assert.equal(previewRule({id:'cooldown',value:'30',elapsed:'30'}).status,'pass');
});
test('account examples compare projected token balance with six-decimal precision',()=>{
 const above=previewRule({id:'account',value:'1000000',percent:125});
 assert.equal(above.amount,1250000000000n);assert.equal(above.over,250000000000n);assert.equal(above.status,'block');
});
test('invalid or unrepresentable limits and examples never produce a passing result',()=>{
 for(const value of ['', '0','-1','abc','18446744073709551616'])assert.equal(previewRule({id:'cap',value,quote:'SOL',percent:75}).status,'invalid');
 assert.equal(previewRule({id:'rolling',value:'0.8',quote:'SOL',percent:75,exampleAmount:'-1',minutes:'60'}).status,'invalid');
 assert.equal(previewRule({id:'rolling',value:'0.8',quote:'SOL',percent:75,exampleAmount:'0.1',minutes:'0'}).status,'invalid');
 assert.equal(previewRule({id:'cooldown',value:'1.5',elapsed:'1'}).status,'invalid');
 assert.equal(previewRule({id:'cap',value:'1',quote:'SOL',percent:NaN}).status,'invalid');
});
