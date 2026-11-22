// Launch-scoped relay: simulates and sends Nush launch transactions only (create_v2, plus the Nush fees when
// VITE_NUSH_TREASURY and VITE_NUSH_LOOKUP_TABLE are set).
// LAUNCH_RPC_URL (optional, server-side only) is a private mainnet RPC used before the public fallbacks.
import {handleLaunchRpc,createLaunchLimiters,launchUpstreams} from '../../worker/launch-rpc.mjs';
import {readEconomicsConfig} from '../../src/nush-economics.mjs';
const limiters=createLaunchLimiters();
// The same public settings the page is built with: the relay enforces the fees the page shows.
let upstreams,economics=null,configError=null;
try{upstreams=launchUpstreams(process.env.LAUNCH_RPC_URL);economics=readEconomicsConfig({treasury:process.env.VITE_NUSH_TREASURY,lookupTable:process.env.VITE_NUSH_LOOKUP_TABLE});}catch(e){configError=e.message;}
export default function launchRpc(request,context){
 if(configError)return new Response(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32000,message:'The launch RPC is misconfigured on the server.'}}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return handleLaunchRpc(request,fetch,{limiters,upstreams,ip:context?.ip,economics});
}
// Platform-level limit across all instances (Netlify code-based rate limiting), on top of the per-instance budgets.
export const config={path:'/api/launch-rpc',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
