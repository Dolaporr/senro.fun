// Netlify's Web API function delegates to the same tested, read-only relay.
import {handleRpc} from '../../worker/rpc.mjs';
export default function solana(request){return handleRpc(request);}
export const config={path:'/api/solana'};
