// Read-only post-deploy smoke check. No keys, transaction signatures or broadcasts.
import assert from 'node:assert/strict';
const target=new URL(process.argv[2]||'https://senrotech.netlify.app');
if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Provide only the public HTTPS site origin.');
const origin=target.origin;
async function get(path,options={}){const response=await fetch(origin+path,{...options,signal:AbortSignal.timeout(20000)});return response;}
const home=await get('/');assert.equal(home.status,200,'Homepage must load');const html=await home.text();assert.match(html,/SENRO/);assert.match(html,/rel="icon"/,'SENRO favicon link missing');
for(const path of ['/favicon.svg','/manifest.webmanifest','/icons/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png']){const r=await get(path);assert.equal(r.status,200,path+' missing');assert.ok((await r.arrayBuffer()).byteLength>0);}
const wasm=await get('/engine/senro_browser_guard.wasm');assert.equal(wasm.status,200);await WebAssembly.compile(await wasm.arrayBuffer());
for(const [,path] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))assert.equal((await get(path)).status,200,path+' missing');
assert.equal((await get('/api/solana')).status,405,'Read-only relay not deployed at /api/solana');
const rpc=(method,params=[])=>get('/api/solana',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
assert.equal((await rpc('sendTransaction')).status,400,'Relay must reject broadcast');
const genesis=await rpc('getGenesisHash');assert.equal(genesis.status,200,'Live RPC is unavailable');assert.equal((await genesis.json()).result,'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','RPC is not mainnet');
console.log('PASS',origin,'— app/assets/icons/WASM, API route, broadcast denial and mainnet RPC verified.');
