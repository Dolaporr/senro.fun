// Launch-scoped relay: simulates and sends Nush launch transactions only (create_v2, plus the Nush fees when
// VITE_NUSH_TREASURY and VITE_NUSH_LOOKUP_TABLE are set). LAUNCH_RPC_URL (optional, server-side only) is a
// private mainnet RPC used before the public fallbacks.
import {handleLaunchRpc,createLaunchLimiters,launchServerConfig} from '../../worker/launch-rpc.mjs';
const limiters=createLaunchLimiters();
const settings=launchServerConfig(process.env);
export default function launchRpc(request,context){
 // Names the setting at fault (never its value) so the owner can fix it from the error alone.
 if(settings.fatal)return new Response(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32000,message:`The launch RPC is misconfigured on the server: ${settings.fatal}`}}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return handleLaunchRpc(request,fetch,{limiters,upstreams:settings.upstreams,ip:context?.ip,economics:settings.economics,launchesBlocked:settings.launchesBlocked});
}
// Platform-level limit across all instances (Netlify code-based rate limiting), on top of the per-instance budgets.
export const config={path:'/api/launch-rpc',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
