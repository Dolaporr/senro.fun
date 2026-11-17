// Launch-scoped relay: simulates and sends Pump create_v2 launch transactions only.
import {handleLaunchRpc} from '../../worker/launch-rpc.mjs';
export default function launchRpc(request){return handleLaunchRpc(request);}
export const config={path:'/api/launch-rpc'};
