import './polyfills.mjs';
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VersionedTransaction} from '@solana/web3.js';
import {getWallets} from '@wallet-standard/app';
import {Check,Info,ExternalLink} from 'lucide-react';
import {createLaunchConnection} from './launch-client.mjs';
import {buildLookupTableSetup} from './setup-table.mjs';
import {loadLookupTable,readEconomicsConfig,LAUNCH_FEE_LAMPORTS,TREASURY_SHARE_BPS} from './nush-economics.mjs';
import {base58} from './guarded-trade.mjs';
import {NushMark} from './nush-brand.jsx';
import './launchpad.css';

// One-time setup, done by the owner from the treasury wallet. Not linked from the site.
const CONFIGURED_TREASURY=import.meta.env?.VITE_NUSH_TREASURY??'';
const CONFIGURED_TABLE=import.meta.env?.VITE_NUSH_LOOKUP_TABLE??'';
const short=(a,n=6)=>a?`${a.slice(0,n)}…${a.slice(-n)}`:'';

function App(){
 const connection=useMemo(()=>createLaunchConnection(),[]);
 const [wallets,setWallets]=useState([]),[account,setAccount]=useState(null),[wallet,setWallet]=useState(null);
 const [stage,setStage]=useState('idle'),[error,setError]=useState(''),[result,setResult]=useState(null),[check,setCheck]=useState('');
 useEffect(()=>{const api=getWallets(),refresh=()=>setWallets(api.get().filter(w=>w.chains.some(c=>c.startsWith('solana:'))&&w.features['standard:connect']));refresh();const a=api.on('register',refresh),b=api.on('unregister',refresh);return()=>{a();b();}},[]);
 const mismatch=account&&CONFIGURED_TREASURY&&account.address!==CONFIGURED_TREASURY;

 async function connect(w){setError('');try{const out=await w.features['standard:connect'].connect();const a=(out.accounts??w.accounts).find(x=>x.chains.includes('solana:mainnet'));if(!a)throw Error('This wallet has no Solana mainnet account.');setWallet(w);setAccount(a);}catch(e){setError(String(e.message??e).slice(0,200));}}

 async function create(){
  setError('');setStage('building');
  try{
   const send=wallet.features['solana:signAndSendTransaction'];
   if(!send)throw Error('This wallet cannot send transactions itself. Use Phantom or Solflare.');
   const [slot,{blockhash}]=await Promise.all([connection.getSlot('finalized'),connection.getLatestBlockhash('confirmed')]);
   const {transaction,table,count}=await buildLookupTableSetup({treasury:account.address,recentSlot:slot,blockhash});
   setStage('signing');
   const [out]=await send.signAndSendTransaction({account,chain:'solana:mainnet',transaction:transaction.serialize()});
   const signature=base58(out.signature);
   setResult({table,count,signature});setStage('checking');
   const economics=readEconomicsConfig({treasury:account.address,lookupTable:table});
   for(let i=0;i<20;i++){
    try{await loadLookupTable({connection,economics});setStage('done');return;}catch(e){setCheck(e.message);}
    await new Promise(r=>setTimeout(r,3000));
   }
   setStage('unconfirmed');
  }catch(e){setError(String(e.message??e).slice(0,240));setStage('idle');}
 }

 async function verifyExisting(){
  setCheck('Checking…');
  try{const economics=readEconomicsConfig({treasury:CONFIGURED_TREASURY,lookupTable:CONFIGURED_TABLE});if(!economics)throw Error('Nothing is configured yet.');await loadLookupTable({connection,economics});setCheck('The configured table is on-chain and complete. Launch fees are ready.');}
  catch(e){setCheck(e.message);}
 }

 return <>
  <header className="lp-nav"><a className="lp-brand" href="/" aria-label="Nush home"><NushMark/>nush</a><span/><span/></header>
  <main className="lp-bench" style={{gridTemplateColumns:'minmax(0,640px)',justifyContent:'center'}}>
   <div className="lp-form">
    <section className="lp-section">
     <h2>One-time setup</h2>
     <p className="lp-sheet-sub">Every Nush launch pays a {LAUNCH_FEE_LAMPORTS/1e9} SOL fee and shares {TREASURY_SHARE_BPS/100}% of the coin's creator fees with the treasury. That makes the launch too large for one transaction unless Nush has an address lookup table. The treasury wallet creates it once, here, for a one-off rent deposit of about 0.005 SOL.</p>
     <ol className="lp-setup-steps">
      <li>Connect the <b>treasury wallet</b>: a fresh wallet used only for Nush fees.</li>
      <li>Create the table. Your wallet asks once. The table is frozen, so nobody can change it later.</li>
      <li>Copy the two values shown into Netlify and redeploy.</li>
     </ol>
    </section>

    {CONFIGURED_TREASURY&&CONFIGURED_TABLE&&<section className="lp-section">
     <h2>Already set up?</h2>
     <dl className="lp-facts"><div><dt>Treasury</dt><dd><code>{short(CONFIGURED_TREASURY)}</code></dd></div><div><dt>Lookup table</dt><dd><code>{short(CONFIGURED_TABLE)}</code></dd></div></dl>
     <div className="lp-actions"><p>Check that the configured table is live and complete.</p><button className="lp-ghost" onClick={verifyExisting}>Check setup</button></div>
     {check&&stage==='idle'&&<div className="lp-note"><Info size={16}/><span>{check}</span></div>}
    </section>}

    <section className="lp-section">
     <h2>Create the table</h2>
     {!account&&(wallets.length?wallets.map(w=><button key={w.name} className="lp-wallet-choice" onClick={()=>connect(w)}>{w.icon&&<img src={w.icon} alt="" width="22" height="22"/>}Connect {w.name}</button>):<div className="lp-note"><Info size={16}/><span>No Solana wallet found. Open this page in a browser with Phantom or Solflare.</span></div>)}
     {account&&<dl className="lp-facts"><div><dt>Connected wallet</dt><dd><code>{short(account.address)}</code></dd></div></dl>}
     {mismatch&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>This is not the treasury set on the site ({short(CONFIGURED_TREASURY)}). Connect that wallet, or change VITE_NUSH_TREASURY first.</span></div>}
     {account&&stage==='idle'&&<div className="lp-actions"><p>Your wallet shows the transaction before you approve it.</p><button className="lp-primary" disabled={mismatch} onClick={create}>Create lookup table</button></div>}
     {['building','signing','checking'].includes(stage)&&<div className="lp-note"><Info size={16}/><span>{stage==='building'?'Preparing…':stage==='signing'?'Approve in your wallet.':'Sent. Waiting for the table to appear on-chain…'}</span></div>}
     {result&&<div className="lp-note"><Check size={16}/><span>Transaction <a href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">{short(result.signature,8)} <ExternalLink size={11}/></a></span></div>}
     {stage==='unconfirmed'&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>The table did not appear yet. Check the transaction link, then reload and use "Check setup". Do not create a second table unless the first failed.</span></div>}
     {error&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>{error}</span></div>}
    </section>

    {stage==='done'&&result&&<section className="lp-section">
     <h2>Now add these to Netlify</h2>
     <p className="lp-sheet-sub">Site configuration, Environment variables. Then trigger a redeploy.</p>
     <dl className="lp-facts lp-copy">
      <div><dt>VITE_NUSH_TREASURY</dt><dd><code>{account.address}</code></dd></div>
      <div><dt>VITE_NUSH_LOOKUP_TABLE</dt><dd><code>{result.table}</code></dd></div>
     </dl>
    </section>}
   </div>
  </main>
 </>;
}
createRoot(document.getElementById('setup-root')).render(<App/>);
