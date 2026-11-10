import React,{useEffect,useRef} from 'react';
import {useReducedMotion} from 'framer-motion';

/** Quiet dots at rest; a fading cursor trail and local click/tap pulses. */
export function ParticleBackdrop({paused=false}){
 const canvasRef=useRef(null),reduced=useReducedMotion();
 useEffect(()=>{
  const canvas=canvasRef.current,ctx=canvas?.getContext('2d',{alpha:true});
  if(!ctx)return;
  let width=0,height=0,frame=0,lastFrame=0,disposed=false,touch=null;
  const pointer={x:0,y:0,targetX:0,targetY:0,movedAt:-Infinity},trail=[],bursts=[];
  const still=paused||reduced,now=()=>performance.now()/1000;
  function hoverStrength(t){const age=t-pointer.movedAt;return age<.12?1:Math.max(0,1-(age-.12)/.95)**2;}
  function glow(x,y,radius,alpha){
   if(alpha<.001)return;
   const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
   gradient.addColorStop(0,`rgba(143,189,24,${alpha})`);
   gradient.addColorStop(.42,`rgba(111,151,15,${alpha*.37})`);
   gradient.addColorStop(1,'rgba(70,100,0,0)');
   ctx.fillStyle=gradient;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  function draw(t){
   ctx.clearRect(0,0,width,height);
   const compact=width<600,spacing=compact?29:27,hover=hoverStrength(t);
   glow(width*.1,height*.8,Math.min(width*.6,460),.04);
   glow(width*.92,height*.44,Math.min(width*.7,490),.03);
   glow(pointer.x,pointer.y,compact?145:195,hover*.16);
   for(const burst of bursts){const age=t-burst.time;glow(burst.x,burst.y,150+age*65,.22*Math.exp(-age*2.4));}
   for(let row=-1;row<=height/spacing+1;row++){
    for(let col=-1;col<=width/spacing+1;col++){
     let x=col*spacing+Math.sin(row*.22)*3,y=row*spacing+Math.sin(col*.17+row*.08)*4;
     const dx=x-pointer.x,dy=y-pointer.y,distance=Math.hypot(dx,dy);
     let light=Math.exp(-distance*distance/(2*78*78))*hover,pulse=0,pushX=0,pushY=0;
     for(const point of trail){const age=t-point.time,dist=Math.hypot(x-point.x,y-point.y);if(age<.5)light+=Math.exp(-dist*dist/(2*48*48))*.13*(1-age/.5);}
     light=Math.min(1,light);
     for(const burst of bursts){
      const age=t-burst.time,dist=Math.hypot(x-burst.x,y-burst.y),life=Math.max(0,1-age/2.1);
      if(age<0||!life)continue;
      const ring=Math.abs(dist-age*150);
      pulse+=Math.exp(-ring*ring/500)*.62*life*life+Math.exp(-dist*dist/(2*82*82))*.7*Math.exp(-age*3);
      if(dist>1){const shift=Math.exp(-ring*ring/900)*life*8;pushX+=(x-burst.x)/dist*shift;pushY+=(y-burst.y)/dist*shift;}
     }
     if(distance>1){x+=dx/distance*light*8;y+=dy/distance*light*8;}
     x+=pushX;y+=pushY;
     const base=.055+((Math.sin(col*.18+row*.12)+1)*.5)*.035;
     const alpha=Math.min(.88,base+light*.58+pulse),radius=.75+light*1.35+pulse*1.3;
     ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
     ctx.fillStyle=light>.045||pulse>.025?`rgba(186,240,62,${alpha})`:`rgba(164,187,132,${alpha})`;
     ctx.fill();
    }
   }
  }
  function active(t){return hoverStrength(t)>.001||bursts.some(b=>t-b.time<2.1);}
  function tick(timestamp){
   frame=0;if(disposed||document.hidden||still)return;
   const t=timestamp/1000;
   if(!lastFrame||timestamp-lastFrame>=32){
    lastFrame=timestamp;pointer.x+=(pointer.targetX-pointer.x)*.27;pointer.y+=(pointer.targetY-pointer.y)*.27;
    while(trail.length&&t-trail[0].time>.5)trail.shift();
    while(bursts.length&&t-bursts[0].time>=2.1)bursts.shift();
    draw(t);
   }
   if(active(t))frame=requestAnimationFrame(tick);else draw(t);
  }
  function wake(){if(!frame&&!still&&!document.hidden&&!disposed){lastFrame=0;frame=requestAnimationFrame(tick);}}
  function resize(){
   width=window.innerWidth;height=window.innerHeight;
   const ratio=Math.min(window.devicePixelRatio||1,1.6);
   canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
   pointer.x=pointer.targetX=Math.min(width,pointer.targetX||width*.5);pointer.y=pointer.targetY=Math.min(height,pointer.targetY||height*.5);
   draw(now());if(active(now()))wake();
  }
  function move(event){
   if(still||event.pointerType==='touch'||event.isPrimary===false)return;
   const t=now(),previous=trail[trail.length-1];
   if(!Number.isFinite(pointer.movedAt)){pointer.x=event.clientX;pointer.y=event.clientY;}
   pointer.targetX=event.clientX;pointer.targetY=event.clientY;pointer.movedAt=t;
   if(!previous||Math.hypot(previous.x-event.clientX,previous.y-event.clientY)>14){trail.push({x:event.clientX,y:event.clientY,time:t});if(trail.length>6)trail.shift();}
   wake();
  }
  function burstAt(x,y){bursts.push({x,y,time:now()});if(bursts.length>4)bursts.shift();wake();}
  function down(event){
   if(still||event.isPrimary===false||event.button!==0)return;
   if(event.pointerType==='touch'){touch={id:event.pointerId,x:event.clientX,y:event.clientY,time:now()};return;}
   move(event);burstAt(event.clientX,event.clientY);
  }
  function up(event){
   if(event.pointerType!=='touch'||!touch||touch.id!==event.pointerId)return;
   const tap=touch;touch=null;
   if(!still&&now()-tap.time<.75&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<14)burstAt(event.clientX,event.clientY);
  }
  function cancel(){touch=null;}
  function out(event){if(!event.relatedTarget){pointer.movedAt=-Infinity;trail.length=0;wake();}}
  function visibility(){
   cancelAnimationFrame(frame);frame=0;touch=null;pointer.movedAt=-Infinity;trail.length=0;bursts.length=0;
   if(!document.hidden)draw(now());
  }
  resize();
  window.addEventListener('resize',resize,{passive:true});window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerdown',down,{passive:true});window.addEventListener('pointerup',up,{passive:true});
  window.addEventListener('pointercancel',cancel,{passive:true});window.addEventListener('pointerout',out,{passive:true});
  document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;cancelAnimationFrame(frame);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('pointerout',out);document.removeEventListener('visibilitychange',visibility);};
 },[paused,reduced]);
 return <div className="particle-backdrop" aria-hidden="true"><canvas ref={canvasRef} data-motion={paused||reduced?'paused':'interactive'}/></div>;
}
