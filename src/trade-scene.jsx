import React from 'react';
import {motion,useMotionValue,useSpring,useReducedMotion} from 'framer-motion';
import {Check,Minus,ShieldCheck} from 'lucide-react';

/** Generated product artwork, with live local-result lighting and pointer parallax. */
export function TradeScene({state='pending',compact=false,paused=false}){
 const reduced=useReducedMotion(),still=paused||reduced;
 const x=useMotionValue(0),y=useMotionValue(0),rotateX=useSpring(x,{stiffness:100,damping:24}),rotateY=useSpring(y,{stiffness:100,damping:24});
 function move(e){if(still||compact||e.pointerType==='touch')return;const r=e.currentTarget.getBoundingClientRect();x.set((.5-(e.clientY-r.top)/r.height)*9);y.set(((e.clientX-r.left)/r.width-.5)*12);}
 return <div className={`trade-scene material-scene ${compact?'compact':''} ${state} ${still?'still':''}`} onPointerMove={move} onPointerLeave={()=>{x.set(0);y.set(0)}} aria-hidden="true">
  <div className="scene-atmosphere"/><div className="scene-ground"/>
  <motion.div className="scene-object" style={still?{}:{rotateX,rotateY}}>
   <div className="scene-float"><img src="/artwork/senro-orbital-v2.webp" alt="" width="1456" height="1088" fetchPriority={compact?'auto':'high'} loading={compact?'lazy':'eager'} draggable="false"/></div>
  </motion.div>
  {!compact&&<><div className="scene-coordinate coordinate-a">SNR—01<span>INTENT / CHECK / PREVIEW</span></div><div className="scene-coordinate coordinate-b"><span>BUILT FOR</span>SOLANA</div><motion.div className={`scene-verdict ${state}`} key={state} initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.3}}><span className="verdict-icon">{state==='pass'?<Check size={18}/>:state==='block'?<Minus size={18}/>:<ShieldCheck size={18}/>}</span><div><small>LOCAL RULE RESULT</small><strong>{state==='pass'?'Within your limits':state==='block'?'Stopped by your rule':'Ready to explore'}</strong></div></motion.div></>}
 </div>;
}
export function MaterialIcon({name,className=''}){const id={cap:'cap',rolling:'volume',volume:'volume',cooldown:'cooldown',account:'balance',balance:'balance'}[name]||'cap';return <span className={`material-icon material-${id} ${className}`} aria-hidden="true"/>;}
