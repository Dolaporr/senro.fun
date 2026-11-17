import './polyfills.mjs';
import React,{useState,useEffect,useRef,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowUpRight,Check,ImagePlus,Info,ExternalLink} from 'lucide-react';
import {getWallets} from '@wallet-standard/app';
import {validateLaunch} from './launchpad-model.mjs';
import {createLaunchFlow,DISABLED_REASON} from './launchpad-flow.mjs';
import {createLaunchConnection,uploadLaunchMetadata} from './launch-client.mjs';
import './launchpad.css';

// Live launches stay off unless the deployment is built with VITE_LAUNCH_ENABLED=true.
const LAUNCH_ENABLED=import.meta.env?.VITE_LAUNCH_ENABLED==='true';
const PENDING_KEY='senro-pending-launch';
const initial={name:'',symbol:'',description:'',website:'',twitter:'',telegram:'',image:null};
const short=(a,n=4)=>a?`${a.slice(0,n)}…${a.slice(-n)}`:'';
const sol=l=>l==null?'Not available':`${(l/1e9).toFixed(l<1e6?6:4)} SOL`;
const readPending=()=>{try{const r=JSON.parse(sessionStorage.getItem(PENDING_KEY));return r&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(r.signature)?r:null;}catch{return null;}};

// The launch really is a sequence, so the steps are numbered.
const STEPS=[
 ['Store the artwork','Pinned to IPFS, then read back and compared.'],
 ['Build the transaction','One Pump create instruction, nothing else.'],
 ['Simulate it','Run against the network without signing.'],
 ['Review','You see the cost before anything is signed.'],
 ['Sign in your wallet','Your wallet asks once.'],
 ['Send and confirm','Sent once, never retried.'],
 ['Check on-chain','The mint and its curve are read back.']
];
const POSITION={uploading:[0],building:[1],simulating:[2],ready:[3],blocked:[3],'simulation-failed':[2,true],signing:[4],submitting:[5],confirming:[5],launched:[7],failed:[5,true],expired:[5,true],unknown:[5,true],unverified:[6,true]};

