// Netlify functions run from a bundle where some npm packages fail at load (web3.js pulled rpc-websockets ->
// uuid, an ES module, and the deployed relay crashed with "require() of ES Module"). Server functions must
// therefore reach no npm package at all: only relative modules and node: built-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=new URL('..',import.meta.url).pathname;
const importsOf=file=>{const code=fs.readFileSync(file,'utf8');return [...code.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1]??m[2]);};
function walk(entry){
 const seen=new Set(),npm=[];
 const visit=file=>{
  if(seen.has(file))return;seen.add(file);
  for(const spec of importsOf(file)){
   if(spec.startsWith('node:'))continue;
   if(spec.startsWith('.'))visit(path.resolve(path.dirname(file),spec));
   else npm.push(`${path.relative(root,file)} -> ${spec}`);
  }
 };
 visit(entry);return {npm,files:[...seen].map(f=>path.relative(root,f))};
}

for(const fn of fs.readdirSync(path.join(root,'netlify/functions')).filter(f=>f.endsWith('.mjs'))){
 test(`netlify/functions/${fn} reaches no npm package`,()=>{
  const {npm}=walk(path.join(root,'netlify/functions',fn));
  assert.deepEqual(npm,[],`npm imports reached:\n${npm.join('\n')}`);
 });
}
