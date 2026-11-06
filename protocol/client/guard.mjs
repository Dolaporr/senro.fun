// Development client: builds instructions only. No signing, sending, or production program default.
import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {sha256} from '@noble/hashes/sha256';
export const LOCAL_PROGRAM_ID=new PublicKey(new Uint8Array(32).fill(83));
export const PUMP_AMM_PROGRAM_ID=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const NATIVE_MINT=new PublicKey('So11111111111111111111111111111111111111112');
export const POLICY_LENGTH=162;
const asKey=x=>new PublicKey(x);
function u64(x){if(typeof x!=='bigint'||x<0n||x>(1n<<64n)-1n)throw Error('Expected an unsigned u64 bigint.');const b=Buffer.alloc(8);b.writeBigUInt64LE(x);return b;}
const positive=x=>{if(x===0n)throw Error('Trade bounds must be positive.');return u64(x);};
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey:asKey(pubkey),isSigner,isWritable});
export function policyAddress({programId,wallet,mint,pool}){if(!programId)throw Error('Specify the guard program ID explicitly.');return PublicKey.findProgramAddressSync([Buffer.from('policy'),asKey(wallet).toBuffer(),asKey(mint).toBuffer(),asKey(pool).toBuffer()],asKey(programId));}
export function policyFingerprint(p,programId){if(typeof p.active!=='boolean')throw Error('active must be boolean');if(!programId)throw Error('Specify the guard program ID explicitly.');return sha256(Buffer.concat([Buffer.from('SENRO-POLICY-V1'),asKey(programId).toBuffer(),PUMP_AMM_PROGRAM_ID.toBuffer(),NATIVE_MINT.toBuffer(),...['wallet','mint','pool','tokenProgram'].map(k=>asKey(p[k]).toBuffer()),positive(p.maxQuote),positive(p.revision),Buffer.from([p.active?1:0])]));}
export function decodePolicy(data){const d=Buffer.from(data);if(d.length!==POLICY_LENGTH||d.subarray(0,8).toString()!=='SENROP01'||d[161]>1)throw Error('Invalid SENRO policy.');return {wallet:new PublicKey(d.subarray(8,40)),mint:new PublicKey(d.subarray(40,72)),pool:new PublicKey(d.subarray(72,104)),tokenProgram:new PublicKey(d.subarray(104,136)),maxQuote:d.readBigUInt64LE(136),revision:d.readBigUInt64LE(144),nonce:d.readBigUInt64LE(152),bump:d[160],active:d[161]===1};}
export function createPolicyInstruction({programId,wallet,mint,pool,tokenProgram,maxQuote}){const [policy]=policyAddress({programId,wallet,mint,pool});return new TransactionInstruction({programId:asKey(programId),keys:[meta(policy,false,true),meta(wallet,true,true),meta(mint),meta(pool),meta(tokenProgram),meta(SystemProgram.programId)],data:Buffer.concat([Buffer.from([0]),positive(maxQuote)])});}
export function updatePolicyInstruction({programId,policy,wallet,expectedRevision,maxQuote,active=true}){if(typeof active!=='boolean')throw Error('active must be boolean');return new TransactionInstruction({programId:asKey(programId),keys:[meta(policy,false,true),meta(wallet,true,true)],data:Buffer.concat([Buffer.from([1]),positive(expectedRevision),positive(maxQuote),Buffer.from([+active])])});}
const FLAGS=[[0,1],[1,1],[0,0],[0,0],[0,0],[0,1],[0,1],[0,1],[0,1],[0,0],[0,0],[0,0],[0,1],[0,0],[0,1],[0,0],[0,0]];
export function guardedBuyInstruction({programId,policy,policyAddress:account,venueInstruction,deadlineSlot,maxNativeDebit}){
 if(!programId)throw Error('Specify the guard program ID explicitly.');
 const ix=venueInstruction,data=Buffer.from(ix.data);
 if(!ix.programId.equals(PUMP_AMM_PROGRAM_ID)||ix.keys.length!==17||data.length!==24||!data.subarray(0,8).equals(Buffer.from([194,171,28,70,104,77,91,47])))throw Error('Expected a PumpSwap buy_exact_quote_in_v2 instruction with exactly 17 accounts.');
 for(let i=0;i<17;i++)if(ix.keys[i].isSigner!==!!FLAGS[i][0]||ix.keys[i].isWritable!==!!FLAGS[i][1])throw Error('Unexpected PumpSwap account privileges.');
 if(!ix.keys[1].pubkey.equals(asKey(policy.wallet))||!ix.keys[0].pubkey.equals(asKey(policy.pool))||!ix.keys[3].pubkey.equals(asKey(policy.mint))||!ix.keys[4].pubkey.equals(NATIVE_MINT)||!ix.keys[9].pubkey.equals(asKey(policy.tokenProgram)))throw Error('Venue instruction does not match the policy.');
 const [expected]=policyAddress({programId,wallet:policy.wallet,mint:policy.mint,pool:policy.pool});if(!expected.equals(asKey(account)))throw Error('Wrong policy PDA.');
 const amount=data.readBigUInt64LE(8),minimum=data.readBigUInt64LE(16);positive(amount);positive(minimum);if(!policy.active||amount>policy.maxQuote)throw Error('Trade is blocked by this policy.');
 const wire=Buffer.concat([Buffer.from([2]),Buffer.from(policyFingerprint(policy,programId)),u64(policy.nonce),positive(deadlineSlot),u64(amount),u64(minimum),u64(maxNativeDebit)]);
 return new TransactionInstruction({programId:asKey(programId),keys:[meta(account,false,true),...ix.keys],data:wire});
}

/** Replace exactly one official SDK venue call; retain its ATA/wrap/cleanup instructions in order. */
export function guardPumpSwapInstructions({instructions,...params}){if(!Array.isArray(instructions))throw Error('Expected the official SDK instruction array.');const matches=instructions.filter(i=>i.programId.equals(PUMP_AMM_PROGRAM_ID));if(matches.length!==1)throw Error('Expected exactly one PumpSwap venue call.');const guard=guardedBuyInstruction({...params,venueInstruction:matches[0]});return instructions.map(i=>i===matches[0]?guard:i);}
