import React,{useId} from 'react';

/** A shared material and 56px grid keep the four rule symbols optically balanced. */
export function RuleEmblem({name,size=64}){
 const uid=useId().replace(/:/g,''),metal=`${uid}-metal`,lime=`${uid}-lime`;
 const silver=`url(#${metal})`,accent=`url(#${lime})`;
 return <svg className="rule-emblem" width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true">
  <defs><linearGradient id={metal} x1="9" y1="6" x2="47" y2="52" gradientUnits="userSpaceOnUse"><stop stopColor="#fbfff0"/><stop offset=".45" stopColor="#b9c9aa"/><stop offset="1" stopColor="#596b48"/></linearGradient><linearGradient id={lime} x1="13" y1="8" x2="44" y2="47" gradientUnits="userSpaceOnUse"><stop stopColor="#e6ffba"/><stop offset=".5" stopColor="#caff64"/><stop offset="1" stopColor="#82bb2e"/></linearGradient></defs>
  <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
   {name==='cap'&&<><path d="M10 39V26l9 5v13l-9-5Z" fill="#caff640c" stroke={silver}/><path d="m19 31 8-5v13l-8 5M10 26l8-5 9 5" stroke={silver}/><path d="M29 37V19l9 5v18l-9-5Z" fill="#caff6415" stroke={silver}/><path d="m38 24 8-5v18l-8 5M29 19l8-5 9 5" stroke={silver}/><path d="M9 11h38" stroke={accent} strokeWidth="2.5"/><path d="M9 8v6M47 8v6" stroke={accent}/><path d="M34 28v6M14 32v3" stroke={accent} strokeWidth="2.2"/><circle cx="28" cy="48" r="1" fill="#caff64" stroke="none"/></>}
   {name==='volume'&&<><path d="M28 7a21 21 0 1 0 20 15" stroke={silver} strokeWidth="2"/><path d="M28 7a21 21 0 0 1 18 10" stroke={accent} strokeWidth="2.5"/><path d="m40 17 6 .5 1-6" stroke={accent}/><path d="M17 34V28h5v6M26 34V22h5v12M35 34V17h5v17" fill="#caff6414" stroke={silver}/><path d="M15 39h27" stroke={accent}/><path d="M11 22h2M27 11v2M43 27h2M27 43v2" stroke="#7d9465"/></>}
   {name==='cooldown'&&<><circle cx="28" cy="29" r="18" fill="#caff6407" stroke={silver} strokeWidth="2"/><path d="M17 29a11 11 0 0 1 21-5" stroke={accent} strokeWidth="2.5"/><path d="M39 29a11 11 0 0 1-10 11" stroke="#7d9465"/><path d="M28 21v8l6 4" stroke={accent} strokeWidth="2.3"/><circle cx="28" cy="29" r="2" fill="#d7f7a5" stroke="none"/><path d="M24 5h8M28 5v6M40 12l3-3M14 29h1M41 29h1M28 42v1" stroke={silver}/></>}
   {name==='balance'&&<><path d="M10 19v18c0 4 7 7 15 7" stroke={silver}/><ellipse cx="24" cy="19" rx="14" ry="6" fill="#caff6415" stroke={silver}/><path d="M10 25c0 3 5 6 12 6M10 31c0 3 5 6 12 6M38 19v4" stroke={silver}/><ellipse cx="35" cy="35" rx="12" ry="14" fill="#10170c" stroke={silver} strokeWidth="2"/><ellipse cx="35" cy="35" rx="8" ry="10" stroke={accent}/><path d="m35 30 4 5-4 5-4-5 4-5Z" fill="#caff6424" stroke={accent} strokeWidth="1.4"/><path d="m19 17 5-2 5 2M24 15v7" stroke={accent}/></>}
  </g>
 </svg>;
}
