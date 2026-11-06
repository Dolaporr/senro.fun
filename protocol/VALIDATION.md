Public export note: executable .so files are excluded. Binary names and hashes below record the original local validation. Build the guard and fetch pinned venue fixtures before rerunning.

# SENRO guard validation — 5 November 2026

## Executed checks

- `cargo build-sbf` 4.5.0 with platform-tools v1.57 compiled the actual Solana program.
- Rust: **3 unit tests and 13 LiteSVM runtime tests passed**.
- JavaScript: **28 tests passed**, including the existing simulator checks and six guard-client tests.
- The runtime loads the compiled guard and captured mainnet PumpSwap/Pump Fees ELFs. It does not substitute a mock venue or execute a transaction on a public cluster.

| Runtime case | Observed result |
| --- | --- |
| Full ATA setup, wrap, guarded swap and unwrap/close | Succeeded atomically in one transaction |
| Post-swap rejection in full setup/wrap/guard transaction | Entire transaction rolled back, including ATA creation and wrap |
| Normal wrapped-SOL exact-input buy | Real PumpSwap CPI succeeded; policy nonce incremented |
| Buy over policy cap | Guard rejected before PumpSwap invocation; guarded accounts unchanged |
| Additional native-SOL debit cap set to zero | PumpSwap CPI ran, then guard rejected; swap, rent and nonce rolled back |
| Policy edited after review | Old configuration hash rejected |
| Expired deadline and deadline more than 150 slots ahead | Both rejected |
| Consumed nonce reused with a fresh transaction signature/blockhash | Rejected |
| Zero minimum output | Rejected |
| Unexpected remaining account | Rejected |
| Pool vault accounts exchanged | Rejected |
| Missing wallet signature | Rejected |
| Unrelated signer attempts policy update | Rejected; policy unchanged |
| System Program substituted for PumpSwap CPI target | Rejected |

Rollback assertions compare complete account snapshots for the policy, wallet, user base/quote ATAs, pool and both vaults, user volume accumulator, and buyback-recipient token account. The fee sponsor is deliberately separate: runtime transaction fees are not rolled back and are not falsely reported as restored.

The first run's successful guarded buy consumed 91,950 compute units; a later run with freshly generated wallet/PDA seeds consumed 111,450. Tests request a 1,000,000-unit budget. The full atomic setup/wrap/guard/cleanup test consumed 137,937 units. These are local measurements, not a production compute guarantee.

Rust unit tests cover wire-format roundtrip, a Rust/JS fingerprint vector, nonce exclusion from that hash, and rejection of unreviewed mint extension types. JS tests cover instruction offsets/lengths, explicit program identity, hash binding, positive bounds, nonce/hash construction, rejection of unsupported venue variants/extras/over-cap requests, and preservation of setup/cleanup when replacing exactly one SDK venue instruction.

## Artifact provenance

`artifacts/build-manifest.json` records the guard source, lockfile and compiled artifact SHA-256 hashes. The two captured on-chain program snapshots have separate JSON metadata recording program/programdata addresses, deployment slot, snapshot slot, byte size and SHA-256.

The pool/mint/vault/global account fixture is copied from the upstream Pump Hooks fixture at the revision identified in `NOTICE`. Runtime wallets and their keypairs are generated locally; no user's wallet or production signing key is loaded.

## Not yet verified

- The browser's complete setup/wrap/guard/unwrap transaction and its packet/compute budget.
- A live deployed guard, production upgrade authority, or independent security review.
- Broader token-extension compatibility; unreviewed extensions are rejected.
- Rolling-volume enforcement, account caps, sells, bonding-curve paths or arbitrary venues.
- Whether a future PumpSwap upgrade preserves this account contract; a pinned binary passing today is not a promise of future compatibility.

## Instruction contract

Initialization uses `[policy PDA, wallet signer/payer, base mint, canonical pool, base token program, System Program]`. Tag 0 is followed by a positive quote cap u64.

Update uses `[policy PDA, wallet signer]`. Tag 1 is followed by expected revision u64, new positive quote cap u64 and active u8. It increments the revision and preserves the consumed nonce.

Guarded buy uses `[policy PDA, 17 PumpSwap accounts]` in the upstream AMM v2 account order. Its exact 73-byte payload is:

| Offset | Value |
| --- | --- |
| 0 | Tag 2 |
| 1 | Configuration hash, 32 bytes |
| 33 | Expected nonce, u64 |
| 41 | Deadline slot, u64 |
| 49 | Exact quote input, u64 |
| 57 | Positive minimum base output, u64 |
| 65 | Maximum additional native-lamport debit during CPI, u64 |

All integers are little-endian. A policy is 162 bytes. The nonce is mutable runtime state and is intentionally excluded from the configuration hash; it is explicitly committed in every guarded instruction.
