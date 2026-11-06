import React from 'react';

// SENRO's small optical icon set: open corners, offset rails and connection nodes.
// All symbols share a 24px grid, a 1.5px stroke and restrained violet accents.
const drawings={
 wallet:<><path d="M5 6.5h12a2 2 0 0 1 2 2v2M5 6.5V5a2 2 0 0 1 2-2h9v3.5M19 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2"/><path d="M15 10.5h6v6h-6a3 3 0 0 1 0-6Z"/><circle className="senro-icon-accent" cx="16" cy="13.5" r=".9" stroke="none" fill="currentColor"/></>,
 connection:<><path d="M4 9V5h6M20 15v4h-6M9 20H5v-6M15 4h4v6"/><path className="senro-icon-accent" d="m8.5 12 2.2 2.2 4.8-4.8"/><circle cx="4" cy="12" r="1.2"/><circle cx="20" cy="12" r="1.2"/></>,
 cap:<><path d="M4 18V7h4M20 18V7h-4M8 21h8"/><path className="senro-icon-accent" d="M7 7h10M9 14l3-3 3 3M12 11v7"/><path d="M3 4h3M18 4h3"/></>,
 volume:<><path d="M5.3 7A8 8 0 0 1 19 7.5M18.7 17A8 8 0 0 1 5 16.5"/><path d="M19 3v4.5h-4.5M5 21v-4.5h4.5"/><path className="senro-icon-accent" d="M9 9v6M12 7v10M15 10v4"/></>,
 cooldown:<><path d="M9 3h6M12 3v3M5.3 6.3l-2-2M18.7 6.3l2-2"/><path d="M19.6 16A8 8 0 1 0 15 20.4"/><path className="senro-icon-accent" d="M12 9v5l3 1.5M18 18v4M21 18v4"/></>,
 balance:<><path d="m4 8 8-4 8 4-8 4-8-4ZM4 12l8 4 8-4M4 16l8 4 8-4"/><path className="senro-icon-accent" d="M12 12v8"/></>,
 studio:<><path d="M4 5h7M4 19h7M17 3v7M17 14v7M3 12h7M14 12h7"/><circle className="senro-icon-accent" cx="11" cy="5" r="2"/><circle className="senro-icon-accent" cx="11" cy="19" r="2"/><circle cx="17" cy="12" r="2"/></>,
 rules:<><path d="M5 3h13v17H5V3ZM2 7v15h12"/><path className="senro-icon-accent" d="m8 8 1.2 1.2L11 7M13 8h2M8 13h7M8 16h5"/></>,
 activity:<><path d="M4 3v17h17M8 7h3M17 7h3M8 16h12"/><path className="senro-icon-accent" d="m7 12 3-2 3 3 4-4 3 2"/><circle cx="4" cy="7" r="1" fill="currentColor" stroke="none"/></>,
 preview:<><path d="M7 4H4v5M17 4h3v5M4 15v5h3M20 15v5h-3"/><path className="senro-icon-accent" d="m10 8 6 4-6 4V8Z"/></>,
 network:<><path d="m6 6 12 2M6 6l3 13M18 8l-9 11"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle className="senro-icon-accent" cx="9" cy="19" r="2.5"/></>,
 history:<><path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/><path className="senro-icon-accent" d="M12 7v6h4"/></>,
 address:<><path d="m8 3-4 18M17 3l-4 18M3 8h18M2 16h18"/><path className="senro-icon-accent" d="m17 3-1 5M8 3 7 8"/></>,
};
export function SenroIcon({name,size=20,className='',...props}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`senro-icon ${className}`} {...props}>{drawings[name]??drawings.connection}</svg>}
export function WalletBrand({wallet,size=32}){const [failed,setFailed]=React.useState(false);const icon=wallet?.icon;const safe=typeof icon==='string'&&/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(icon)&&icon.length<700000;return <span className="wallet-brand" style={{width:size,height:size}}>{safe&&!failed?<img src={icon} alt="" width={size} height={size} onError={()=>setFailed(true)}/>:<span aria-hidden="true">{wallet?.name?.slice(0,1)?.toUpperCase()||<SenroIcon name="wallet" size={19}/>}</span>}</span>}
