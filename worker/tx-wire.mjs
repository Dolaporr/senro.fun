// Minimal, dependency-free reader for Solana wire transactions (legacy and v0), for the launch relay.
// Only what the relay inspects: signatures, header, static keys, instructions, lookup tables, message bytes.
import {base58Encode} from '../src/nush-config.mjs';

function reader(bytes){
 let o=0;
 const need=n=>{if(o+n>bytes.length)throw Error('truncated');};
 return {
  get offset(){return o;},
  u8(){need(1);return bytes[o++];},
  take(n){need(n);const v=bytes.subarray(o,o+n);o+=n;return v;},
  shortvec(){let len=0,size=0;for(;;){need(1);const b=bytes[o++];len|=(b&0x7f)<<(size*7);size++;if(!(b&0x80))break;if(size>3)throw Error('bad length');}return len;}
 };
}

export function parseTransaction(bytes){
 const r=reader(bytes);
 const sigCount=r.shortvec();const signatures=[];for(let i=0;i<sigCount;i++)signatures.push(r.take(64));
 const messageStart=r.offset;
 const first=r.u8();
 let version='legacy',numRequiredSignatures=first;
 if(first&0x80){version=first&0x7f;if(version!==0)throw Error('unsupported version');numRequiredSignatures=r.u8();}
 const header={numRequiredSignatures,numReadonlySignedAccounts:r.u8(),numReadonlyUnsignedAccounts:r.u8()};
 const keyCount=r.shortvec();const keyBytes=[];for(let i=0;i<keyCount;i++)keyBytes.push(r.take(32));
 const recentBlockhash=base58Encode(r.take(32));
 const ixCount=r.shortvec();const compiledInstructions=[];
 for(let i=0;i<ixCount;i++){
  const programIdIndex=r.u8();
  const n=r.shortvec();const accountKeyIndexes=[...r.take(n)];
  const d=r.shortvec();const data=r.take(d);
  compiledInstructions.push({programIdIndex,accountKeyIndexes,data});
 }
 const addressTableLookups=[];
 if(version===0){
  const lc=r.shortvec();
  for(let i=0;i<lc;i++){const accountKey=base58Encode(r.take(32));const w=r.shortvec();const writableIndexes=[...r.take(w)];const ro=r.shortvec();const readonlyIndexes=[...r.take(ro)];addressTableLookups.push({accountKey,writableIndexes,readonlyIndexes});}
 }
 if(r.offset!==bytes.length)throw Error('trailing bytes');
 return {version,signatures,messageBytes:bytes.subarray(messageStart),header,keyBytes,staticAccountKeys:keyBytes.map(base58Encode),recentBlockhash,compiledInstructions,addressTableLookups};
}
