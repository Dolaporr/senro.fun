import React,{useId} from 'react';
import {motion,useReducedMotion} from 'framer-motion';

/** Original vector scene: the local engine's result controls the gate and token. */
export function TradeScene({state='pending',compact=false,paused=false}){
 const id=useId().replace(/:/g,''),reduce=useReducedMotion(),still=paused||reduce;
 const pass=state==='pass',blocked=state==='block',color=pass?'#caff64':blocked?'#ff927b':'#8d9997';
 return <div className={`trade-scene ${compact?'compact':''} ${state}`} aria-hidden="true">
  <svg viewBox="0 0 760 520" fill="none">
   <defs>
    <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#242b2e"/><stop offset=".22" stopColor="#929e9f"/><stop offset=".38" stopColor="#e7edeb"/><stop offset=".47" stopColor="#6b7778"/><stop offset=".67" stopColor="#252c2f"/><stop offset=".85" stopColor="#bfc8c6"/><stop offset="1" stopColor="#4b5557"/></linearGradient>
    <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f0f2ed"/><stop offset=".3" stopColor="#9eaaa9"/><stop offset=".54" stopColor="#30383a"/><stop offset=".72" stopColor="#d1d9d4"/><stop offset="1" stopColor="#626e70"/></linearGradient>
    <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4d5b56" stopOpacity=".25"/><stop offset="1" stopColor="#101614" stopOpacity="0"/></linearGradient>
    <radialGradient id={`${id}-glow`}><stop stopColor={color} stopOpacity=".15"/><stop offset="1" stopColor={color} stopOpacity="0"/></radialGradient>
    <pattern id={`${id}-grid`} width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" stroke="#b5d1c1" strokeOpacity=".075"/></pattern>
    <filter id={`${id}-blur`}><feGaussianBlur stdDeviation="7"/></filter>
   </defs>
   <ellipse cx="419" cy="320" rx="330" ry="185" fill={`url(#${id}-glow)`}/>
   <g transform="translate(0 205) matrix(1 .4 -1 .4 390 -110)"><rect x="-150" y="-220" width="650" height="650" fill={`url(#${id}-grid)`}/></g>
   <path d="M57 302 387 447 708 294 380 159Z" fill={`url(#${id}-floor)`}/>
   <path d="M57 302 387 447 708 294" stroke="#54605b" strokeOpacity=".3"/>
   <path d="M88 291 386 422 680 282" stroke="#a0aba3" strokeOpacity=".18" strokeDasharray="3 7"/>
   <path d="M125 293 391 410 655 283" stroke={color} strokeOpacity=".35" strokeWidth="2"/>
   <motion.path d="M125 293 391 410 655 283" stroke={color} strokeWidth="3" strokeDasharray="18 590" animate={still?{}:{strokeDashoffset:[600,0]}} transition={{duration:4,repeat:Infinity,ease:'linear'}}/>
   <ellipse cx="417" cy="334" rx="96" ry="22" fill="#000" opacity=".45" filter={`url(#${id}-blur)`}/>
   <g>
    <path d="M402 305V157C402 88 493 65 535 103L555 116C505 74 424 111 424 173V316Z" fill={`url(#${id}-metal)`}/>
    <path d="M424 316V173C424 119 490 93 522 122C535 133 541 150 541 172V366L563 355V162C563 93 504 60 452 91C417 112 402 138 402 177V305Z" fill={`url(#${id}-face)`}/>
    <path d="M431 315V174C431 112 534 97 534 173V359" stroke={color} strokeOpacity=".85" strokeWidth="2"/>
    <path d="M424 316 402 305 397 311 421 324 438 316 432 312ZM541 366 563 355 571 358 548 371 532 365Z" fill="#717d78"/>
    <motion.g animate={{opacity:blocked?1:.08,scaleY:blocked?1:.02}} style={{transformOrigin:'490px 340px'}} transition={{duration:still?0:.6}}>
     <path d="M433 189 535 232V340L433 295Z" fill={color} fillOpacity=".08" stroke={color} strokeOpacity=".7"/>
     {[0,1,2,3,4,5].map(i=><path key={i} d={`M434 ${205+i*17} 534 ${248+i*17}`} stroke={color} strokeOpacity=".4"/>)}
    </motion.g>
   </g>
   <motion.g animate={{x:pass?168:blocked?25:0,y:pass?54:blocked?10:0}} transition={{duration:still?0:1,type:'spring',bounce:.15}}>
    <ellipse cx="270" cy="311" rx="56" ry="13" fill="#000" opacity=".6" filter={`url(#${id}-blur)`}/>
    <motion.g animate={still?{}:{y:[0,-9,0]}} transition={{duration:4,repeat:Infinity,ease:'easeInOut'}}>
     <ellipse cx="265" cy="241" rx="62" ry="80" transform="rotate(-22 265 241)" fill={`url(#${id}-metal)`} stroke="#c2cdc5" strokeWidth="1.5"/>
     <ellipse cx="274" cy="238" rx="57" ry="77" transform="rotate(-22 274 238)" fill={`url(#${id}-face)`} stroke="#d5dfd9" strokeOpacity=".7"/>
     <ellipse cx="274" cy="238" rx="48" ry="66" transform="rotate(-22 274 238)" stroke="#111b18" strokeOpacity=".5" strokeWidth="2"/>
     <path d="m284 202-28 11c-17 7-10 26 4 23l19-4c16-3 22 16 7 23l-25 10" stroke="#141c19" strokeWidth="11"/>
     <path d="m281 199-28 11c-17 7-10 26 4 23l19-4c16-3 22 16 7 23l-25 10" stroke="#e1e9df" strokeWidth="5"/>
    </motion.g>
   </motion.g>
   <g fontFamily="monospace" fontSize="9" letterSpacing="2" fill="#8d9a93"><text x="91" y="354">INPUT</text><text x="486" y="416">RULE CHECK</text><text x="599" y="251" fill={color}>{pass?'ALLOWED':blocked?'BLOCKED':'READY'}</text></g>
   <path d="M590 257H668V280" stroke={color} strokeOpacity=".5"/><circle cx="668" cy="282" r="3" fill={color}/>
  </svg>
 </div>;
}
