// Official browse links open the app; they do not connect, sign or send.
export const MOBILE_WALLETS=Object.freeze([
 Object.freeze({id:'phantom',name:'Phantom',browse:'https://phantom.com/ul/browse/',icon:'/wallets/phantom.svg'}),
 Object.freeze({id:'solflare',name:'Solflare',browse:'https://solflare.com/ul/v1/browse/',icon:'/wallets/solflare.svg'}),
]);
export function mobileWalletTarget(value){
 const current=new URL(value);
 const local=current.protocol==='http:'&&['localhost','127.0.0.1','terminal.local'].includes(current.hostname);
 if(current.protocol!=='https:'&&!local||current.username||current.password)throw Error('Open SENRO over HTTPS to use a mobile wallet.');
 // Never forward RPC credentials, public addresses, arbitrary callbacks or hashes.
 const target=new URL(current.origin);target.pathname=current.pathname;target.searchParams.set('connectWallet','1');target.hash='studio';return target;
}
export function walletBrowseLink(id,value){
 const wallet=MOBILE_WALLETS.find(w=>w.id===id);if(!wallet)throw Error('Unsupported mobile wallet.');
 const target=mobileWalletTarget(value);
 return wallet.browse+encodeURIComponent(target.href)+'?ref='+encodeURIComponent(target.origin);
}
export function isMobileBrowser(nav){return /Android|iPhone|iPad|iPod/i.test(nav?.userAgent||'')||/Mac/i.test(nav?.platform||'')&&nav?.maxTouchPoints>1;}
export function consumeWalletHandoff(value){
 const url=new URL(value),open=url.searchParams.get('connectWallet')==='1';
 url.searchParams.delete('connectWallet');return {open,cleanPath:url.pathname+url.search+url.hash};
}
