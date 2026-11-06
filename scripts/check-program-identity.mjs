// Checks source wiring only. Does not read keypairs, sign, deploy or enable trading.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PublicKey} from '@solana/web3.js';
import {CANDIDATE_PROGRAM_ID} from '../protocol/client/program-id.mjs';
const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--program-id'))throw Error('Usage: node scripts/check-program-identity.mjs [--program-id PUBLIC_ADDRESS]');
if(args.length)assert.ok(CANDIDATE_PROGRAM_ID.equals(new PublicKey(args[1])),'Public address differs from the candidate source identity');
const rust=await readFile(new URL('../protocol/guard/src/lib.rs',import.meta.url),'utf8');
const m=rust.match(/pub const ID: Pubkey = Pubkey::new_from_array\(\[([\d,\s]+)\]\);/);
assert.ok(m,'Cannot find the explicit Rust program identity');
const bytes=m[1].split(',').map(x=>x.trim()).filter(Boolean).map(Number);
assert.ok(bytes.length===32&&bytes.every(n=>Number.isInteger(n)&&n>=0&&n<256),'Invalid Rust program address bytes');
assert.ok(CANDIDATE_PROGRAM_ID.equals(new PublicKey(new Uint8Array(bytes))),'Rust and JavaScript identities differ');
console.log('PASS source identity:',CANDIDATE_PROGRAM_ID.toBase58());
console.log('Build/runtime validation and deployment remain required. No trading enabled.');
