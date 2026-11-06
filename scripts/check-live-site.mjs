// Read-only post-deploy checks. Never sign or broadcast transactions.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {DEFAULT_CONFIG,makeCases} from '../src/model.mjs';

export async function checkLiveSite(value,{fetcher=fetch,report=console.log}={}){
 const target=new URL(value);
 if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Provide only the public HTTPS site origin.');
 const origin=target.origin;
 const get=(path,options={})=>fetcher(origin+path,{...options,signal:AbortSignal.timeout(20000)});
 async function asset(path,type){
  const response=await get(path);assert.equal(response.status,200,path+' missing');
  assert.match(response.headers.get('content-type')||'',type,path+' has the wrong content type');
  const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(bytes.length,path+' is empty');return bytes;
 }
 const html=new TextDecoder().decode(await asset('/',/text\/html/));assert.match(html,/SENRO/);assert.match(html,/rel="icon"/,'SENRO favicon link missing');
 const bundles=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);
 assert.ok(bundles.some(p=>p.endsWith('.js'))&&bundles.some(p=>p.endsWith('.css')),'Homepage must reference application JS and CSS');
 const [svg,manifest]=await Promise.all([
  asset('/favicon.svg',/image\/svg\+xml/),asset('/manifest.webmanifest',/(?:application\/manifest\+json|application\/json)/),
  ...['apple-touch-icon.png','icon-192.png','icon-512.png'].map(async name=>{
   const bytes=await asset('/icons/'+name,/image\/png/);assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10],name+' is not a PNG');
  }),
  ...bundles.map(p=>asset(p,p.endsWith('.css')?/text\/css/:/(?:text|application)\/javascript/)),
 ]);
 assert.match(new TextDecoder().decode(svg),/<svg\b/);
 const app=JSON.parse(new TextDecoder().decode(manifest));assert.match(app.name||app.short_name||'',/SENRO/i);assert.ok(app.icons?.some(i=>i.sizes==='192x192')&&app.icons?.some(i=>i.sizes==='512x512'),'Manifest app icons missing');
 report('PASS app, bundles and app icons');
 const bytes=await asset('/engine/senro_browser_guard.wasm',/application\/wasm/);
 const {instance}=await WebAssembly.instantiate(bytes,{});
 const cases=makeCases(instance.exports,DEFAULT_CONFIG);assert.ok(cases.length>=6&&cases.every(c=>c.matched),'Deployed rule engine returned an unexpected decision');
 report('PASS deployed rule engine: '+cases.length+' scenarios');
 assert.equal((await get('/api/solana')).status,405,'Read-only relay not deployed at /api/solana');
 const rpc=(method,requestOrigin=origin)=>get('/api/solana',{method:'POST',headers:{'content-type':'application/json',origin:requestOrigin},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
 const [denied,foreign]=await Promise.all([rpc('sendTransaction'),rpc('getGenesisHash','https://foreign.invalid')]);
 assert.equal(denied.status,400,'Relay must reject broadcast');assert.equal(foreign.status,403,'Relay must reject foreign origins');
 assert.ok((await denied.json()).error,'Broadcast denial must be a JSON error');assert.ok((await foreign.json()).error,'Origin denial must be a JSON error');
 const genesis=await rpc('getGenesisHash');assert.equal(genesis.status,200,'Live RPC is unavailable');assert.equal((await genesis.json()).result,'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','RPC is not mainnet');
 report('PASS read-only API, broadcast/origin denial and mainnet RPC');
 return {origin,scenarios:cases.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await checkLiveSite(process.argv[2]||'https://senrotech.netlify.app');}
 catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
}
