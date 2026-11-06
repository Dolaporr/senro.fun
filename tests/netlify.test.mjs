import test from 'node:test';
import assert from 'node:assert/strict';
import solana,{config} from '../netlify/functions/solana.mjs';
import {handleRpc} from '../worker/rpc.mjs';
test('Netlify route uses the shared relay and never accepts a broadcast or foreign origin',async()=>{
 assert.equal(config.path,'/api/solana');assert.equal((await solana(new Request('https://senro.test/api/solana'))).status,405);
 const request=(method,origin)=>new Request('https://senro.test/api/solana',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
 assert.equal((await solana(request('sendTransaction','https://senro.test'))).status,400);
 assert.equal((await solana(request('getGenesisHash','https://foreign.test'))).status,403);
});
test('the relay cancels oversized streamed requests before reading or forwarding the rest',async()=>{
 let cancelled=false,forwarded=false;
 const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(9000));},cancel(){cancelled=true;}});
 const response=await handleRpc(new Request('https://senro.test/api/solana',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),()=>{forwarded=true;throw Error('Must not forward');});
 assert.equal(response.status,413);assert.equal(cancelled,true);assert.equal(forwarded,false);
});
