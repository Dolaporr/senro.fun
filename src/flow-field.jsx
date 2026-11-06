import React,{useEffect,useRef,useState} from 'react';
import {useReducedMotion} from 'framer-motion';
import {Pause,Play} from 'lucide-react';

// Original procedural artwork. No video download, tracking or pointer listener.
export function FlowField(){
 const phase=useRef(0),ref=useRef(null),reduced=useReducedMotion(),[paused,setPaused]=useState(false);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!ctx)return;
  let frame=0,last=0,time=phase.current,width=0,height=0,visible=!document.hidden,inView=true;
  const resize=()=>{const box=canvas.getBoundingClientRect();width=box.width;height=box.height;const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);paint(time)};
  function paint(t){
   if(!width||!height)return;ctx.clearRect(0,0,width,height);
   const cx=width*.76,cy=height*.52,scale=Math.min(width*.22,height*.72);
   const halo=ctx.createRadialGradient(cx-60,cy-55,5,cx,cy,scale*1.25);halo.addColorStop(0,'rgba(123,102,240,.09)');halo.addColorStop(.7,'rgba(96,70,207,.035)');halo.addColorStop(1,'rgba(55,47,108,0)');ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
   const paths=[];
   for(let j=0;j<62;j++){
    const v=j/62*Math.PI*2,points=[];let depth=0;
    for(let k=0;k<=140;k++){
     const u=k/140*Math.PI*2,warp=.065*Math.sin(u*3+t*.42)+.04*Math.cos(u*5-t*.25),tube=.23+.035*Math.sin(u*4+t*.33);
     let x=(.8+warp+tube*Math.cos(v))*Math.cos(u),y=(.8+warp+tube*Math.cos(v))*Math.sin(u),z=tube*Math.sin(v);
     const twist=.28*Math.sin(t*.15)+.3,rx=x*Math.cos(twist)+z*Math.sin(twist),rz=-x*Math.sin(twist)+z*Math.cos(twist);
     const ry=y*.64-rz*.72,rdepth=y*.72+rz*.64;
     points.push([cx+rx*scale,cy+ry*scale,rdepth]);depth+=rdepth;
    }
    paths.push({points,depth:depth/points.length,v});
   }
   paths.sort((a,b)=>a.depth-b.depth);
   for(const {points,v} of paths){
    const light=(Math.cos(v-2.2)+1)/2,gradient=ctx.createLinearGradient(cx-scale,cy-scale*.5,cx+scale,cy+scale*.6);
    gradient.addColorStop(0,`rgba(210,205,255,${.2+light*.65})`);gradient.addColorStop(.25,`rgba(152,128,249,${.08+light*.46})`);gradient.addColorStop(.53,'rgba(68,53,116,.035)');gradient.addColorStop(.8,`rgba(121,91,219,${.05+light*.29})`);gradient.addColorStop(1,`rgba(166,148,248,${.12+light*.3})`);
    ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=gradient;ctx.lineWidth=light>.82?1.15:.65;ctx.stroke();
   }
   // Slow, parallel streams enter and leave the gate; they are decoration, not live trades.
   for(let i=0;i<6;i++){
    const y=cy+(i-2.5)*13,offset=Math.sin(t*.25+i*.5)*8;
    const g=ctx.createLinearGradient(width*.28,0,width*.98,0);g.addColorStop(0,'rgba(130,107,231,0)');g.addColorStop(.35,'rgba(130,107,231,.10)');g.addColorStop(.7,'rgba(182,163,255,.23)');g.addColorStop(1,'rgba(130,107,231,0)');
    ctx.beginPath();ctx.moveTo(width*.28,y+offset);ctx.bezierCurveTo(width*.48,y+offset,width*.6,y-35,cx,y);ctx.bezierCurveTo(width*.85,y+25,width*.92,y,width,y+offset);ctx.strokeStyle=g;ctx.lineWidth=.7;ctx.stroke();
   }
  }
  function tick(now){if(now-last>32){if(last)time+=Math.min((now-last)/1000,.08);phase.current=time;last=now;paint(time)}frame=requestAnimationFrame(tick)}
  function sync(){visible=!document.hidden;cancelAnimationFrame(frame);last=0;if(visible&&inView&&!reduced&&!paused)frame=requestAnimationFrame(tick);else paint(time)}
  const observer=new ResizeObserver(resize);observer.observe(canvas);const intersection=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync()});intersection.observe(canvas);document.addEventListener('visibilitychange',sync);resize();sync();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',sync)};
 },[reduced,paused]);
 return <div className="flow-art"><canvas ref={ref} aria-hidden="true"/><div className="flow-art-controls"><span className="flow-art-label" aria-hidden="true">FLOW, WITH INTENTION.</span>{!reduced&&<button type="button" aria-label={paused?"Play background motion":"Pause background motion"} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>}</div></div>;
}
