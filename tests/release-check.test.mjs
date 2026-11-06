import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkLiveSite} from '../scripts/check-live-site.mjs';
import {requireSimulationSuccess} from '../scripts/simulation-check.mjs';
const wasm=await readFile(new URL('../public/engine/senro_browser_guard.wasm',import.meta.url));
function deployment({htmlFallback=false,wrongCluster=false,corruptWasm=false}={}){
 return async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/')return new Response('<title>SENRO</title><link rel="icon" href="/favicon.svg"><script src="/assets/app.js"></script><link href="/assets/app.css">',{headers:{'content-type':'text/html'}});
  if(path==='/favicon.svg')return new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}});
  if(path==='/manifest.webmanifest')return Response.json({name:'SENRO',icons:[{sizes:'192x192'},{sizes:'512x512'}]});
  if(path.endsWith('.png'))return htmlFallback?new Response('<html>SPA fallback</html>',{headers:{'content-type':'text/html'}}):new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
  if(path.endsWith('.js')||path.endsWith('.css'))return new Response('/* bundle */',{headers:{'content-type':path.endsWith('.css')?'text/css':'text/javascript'}});
  if(path.endsWith('.wasm'))return new Response(corruptWasm?new Uint8Array([0,1,2]):wasm,{headers:{'content-type':'application/wasm'}});
  if(path==='/api/solana'){
   if(!options.method)return new Response('',{status:405});
   if(options.headers.origin==='https://foreign.invalid')return Response.json({error:'foreign origin'},{status:403});
   if(JSON.parse(options.body).method==='sendTransaction')return Response.json({error:'denied'},{status:400});
   return Response.json({result:wrongCluster?'devnet':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'});
  }
  throw Error('Unexpected request: '+path);
 };
}
test('release check executes the deployed WASM and verifies the app and mainnet relay',async()=>{
 const stages=[];const result=await checkLiveSite('https://senro.test',{fetcher:deployment(),report:m=>stages.push(m)});
 assert.equal(result.scenarios,6);assert.equal(stages.length,3);
});
test('release check rejects HTML asset fallbacks, corrupted WASM and the wrong cluster',async()=>{
 for(const broken of [{htmlFallback:true},{corruptWasm:true},{wrongCluster:true}])await assert.rejects(checkLiveSite('https://senro.test',{fetcher:deployment(broken),report:()=>{}}));
});
test('failed venue simulation cannot be reported as a passing smoke check',()=>{
 const result={ok:true};assert.equal(requireSimulationSuccess(result),result);
 for(const value of [null,{}, {ok:false,error:{InstructionError:[0,'Custom']}}])assert.throws(()=>requireSimulationSuccess(value),/Venue simulation failed/);
});
