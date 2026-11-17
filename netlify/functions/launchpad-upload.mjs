// Netlify Web API function for launchpad metadata uploads.
// Configure PINATA_JWT (required) and IPFS_GATEWAY (optional, HTTPS) as server-side environment variables.
import {handleUpload,pinataProvider,createRateLimiter} from '../../worker/launchpad-upload.mjs';
const seen=new Map();
const ipLimiter=createRateLimiter({limit:10,windowMs:60*60*1000});
const walletLimiter=createRateLimiter({limit:5,windowMs:60*60*1000});
export default function launchpadUpload(request,context){
 let provider=null;
 try{provider=pinataProvider({jwt:process.env.PINATA_JWT,gateway:process.env.IPFS_GATEWAY||undefined});}catch{provider=null;}
 return handleUpload(request,{provider,seen,ipLimiter,walletLimiter,ip:context?.ip});
}
export const config={path:'/api/launchpad/upload',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
