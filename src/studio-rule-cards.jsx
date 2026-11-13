import React,{useEffect,useId,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'framer-motion';
import {ArrowUpRight,Check,ChevronDown,Minus,RotateCcw,Trash2} from 'lucide-react';
import {RuleEmblem} from './rule-emblem.jsx';
import {RULES,previewRule} from './studio-preview.mjs';

function RuleEditor({rule,config,onUpdate,onNotify}){
 const reduced=useReducedMotion(),formId=useId();
 const [value,setValue]=useState(config[rule.field]),[minutes,setMinutes]=useState(config.minutes);
 const [percent,setPercent]=useState(75),[elapsed,setElapsed]=useState('10'),[exampleAmount,setExampleAmount]=useState('0.10');
 const [error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{setValue(config[rule.field]);setMinutes(config.minutes);setError('');},[config,rule.field]);
 const dirty=value!==config[rule.field]||(rule.id==='rolling'&&minutes!==config.minutes);
 const result=previewRule({id:rule.id,value,quote:config.quote,percent,elapsed,exampleAmount,minutes});
 const sliderLabel=rule.id==='cap'?'Example trade':rule.id==='rolling'?'Volume already used':rule.id==='cooldown'?'Seconds since last sell':'Balance after the example buy';
 const reset=()=>{setValue(config[rule.field]);setMinutes(config.minutes);setPercent(75);setElapsed('10');setExampleAmount('0.10');setError('');setSaved(false);};
 function save(event){event.preventDefault();const next={...config,[rule.field]:value,...(rule.id==='rolling'?{minutes}:{})};const message=onUpdate(next);if(message){setError(message);return;}setError('');setSaved(true);onNotify('Rule updated. Run a fresh check.');}
 const elapsedMax=Math.max(60,Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1.5||60));
 const fieldLabel=rule.id==='cooldown'?'Minimum gap (seconds)':rule.id==='account'?'Maximum token balance':`Maximum amount (${config.quote})`;
 return <motion.div className="rule-card-workspace" id={formId} initial={reduced?false:{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:reduced?0:.28,ease:[.16,1,.3,1]}}>
  <form onSubmit={save} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();reset();}}}>
   <div className="rule-workspace-grid">
    <div className="rule-limit-settings">
     <h3>Your boundary</h3><p>{rule.description}</p>
     <label htmlFor={`${formId}-limit`}>{fieldLabel}</label>
     <div className="rule-limit-input"><input id={`${formId}-limit`} aria-label={rule.label+' value'} inputMode={rule.id==='cooldown'?'numeric':'decimal'} value={value} onChange={event=>{setValue(event.target.value);setError('');setSaved(false);}}/><span>{rule.id==='cooldown'?'SEC':rule.id==='account'?'TOKENS':config.quote}</span></div>
     {rule.id==='rolling'&&<><label htmlFor={`${formId}-window`}>Window (minutes)</label><div className="rule-limit-input secondary-limit"><input id={`${formId}-window`} aria-label="Rolling window minutes" inputMode="numeric" value={minutes} onChange={event=>{setMinutes(event.target.value);setSaved(false);}}/><span>MIN</span></div></>}
     <span className={`rule-draft-status ${dirty?'unsaved':''}`}>{dirty?'Unsaved changes':saved?'Saved to your draft':'Saved limit'}</span>
    </div>
    <div className="rule-live-example">
     <div className="rule-example-top"><h3>Try the edge</h3><button type="button" onClick={()=>{setPercent(75);setElapsed('10');setExampleAmount('0.10');}} aria-label="Reset rule example"><RotateCcw size={14}/></button></div>
     <p>{rule.id==='rolling'?`Synthetic volume within a ${minutes||'—'}-minute window.`:rule.id==='cooldown'?'Move time forward for an example second sell.':rule.id==='account'?'Compare a synthetic post-buy balance with your cap.':'Move an example trade across your maximum.'}</p>
     <div className="rule-example-value"><label htmlFor={`${formId}-example`}>{sliderLabel}</label><output htmlFor={`${formId}-example`}>{result.amountText??'—'}<small>{result.unit??(rule.id==='cooldown'?'seconds':rule.id==='account'?'tokens':config.quote)}</small></output></div>
     <div className="rule-example-slider"><input id={`${formId}-example`} aria-label={sliderLabel} type="range" min={rule.id==='cooldown'?0:1} max={rule.id==='cooldown'?elapsedMax:150} step="1" value={rule.id==='cooldown'?Math.min(elapsedMax,Number(elapsed)||0):percent} onChange={event=>rule.id==='cooldown'?setElapsed(event.target.value):setPercent(Number(event.target.value))} aria-valuetext={result.amountText?`${result.amountText} ${result.unit}`:'Enter a valid limit'} style={{'--example-progress':`${rule.id==='cooldown'?Number(elapsed)/elapsedMax*100:(percent-1)/149*100}%`}}/>{rule.id!=='cooldown'&&<span className="rule-slider-limit" aria-hidden="true"/>}</div>
     <div className="rule-slider-labels"><span>{rule.id==='cooldown'?'0 seconds':'Small example'}</span><span>{rule.id==='cooldown'?'More time':'Above your limit'}</span></div>
     {rule.id==='cooldown'&&<label className="rule-next-trade">Exact elapsed seconds<input aria-label="Exact elapsed seconds" inputMode="numeric" value={elapsed} onChange={event=>setElapsed(event.target.value)}/></label>}
     {rule.id==='rolling'&&<label className="rule-next-trade">Next example trade ({config.quote})<input aria-label="Next example trade amount" inputMode="decimal" value={exampleAmount} onChange={event=>setExampleAmount(event.target.value)}/></label>}
     <div className={`rule-inline-outcome ${result.status}`} role="status" aria-live="polite"><span className="rule-outcome-icon">{result.status==='pass'?<Check size={18}/>:<Minus size={18}/>}</span><div><strong>{result.title}</strong><p>{result.detail}</p></div><span className="rule-outcome-state">{result.status==='pass'?'ALLOWED':result.status==='block'?'BLOCKED':'CHECK VALUES'}</span></div>
     <p className="rule-example-note">Illustrative rule check. {dirty?'Uses your unsaved limit. ':''}No trade sent.</p>
    </div>
   </div>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="rule-workspace-actions"><button type="button" className="remove-rule" onClick={()=>{const message=onUpdate({...config,[rule.toggle]:false});if(message){setError(message);return;}onNotify('Rule removed. Run a fresh check.');}}><Trash2 size={13}/>Remove condition</button><div><button type="button" className="text-link" onClick={reset} disabled={!dirty}>Cancel changes</button><button type="submit" className="small-primary" disabled={!dirty}>Save change<Check size={14}/></button></div></div>
  </form>
 </motion.div>;
}

