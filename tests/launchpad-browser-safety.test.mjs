// The launchpad page runs in a browser. Node tests cannot see browser-only failures, and one slipped through
// once (Node's Buffer used in browser code). These checks keep the known failure classes out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browserFiles=['src/launchpad-create-tx.mjs','src/launchpad-flow.mjs','src/launch-client.mjs','src/launchpad-plan.mjs','src/launchpad-model.mjs','src/launchpad-metadata.mjs','src/launchpad.jsx','worker/launchpad-upload.mjs'];
const read=f=>fs.readFileSync(new URL(`../${f}`,import.meta.url),'utf8');

test('browser-bundled launchpad modules use no Node-only APIs',()=>{
 for(const file of browserFiles){
  const code=read(file).replace(/\/\/.*$/gm,'');
  assert.doesNotMatch(code,/\bBuffer\b/,`${file} uses Buffer`);
  assert.doesNotMatch(code,/from ['"]node:|require\(|process\.env/,`${file} uses a Node-only module or env`);
 }
});

test('the launchpad page loads the Buffer polyfill before anything else (the Pump SDK and web3.js need it)',()=>{
 const first=read('src/launchpad.jsx').split('\n')[0];
 assert.equal(first,"import './polyfills.mjs';");
});

test('no storage credential name appears in code the browser receives',()=>{
 for(const file of ['src/launchpad.jsx','src/launch-client.mjs','src/launchpad-flow.mjs'])assert.doesNotMatch(read(file),/PINATA|JWT|secret key|seed phrase/i,file);
});
