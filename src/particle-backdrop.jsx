import React,{useEffect,useRef} from 'react';
import {useReducedMotion} from 'framer-motion';

/** A procedural dot field with slow waves, cursor light and short click ripples. */
export function ParticleBackdrop({paused=false}){
 const canvasRef=useRef(null),clock=useRef(0),reduced=useReducedMotion();
 useEffect(()=>{
  const canvas=canvasRef.current,ctx=canvas?.getContext('2d',{alpha:true});
  if(!ctx)return;
  let width=0,height=0,frame=0,last=0,disposed=false;
  const pointer={x:0,y:0,targetX:0,targetY:0,active:false},ripples=[];
  const still=paused||reduced;
  function resize(){
   width=window.innerWidth;height=window.innerHeight;
   const ratio=Math.min(window.devicePixelRatio||1,1.6);
   canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
   ctx.setTransform(ratio,0,0,ratio,0,0);
   if(!pointer.active){pointer.x=pointer.targetX=width*.56;pointer.y=pointer.targetY=height*.52;}
   draw(clock.current);
  }
  function glow(x,y,radius,alpha){
   const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
   gradient.addColorStop(0,`rgba(143,189,24,${alpha})`);
   gradient.addColorStop(.42,`rgba(111,151,15,${alpha*.37})`);
   gradient.addColorStop(1,'rgba(70,100,0,0)');
   ctx.fillStyle=gradient;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  function draw(t){
   ctx.clearRect(0,0,width,height);
   const compact=width<600,spacing=compact?29:27;
   glow(width*(.1+.06*Math.sin(t*.17)),height*(.78+.1*Math.cos(t*.13)),Math.min(width*.6,460),.105);
   glow(width*(.91+.05*Math.cos(t*.14)),height*(.44+.12*Math.sin(t*.12)),Math.min(width*.7,490),.085);
   glow(pointer.x,pointer.y,compact?150:230,pointer.active?.12:.045);
   for(let row=-1;row<=height/spacing+1;row++){
    for(let col=-1;col<=width/spacing+1;col++){
     let x=col*spacing+Math.sin(row*.22+t*.17)*3;
     let y=row*spacing+Math.sin(col*.17+row*.08+t*.3)*5;
     const dx=x-pointer.x,dy=y-pointer.y,distance=Math.hypot(dx,dy);
     const light=Math.exp(-(distance*distance)/(2*100*100))*(pointer.active?1:.16);
     const wave=(Math.sin(col*.18+row*.12-t*.4)+1)*.5;
     let pulse=0;
     for(const ripple of ripples){
      const age=t-ripple.time,ring=Math.abs(Math.hypot(x-ripple.x,y-ripple.y)-age*150);
      if(age>=0&&age<2.1)pulse+=Math.exp(-ring*ring/120)*(.24*(1-age/2.1));
     }
     if(distance>1){const push=light*7;x+=dx/distance*push;y+=dy/distance*push;}
     const alpha=Math.min(.76,.085+wave*.075+light*.48+pulse);
     const radius=.82+light*1.25+pulse*2;
     ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
     ctx.fillStyle=light>.06||pulse>.03?`rgba(186,240,62,${alpha})`:`rgba(164,187,132,${alpha})`;
     ctx.fill();
    }
   }
  }
  function tick(now){
   if(disposed||document.hidden)return;
   if(!last)last=now;
   const delta=Math.min((now-last)/1000,.05);
   // A 30fps cap keeps the backdrop light on mobile and high-density screens.
   if(now-last>=32){
    clock.current+=delta;last=now;
    pointer.x+=(pointer.targetX-pointer.x)*.08;pointer.y+=(pointer.targetY-pointer.y)*.08;
    while(ripples.length&&clock.current-ripples[0].time>2.1)ripples.shift();
    draw(clock.current);
   }
   frame=requestAnimationFrame(tick);
  }
  function sync(){cancelAnimationFrame(frame);last=0;if(document.hidden)return;draw(clock.current);if(!still)frame=requestAnimationFrame(tick);}
  function move(event){if(still||event.pointerType==='touch')return;pointer.targetX=event.clientX;pointer.targetY=event.clientY;pointer.active=true;}
  function leave(){pointer.active=false;pointer.targetX=width*.56;pointer.targetY=height*.52;}
  function ripple(event){if(still)return;ripples.push({x:event.clientX,y:event.clientY,time:clock.current});if(ripples.length>3)ripples.shift();}
  resize();sync();
  window.addEventListener('resize',resize,{passive:true});
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerout',onOut,{passive:true});
  window.addEventListener('pointerdown',ripple,{passive:true});
  document.addEventListener('visibilitychange',sync);
  function onOut(event){if(!event.relatedTarget)leave();}
  return()=>{disposed=true;cancelAnimationFrame(frame);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);window.removeEventListener('pointerout',onOut);window.removeEventListener('pointerdown',ripple);document.removeEventListener('visibilitychange',sync);};
 },[paused,reduced]);
 return <div className="particle-backdrop" aria-hidden="true"><canvas ref={canvasRef} data-motion={paused||reduced?'paused':'running'}/></div>;
}
