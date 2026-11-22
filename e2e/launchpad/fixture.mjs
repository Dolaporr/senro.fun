// Fixed test-only fee settings for the browser check. Throwaway keys derived from constant seeds: no funds.
import {Keypair} from '@solana/web3.js';
export const E2E_TREASURY=Keypair.fromSeed(new Uint8Array(32).fill(91)).publicKey.toBase58();
export const E2E_LOOKUP_TABLE=Keypair.fromSeed(new Uint8Array(32).fill(92)).publicKey.toBase58();
