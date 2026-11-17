// Test wallet registered through the Wallet Standard. Local fixed test key; holds no funds.
(()=>{
 const seed=Uint8Array.from(__SEED__),address=__ADDR__;
 const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 const unb58=s=>{let n=0n;for(const c of s)n=n*58n+BigInt(A.indexOf(c));const out=[];while(n>0n){out.unshift(Number(n&255n));n>>=8n;}for(const c of s){if(c!=='1')break;out.unshift(0);}return Uint8Array.from(out);};
 const pub=unb58(address);
 let keyPromise;
 const key=()=>keyPromise??=crypto.subtle.importKey('pkcs8',Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20,...seed]),{name:'Ed25519'},false,['sign']);
 const sign=async bytes=>new Uint8Array(await crypto.subtle.sign('Ed25519',await key(),bytes));
 const account={address,publicKey:pub,chains:['solana:mainnet'],features:['solana:signTransaction','solana:signMessage']};
 window.__walletCalls=[];
 const wallet={version:'1.0.0',name:'Test Wallet',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiI+PGNpcmNsZSBjeD0iMTEiIGN5PSIxMSIgcj0iMTAiIGZpbGw9IiNjYWZmNjQiLz48L3N2Zz4=',chains:['solana:mainnet'],accounts:[account],
  features:{
   'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
   'standard:events':{version:'1.0.0',on:()=>()=>{}},
   'solana:signMessage':{version:'1.0.0',signMessage:async(...inputs)=>{window.__walletCalls.push('signMessage');return Promise.all(inputs.map(async({message})=>({signedMessage:message,signature:await sign(message)})))}},
   'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:[0],signTransaction:async(...inputs)=>{window.__walletCalls.push('signTransaction');return Promise.all(inputs.map(async({transaction})=>{const tx=Uint8Array.from(transaction);const msg=tx.slice(1+64*tx[0]);tx.set(await sign(msg),1);return {signedTransaction:tx};}))}}
  }};
 const register=api=>api.register(wallet);
 try{window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:register}))}catch{}
 window.addEventListener('wallet-standard:app-ready',e=>register(e.detail));
})();
