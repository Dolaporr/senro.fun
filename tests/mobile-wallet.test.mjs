import test from 'node:test';
import assert from 'node:assert/strict';
import {MOBILE_WALLETS,walletBrowseLink,mobileWalletTarget,isMobileBrowser,consumeWalletHandoff} from '../src/mobile-wallet.mjs';
test('mobile handoffs use the documented wallet browse URLs and a same-origin studio target',()=>{
 for(const wallet of MOBILE_WALLETS){
  const link=new URL(walletBrowseLink(wallet.id,'https://senrotech.netlify.app/?rpc=secret&address=private#activity'));
  assert.equal(link.origin,new URL(wallet.browse).origin);
  const encoded=link.pathname.slice(new URL(wallet.browse).pathname.length);
  assert.equal(decodeURIComponent(encoded),'https://senrotech.netlify.app/?connectWallet=1#studio');
  assert.equal(link.searchParams.get('ref'),'https://senrotech.netlify.app');
  assert.ok(!link.href.includes('secret')&&!link.href.includes('private'));
 }
});
test('handoffs reject unsafe schemes, credentials and unknown wallets',()=>{
 for(const url of ['javascript:alert(1)','http://senro.test','https://user:password@senro.test/'])assert.throws(()=>mobileWalletTarget(url));
 assert.throws(()=>walletBrowseLink('unknown','https://senro.test/'));
 assert.equal(mobileWalletTarget('https://senro.test//foreign.test/path').origin,'https://senro.test');
});
test('wallet handoff opens only the connection panel and consumes the one-time UI hint',()=>{
 assert.deepEqual(consumeWalletHandoff('https://senro.test/?connectWallet=1#studio'),{open:true,cleanPath:'/#studio'});
 assert.equal(consumeWalletHandoff('https://senro.test/#studio').open,false);
 assert.equal(consumeWalletHandoff('https://senro.test/?connectWallet=true#studio').open,false);
});
test('phone and iPad desktop-mode detection does not imply an installed provider',()=>{
 assert.equal(isMobileBrowser({userAgent:'Mozilla iPhone',platform:'iPhone'}),true);
 assert.equal(isMobileBrowser({userAgent:'Mozilla Android'}),true);
 assert.equal(isMobileBrowser({userAgent:'Mozilla',platform:'MacIntel',maxTouchPoints:5}),true);
 assert.equal(isMobileBrowser({userAgent:'Chrome',platform:'MacIntel',maxTouchPoints:0}),false);
 assert.equal(isMobileBrowser(undefined),false);
});
