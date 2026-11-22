// Nush fee settings with no dependencies, so the server functions can use them (see
// tests/netlify-function-deps.test.mjs for why server code must not reach npm packages).
export const LAUNCH_FEE_LAMPORTS=10_000_000; // 0.01 SOL
export const TREASURY_SHARE_BPS=2_500; // 25%
export const CREATOR_SHARE_BPS=10_000-TREASURY_SHARE_BPS; // 75%

const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Decodes base58; returns null on any invalid character. */
export function base58Decode(text){
 let n=0n;for(const c of text){const i=ALPHABET.indexOf(c);if(i<0)return null;n=n*58n+BigInt(i);}
 const out=[];while(n>0n){out.unshift(Number(n&255n));n>>=8n;}
 for(const c of text){if(c!=='1')break;out.unshift(0);}
 return Uint8Array.from(out);
}
export function base58Encode(bytes){
 let n=0n;for(const b of bytes)n=n*256n+BigInt(b);
 let out='';while(n>0n){out=ALPHABET[Number(n%58n)]+out;n/=58n;}
 for(const b of bytes){if(b!==0)break;out='1'+out;}
 return out;
}
const isAddress=t=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)&&base58Decode(t)?.length===32;

/** Validates deployment config. Returns null when nothing is configured, throws when it is half-configured. */
export function readEconomicsConfig({treasury,lookupTable}={}){
 const t=String(treasury??'').trim(),l=String(lookupTable??'').trim();
 if(!t&&!l)return null;
 if(!isAddress(t))throw Error('The Nush treasury address is missing or invalid.');
 if(!isAddress(l))throw Error('The Nush lookup table address is missing or invalid.');
 if(t===l)throw Error('Treasury and lookup table must differ.');
 return Object.freeze({treasury:t,lookupTable:l,launchFeeLamports:LAUNCH_FEE_LAMPORTS,treasuryShareBps:TREASURY_SHARE_BPS});
}
