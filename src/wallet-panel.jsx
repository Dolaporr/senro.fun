import React,{useState} from 'react';
import {ArrowRight,Check,ChevronDown,LoaderCircle,ArrowUpRight} from 'lucide-react';
import {SenroIcon,WalletBrand} from './senro-icons.jsx';
import {MOBILE_WALLETS,walletBrowseLink,isMobileBrowser,mobileWalletTarget} from './mobile-wallet.mjs';
import './mobile-wallet.css';

export function MobileWalletLauncher({appUrl=location.href,mobile=isMobileBrowser(navigator)}){
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
 async function copy(){try{await navigator.clipboard.writeText(mobileWalletTarget(appUrl).href);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}
 return <section className="mobile-wallet-launcher" aria-label="Mobile wallet apps">
  <div className="wallet-list-heading"><span>{mobile?'Open your wallet app':'Using a phone?'}</span><span>Mobile</span></div>
  <p>Phone browsers cannot list your installed wallet apps. Open SENRO inside your wallet, then approve the connection there.</p>
  <div className="mobile-wallet-options">{MOBILE_WALLETS.map(w=><a key={w.id} className="wallet-choice mobile-wallet-choice" href={walletBrowseLink(w.id,appUrl)} rel="noreferrer"><img className="mobile-wallet-logo" src={w.icon} width="36" height="36" alt=""/><span className="wallet-provider-name"><strong>Open in {w.name}</strong><small>Continue in the wallet browser</small></span><span className="wallet-choice-arrow"><ArrowUpRight size={14}/></span></a>)}</div>
  <details className="mobile-wallet-help"><summary>Another wallet, or the app didn’t open?</summary><p>In your wallet app, open its Browser or Discover tab and paste this address:</p><code>{mobileWalletTarget(appUrl).href}</code><button type="button" className="text-link" onClick={copy}>{copied?'Link copied':'Copy SENRO link'}<SenroIcon name="connection" size={14}/></button>{copied&&<span role="status">Paste it into your wallet’s browser.</span>}{copyError&&<span role="alert">Copy the address above manually.</span>}</details>
  <p className="mobile-wallet-storage">Your saved drafts stay in this browser. Review the limits again in your wallet browser. If an app isn’t installed, its link may open the wallet’s website.</p>
 </section>;
}

export function WalletPanel({live,Action}){
 const [watch,setWatch]=useState(''),[pending,setPending]=useState('');
 const selected=live.wallets.find(w=>w.name===live.account?.name);
 async function choose(wallet){setPending(wallet.name);try{await live.connect(wallet)}finally{setPending('')}}
 return <div className="wallet-panel-body">
  <div className="wallet-panel-heading"><span className="wallet-panel-emblem"><SenroIcon name="connection" size={30}/></span><div><span className="wallet-panel-chain"><span/>SOLANA</span><p>Your wallet. Your control.</p></div></div>
  <p className="dialog-copy wallet-intro">Connect to preview trades with your balances. Connecting does not request a signature or move funds.</p>
  {live.account?<><div className="wallet-account-card"><div><WalletBrand wallet={selected??{name:live.account.name}} size={39}/><span><strong>{live.account.name}</strong><small>{live.account.kind==='wallet'?'Connected wallet':'Read-only address'}</small></span><span className="wallet-connected-indicator"><Check size={11}/></span></div><code>{live.account.address}</code></div><div className="wallet-account-actions">{live.account.kind==='wallet'&&<button onClick={live.openWalletCheck}><SenroIcon name="connection" size={18}/><span>Check wallet signing<small>Off-chain message only</small></span><ArrowUpRight size={15}/></button>}<button onClick={live.disconnect}><SenroIcon name="wallet" size={18}/><span>Disconnect wallet</span><ArrowRight size={15}/></button></div></>:<>
   {live.wallets.length>0?<><div className="wallet-list-heading"><span>Detected wallets</span><span>{live.wallets.length} available</span></div><div className="wallet-provider-list">{live.wallets.map(w=><button key={w.name} className="wallet-choice" onClick={()=>choose(w)} disabled={live.walletBusy}><WalletBrand wallet={w} size={35}/><span className="wallet-provider-name"><strong>{w.name}</strong><small>{live.walletBusy&&pending===w.name?'Waiting for approval…':'Detected in this browser'}</small></span>{live.walletBusy&&pending===w.name?<LoaderCircle className="wallet-spinner" size={16}/>:<span className="wallet-choice-arrow"><ArrowUpRight size={14}/></span>}</button>)}</div></>:<div className="wallet-browser-note"><SenroIcon name="wallet" size={22}/><div><strong>No wallet available in this browser</strong><p>On desktop, enable a Solana wallet extension. On your phone, use an option below.</p></div></div>}
   {live.wallets.length===0&&<MobileWalletLauncher/>}
   <details className="watch-address wallet-readonly"><summary><span className="readonly-icon"><SenroIcon name="address" size={18}/></span><span>Try a public address<small>Preview without connecting a wallet</small></span><ChevronDown size={14}/></summary><p>This is read-only. It does not prove wallet ownership.</p><form onSubmit={e=>{e.preventDefault();live.watch(watch)}}><label className="field-label" htmlFor="watch-address">Solana wallet address</label><input id="watch-address" className="plain-input" value={watch} onChange={e=>{setWatch(e.target.value);live.setWalletError('')}} placeholder="Paste a public wallet address" spellCheck={false} autoComplete="off"/><Action type="submit" disabled={!watch.trim()}>Use read-only address<ArrowRight size={15}/></Action></form></details>
  </>}
  {live.walletError&&<p role="alert" className="live-error light">{live.walletError}</p>}
  <div className="wallet-panel-footer"><SenroIcon name="connection" size={14}/><p>Wallet approval stays in your wallet.<br/><span>SENRO never asks for your recovery phrase.</span></p></div>
 </div>;
}