function Mark(){return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M23 9H12a4 4 0 0 0 0 8h8a4 4 0 0 1 0 8H9" stroke="currentColor" strokeWidth="4" strokeLinecap="square"/></svg>}

function Steps({stage,lastIndex,compact}){
 let [index,failed]=POSITION[stage]??(stage==='error'?[lastIndex,true]:[-1]);
 return <ol className={compact?'lp-steps compact':'lp-steps'}>{STEPS.map(([title,detail],i)=>{
  const s=failed&&i===index?'bad':i<index?'done':i===index?'now':'pending';
  return <li className="lp-step" data-s={s} key={title}><span className="lp-step-mark">{s==='done'?<Check size={14}/>:s==='now'?<i/>:s==='bad'?'!':i+1}</span><div><b>{title}</b><small>{detail}</small></div></li>;
 })}</ol>;
}

function App(){
 const [form,setForm]=useState(initial),[sheet,setSheet]=useState(false),[wallets,setWallets]=useState([]),[picker,setPicker]=useState(false),[connected,setConnected]=useState(null),[walletError,setWalletError]=useState(''),[flowState,setFlowState]=useState({stage:'idle'}),[pending,setPending]=useState(readPending),[pendingNote,setPendingNote]=useState(''),[imageUrl,setImageUrl]=useState('');
 const flowRef=useRef(null),lastIndex=useRef(0),connection=useMemo(()=>createLaunchConnection(),[]);
 const result=validateLaunch(form),account=connected?.account.address??'';
 const stage=flowState.stage,busy=['uploading','building','simulating','signing','submitting','confirming'].includes(stage);
 const position=POSITION[stage];if(position)lastIndex.current=Math.min(position[0],STEPS.length-1);

 useEffect(()=>{if(!form.image){setImageUrl('');return;}const url=URL.createObjectURL(form.image);setImageUrl(url);return()=>URL.revokeObjectURL(url)},[form.image]);
 useEffect(()=>{const api=getWallets(),refresh=()=>setWallets(api.get().filter(w=>w.chains.some(c=>c.startsWith('solana:'))&&w.features['standard:connect']));refresh();const a=api.on('register',refresh),b=api.on('unregister',refresh);return()=>{a();b();}},[]);
 // A new wallet connection means a new flow; the old one is cancelled so nothing in flight can complete.
 useEffect(()=>{
  flowRef.current?.cancel();
  if(!connected){flowRef.current=null;setFlowState({stage:'idle'});return;}
  const flow=createLaunchFlow({enabled:LAUNCH_ENABLED,connection,wallet:connected.wallet,account:connected.account,upload:args=>uploadLaunchMetadata(args),persist:rec=>{try{sessionStorage.setItem(PENDING_KEY,JSON.stringify(rec));}catch{}setPending(rec);}});
  flowRef.current=flow;setFlowState(flow.state);
  const off=flow.subscribe(setFlowState);
  return()=>{off();flow.cancel();};
 },[connected,connection]);

 function change(key,value){flowRef.current?.cancel();setForm(v=>({...v,[key]:value}));setSheet(false)}
 async function connect(w){setWalletError('');try{const out=await w.features['standard:connect'].connect();const next=(out.accounts??w.accounts).find(a=>a.chains.includes('solana:mainnet'));if(!next)throw Error('This wallet has no Solana mainnet account.');setConnected({wallet:w,account:next});setPicker(false)}catch(e){setWalletError(String(e.message??e).slice(0,180))}}
 async function checkPending(){setPendingNote('Checking…');try{const r=await connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true});const st=r.value[0];setPendingNote(!st?'Not found yet. It may still land, or it may have expired. Do not send again until this shows a final result.':st.err?'The transaction failed on-chain.':`Status: ${st.confirmationStatus}.`);}catch(e){setPendingNote('Could not check: '+String(e.message??e).slice(0,120));}}
 const review=flowState.review;

 return <>
  <header className="lp-nav">
   <a className="lp-brand" href="/" aria-label="SENRO home"><Mark/>SENRO</a>
   <nav className="lp-links" aria-label="Primary"><a href="/">Overview</a><a href="/launchpad.html" aria-current="page">Launch</a></nav>
   <button className="lp-wallet" data-on={!!connected} onClick={()=>connected?setConnected(null):setPicker(true)}><i/>{connected?<code>{short(account)}</code>:'Connect wallet'}</button>
  </header>

  <section className="lp-hero">
   <div>
    <h1>Check the launch. Then sign <span>once.</span></h1>
    <p>Upload your art, review the exact transaction, and approve it in your wallet. Nothing moves until you do.</p>
    <div className="lp-release"><i/><b>{LAUNCH_ENABLED?'Live launches on':'Preview release'}</b><s/><span>{LAUNCH_ENABLED?'Your wallet signs once':'Nothing is signed or sent'}</span></div>
   </div>
   <div className="lp-hero-art" aria-hidden="true"><img src="/nature/noir/grass.jpg" alt="" width="1920" height="1080" fetchPriority="high"/></div>
  </section>

  <main className="lp-bench">
   <form className="lp-form" onSubmit={e=>e.preventDefault()} noValidate>
    <section className="lp-section">
     <h2>Token</h2>
     <div className="lp-row">
      <label className="lp-field"><span>Name</span><input maxLength="32" autoComplete="off" value={form.name} placeholder="Orbit Protocol" aria-invalid={!!(form.name&&result.errors.name)} onChange={e=>change('name',e.target.value)}/>{form.name&&result.errors.name&&<small className="lp-err">{result.errors.name}</small>}</label>
      <label className="lp-field"><span>Symbol</span><input maxLength="10" autoComplete="off" value={form.symbol} placeholder="ORBIT" aria-invalid={!!(form.symbol&&result.errors.symbol)} onChange={e=>change('symbol',e.target.value.toUpperCase())}/>{form.symbol&&result.errors.symbol&&<small className="lp-err">{result.errors.symbol}</small>}</label>
     </div>
     <label className="lp-field"><span>Description<em>optional</em></span><textarea maxLength="1000" value={form.description} placeholder="What is it, in a sentence or two?" onChange={e=>change('description',e.target.value)}/></label>
    </section>
    <section className="lp-section">
     <h2>Artwork<small>PNG, JPG or WebP, up to 5 MB</small></h2>
     <label className="lp-drop"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>change('image',e.target.files?.[0]??null)}/><span className="lp-drop-thumb">{imageUrl?<img src={imageUrl} alt=""/>:<ImagePlus size={20}/>}</span><strong>{form.image?form.image.name:'Choose an image'}</strong><span>{form.image?`${(form.image.size/1024).toFixed(0)} KB, click to replace`:'Shown as a square on most trading pages'}</span></label>
     {result.errors.image&&<small className="lp-err" style={{marginTop:-12,marginBottom:20}}>{result.errors.image}</small>}
    </section>
    <section className="lp-section">
     <h2>Links<small>optional</small></h2>
     {[['website','Website'],['twitter','X profile'],['telegram','Telegram']].map(([key,label])=><label className="lp-field" key={key}><span>{label}</span><input type="url" inputMode="url" placeholder="https://" value={form[key]} aria-invalid={!!result.errors[key]} onChange={e=>change(key,e.target.value)}/>{result.errors[key]&&<small className="lp-err">{result.errors[key]}</small>}</label>)}
    </section>
    <div className="lp-actions">
     <p>{LAUNCH_ENABLED?'You approve once, in your wallet, after seeing the cost.':'Preview release. You can upload, build and simulate. Nothing is signed or sent.'}</p>
     <button type="button" className="lp-primary" disabled={!result.valid||busy} onClick={()=>{if(!connected){setPicker(true);return;}setSheet(true);flowRef.current.prepare(form)}}>{connected?'Review launch':'Connect wallet to review'}<ArrowUpRight size={16}/></button>
    </div>
    {pending&&<div className="lp-note lp-pending"><Info size={16}/><span>A launch from this session is still unresolved: <code>{short(pending.signature,8)}</code> <a href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">View on Solscan <ExternalLink size={11}/></a><button onClick={checkPending}>Check status</button>{pendingNote&&<><br/>{pendingNote}</>}</span></div>}
   </form>

   <aside className="lp-side">
    <article className="lp-ticket" aria-label="Launch preview">
     <div className="lp-art" data-empty={!imageUrl}><img src={imageUrl||'/nature/noir/fern.jpg'} alt={imageUrl?'Token artwork preview':''}/>{form.symbol&&<span className="lp-art-symbol">{form.symbol}</span>}</div>
     <div className="lp-ticket-body">
      <h3>{form.name||'Your token'}</h3>
      <p className="lp-ticket-desc">{form.description||'The description appears here as you type.'}</p>
      <dl className="lp-facts">
       <div><dt>Network</dt><dd>Solana mainnet</dd></div>
       <div><dt>Venue</dt><dd>Pump</dd></div>
       <div><dt>Creator</dt><dd>{connected?<code>{short(account)}</code>:'Not connected'}</dd></div>
       <div><dt>Status</dt><dd>{stage==='launched'?'Launched':'Not launched'}</dd></div>
      </dl>
     </div>
    </article>
    <section className="lp-check" aria-label="Launch checkpoint"><h3><span>The launch checkpoint</span><span>{LAUNCH_ENABLED?'Live':'Preview release'}</span></h3><Steps stage={stage} lastIndex={lastIndex.current}/></section>
   </aside>
  </main>

  {sheet&&stage!=='idle'&&<div className="lp-overlay" onClick={()=>{if(!busy)setSheet(false)}}><section className="lp-sheet" role="dialog" aria-modal="true" aria-label="Review launch" onClick={e=>e.stopPropagation()}>
   <h2>{form.name} <span>{form.symbol}</span></h2>
   <p>{stage==='launched'?'Your token is live.':'Review what will happen before anything is signed.'}</p>
   {stage==='invalid'&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>Some fields need attention. Close this and fix them.</span></div>}
   {review&&<dl className="lp-facts">
    <div><dt>Creator</dt><dd><code>{short(review.creator,6)}</code></dd></div>
    <div><dt>New token mint</dt><dd><code>{short(review.mint,6)}</code></dd></div>
    <div><dt>Metadata</dt><dd><a href={review.metadataUri} target="_blank" rel="noreferrer">Verified on IPFS <ExternalLink size={11}/></a></dd></div>
    <div><dt>SOL leaving your wallet</dt><dd>{sol(review.creatorDebitLamports)}</dd></div>
    <div><dt>Network fee</dt><dd>{sol(review.feeLamports)}</dd></div>
    <div><dt>Initial buy</dt><dd>None</dd></div>
   </dl>}
   <Steps stage={stage} lastIndex={lastIndex.current} compact/>
   {stage==='ready'&&!LAUNCH_ENABLED&&<div className="lp-note"><Info size={16}/><span>{DISABLED_REASON}</span></div>}
   {stage==='ready'&&LAUNCH_ENABLED&&<div className="lp-note"><Info size={16}/><span>Approving asks your wallet to sign once and spends the SOL shown above. The launch is simulated again right before you sign.</span></div>}
   {['signing','submitting','confirming'].includes(stage)&&<div className="lp-note"><Info size={16}/><span>Keep this tab open and do not send again. A second send could create a second token.</span></div>}
   {stage==='launched'&&<div className="lp-note"><Check size={16}/><span>Confirmed and read back from the chain. <a href={`https://solscan.io/tx/${flowState.signature}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11}/></a></span></div>}
   {flowState.error&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>{flowState.error}</span></div>}
   {flowState.signature&&stage!=='launched'&&<p className="lp-sig">Signature<br/>{flowState.signature}</p>}
   {flowState.logs?.length>0&&<pre>{flowState.logs.join('\n')}</pre>}
   <div className="lp-sheet-actions">
    <button className="lp-ghost" disabled={busy} onClick={()=>setSheet(false)}>{stage==='launched'?'Close':'Edit details'}</button>
    {stage==='ready'&&LAUNCH_ENABLED&&<button className="lp-primary" onClick={()=>flowRef.current.launch({messageHash:review.messageHash})}>Approve and sign<ArrowUpRight size={16}/></button>}
   </div>
  </section></div>}

  {picker&&<div className="lp-overlay" onClick={()=>setPicker(false)}><section className="lp-sheet" role="dialog" aria-modal="true" aria-label="Connect wallet" onClick={e=>e.stopPropagation()}>
   <h2>Connect a wallet</h2><p>Pick the wallet you want to launch from. It never leaves your browser.</p>
   {wallets.length?wallets.map(w=><button key={w.name} className="lp-ghost" style={{display:'flex',width:'100%',alignItems:'center',gap:12,marginBottom:10}} onClick={()=>connect(w)}>{w.icon&&<img src={w.icon} alt="" width="22" height="22"/>}{w.name}</button>):<div className="lp-note"><Info size={16}/><span>No Solana wallet found. Open this page in a wallet browser, or install a wallet extension and reload.</span></div>}
   {walletError&&<div className="lp-note" data-tone="bad"><Info size={16}/><span>{walletError}</span></div>}
  </section></div>}

  <footer className="lp-footer"><span>SENRO on Solana, Pump launches</span><span>{LAUNCH_ENABLED?'Live launches enabled':'Preview release. No live launches.'}</span></footer>
 </>;
}
createRoot(document.getElementById('launchpad-root')).render(<App/>);
