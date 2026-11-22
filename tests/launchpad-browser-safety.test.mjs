// The launchpad page runs in a browser. Node tests cannot see browser-only failures, and one slipped through
// once (Node's Buffer used in browser code). These checks keep the known failure classes out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browserFiles=['src/launchpad-create-tx.mjs','src/launchpad-flow.mjs','src/launch-client.mjs','src/launchpad-plan.mjs','src/launchpad-model.mjs','src/launchpad-metadata.mjs','src/launchpad.jsx','worker/launchpad-upload.mjs','src/nush-economics.mjs','src/setup-table.mjs','src/setup.jsx','src/nush-brand.jsx','src/launch-registry.mjs','src/launch-analytics.mjs'];
const read=f=>fs.readFileSync(new URL(`../${f}`,import.meta.url),'utf8');

test('browser-bundled launchpad modules use no Node-only APIs',()=>{
 for(const file of browserFiles){
  const code=read(file).replace(/\/\/.*$/gm,'');
  assert.doesNotMatch(code,/\bBuffer\b/,`${file} uses Buffer`);
  assert.doesNotMatch(code,/from ['"]node:|require\(|process\.env/,`${file} uses a Node-only module or env`);
 }
});

test('the launchpad and setup pages load the Buffer polyfill before anything else (the Pump SDK and web3.js need it)',()=>{
 for(const f of ['src/launchpad.jsx','src/setup.jsx'])assert.equal(read(f).split('\n')[0],"import './polyfills.mjs';",f);
});

test('no storage credential name appears in code the browser receives',()=>{
 for(const file of ['src/launchpad.jsx','src/launch-client.mjs','src/launchpad-flow.mjs'])assert.doesNotMatch(read(file),/PINATA|JWT|secret key|seed phrase/i,file);
});
