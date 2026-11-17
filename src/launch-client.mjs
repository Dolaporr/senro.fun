// Browser-side helpers for the launchpad: the launch-scoped RPC connection and the signed metadata upload.
import {Connection} from '@solana/web3.js';
import {uploadAuthMessage} from '../worker/launchpad-upload.mjs';

export const LAUNCH_RPC_PATH='/api/launch-rpc';
export const UPLOAD_PATH='/api/launchpad/upload';

/** A web3.js Connection that talks only to the launch-scoped relay (never a public RPC directly). */
export function createLaunchConnection({fetcher=globalThis.fetch?.bind(globalThis),base=globalThis.location?.origin}={}){
 if(!base)throw Error('A same-origin base URL is required.');
 return new Connection(new URL(LAUNCH_RPC_PATH,base).href,{commitment:'confirmed',fetch:(url,init)=>fetcher(url,init),disableRetryOnRateLimit:true});
}

const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const UPLOAD_ERRORS={
 401:'Your wallet signature was not accepted. Reconnect your wallet and try again.',
 413:'The image is too large. Choose one under 5 MB.',
 415:'That file is not a PNG, JPG or WebP image. Choose a different one.',
 429:'Too many uploads from this wallet or network. Wait a few minutes and try again.',
 502:'The storage service could not confirm the upload, so nothing was kept. Try again in a moment.',
 503:'Uploads are not set up on this site yet. Nothing was launched.'
};
const readError=async response=>{const body=await response.json().catch(()=>({}));const e=Error(UPLOAD_ERRORS[response.status]??body.error??'The upload failed. Try again.');e.status=response.status;e.fields=body.errors;return e;};

/**
 * Uploads the artwork and metadata. The wallet signs a short text message (no transaction, no funds) that
 * binds its address, the image hash and the time, so the service can rate-limit and attribute uploads.
 */
export async function uploadLaunchMetadata({form,wallet,account,fetcher=globalThis.fetch?.bind(globalThis),base=globalThis.location?.origin,now=Date.now}){
 const feature=wallet?.features?.['solana:signMessage'];
 if(!feature||!account?.features?.includes('solana:signMessage'))throw Error('Connect a wallet that can sign a message to authorize the upload.');
 if(!form?.image)throw Error('Choose token artwork first.');
 const bytes=new Uint8Array(await form.image.arrayBuffer());
 const imageSha256=hex(await crypto.subtle.digest('SHA-256',bytes));
 const issuedAt=String(now());
 const message=new TextEncoder().encode(uploadAuthMessage({wallet:account.address,imageSha256,issuedAt}));
 const output=await feature.signMessage({account,message});
 if(output?.length!==1||!(output[0].signature instanceof Uint8Array)||output[0].signature.length!==64)throw Error('Wallet returned an unexpected signature.');
 const body=new FormData();
 for(const key of ['name','symbol','description','website','twitter','telegram'])if(form[key])body.append(key,form[key]);
 body.append('wallet',account.address);body.append('issuedAt',issuedAt);
 body.append('signature',btoa(String.fromCharCode(...output[0].signature)));
 body.append('image',new Blob([bytes],{type:form.image.type||'application/octet-stream'}),'token-image');
 const response=await fetcher(new URL(UPLOAD_PATH,base).href,{method:'POST',body});
 if(!response.ok)throw await readError(response);
 const result=await response.json();
 if(result?.verified!==true||typeof result.metadataUri!=='string')throw Error('The upload service did not confirm the upload.');
 return result;
}