export function StudioRuleCards({config,onUpdate,onNotify}){
 const active=RULES.filter(rule=>config[rule.toggle]);
 const [selected,setSelected]=useState(()=>active[0]?.id??null);
 const reduced=useReducedMotion(),cardRefs=useRef(new Map());
 useEffect(()=>{if(!active.some(rule=>rule.id===selected))setSelected(active[0]?.id??null);},[config,selected]);
 function select(rule){setSelected(rule.id);}
 function navigate(event,index){
  let next;if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%active.length;
  else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index-1+active.length)%active.length;
  else if(event.key==='Home')next=0;else if(event.key==='End')next=active.length-1;else return;
  event.preventDefault();select(active[next]);cardRefs.current.get(active[next].id)?.focus({preventScroll:true});
 }
 return <div className="studio-rule-cards" aria-label="Your rule conditions">
  <div className="rule-selection-hint"><span className="selection-led"/>Select a condition to shape it.<span>{active.length} enabled</span></div>
  <div className="rule-card-grid"><AnimatePresence initial={false}>{[...active.filter(rule=>rule.id===selected),...active.filter(rule=>rule.id!==selected)].map(rule=>{
   const chosen=selected===rule.id;
   const summary=rule.id==='rolling'?`${config.rolling} ${config.quote} / ${config.minutes} min`:rule.id==='cooldown'?`${config.cooldown} seconds`:rule.id==='account'?`${Number(config.account).toLocaleString()} tokens`:`${config.cap} ${config.quote}`;
   return <motion.article layout={!reduced} className={`studio-rule-card ${chosen?'selected':''}`} key={rule.id} data-rule={rule.id} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?0:.28,ease:[.16,1,.3,1]}}>
    <button type="button" ref={node=>{if(node)cardRefs.current.set(rule.id,node);else cardRefs.current.delete(rule.id);}} className="studio-rule-select" aria-expanded={chosen} aria-controls={`rule-panel-${rule.id}`} onClick={()=>select(rule)} onKeyDown={event=>navigate(event,active.findIndex(item=>item.id===rule.id))}>
     <span className="studio-rule-emblem"><RuleEmblem name={rule.id==='rolling'?'volume':rule.id==='account'?'balance':rule.id} size={46}/></span>
     <span className="studio-rule-heading"><strong>{rule.label}</strong><span>{summary}</span></span>
     <span className="studio-rule-state">{chosen?'SELECTED':'EDIT RULE'}</span>{chosen?<ChevronDown size={17}/>:<ArrowUpRight size={17}/>}
    </button>
    <div id={`rule-panel-${rule.id}`}><AnimatePresence initial={false}>{chosen&&<RuleEditor key={rule.id} rule={rule} config={config} onUpdate={onUpdate} onNotify={onNotify}/>}</AnimatePresence></div>
   </motion.article>;
  })}</AnimatePresence></div>
  {!active.length&&<p className="rule-empty">Add a condition to start shaping your limits.</p>}
 </div>;
}
