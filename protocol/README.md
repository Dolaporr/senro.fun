# SENRO guard: first on-chain implementation

**Local runtime proof only. No cluster deployment and no production program address.**

The guard is a compiled Solana program for wallet-owned per-trade quote caps around canonical SOL PumpSwap buys. It calls the real PumpSwap `buy_exact_quote_in_v2` instruction through CPI. The website remains an unsigned venue simulator and is not wired to a deployed guard.

## Implemented

- A policy PDA for `(wallet, base mint, pool)`, owned by the guard. Only that wallet's signer may initialize or update it. Prefunded system-owned PDAs cannot squat the address.
- Policy configuration binds the program ID, PumpSwap program, native quote mint, wallet, base mint, pool, token program, cap, revision and active flag. Consumed nonces are excluded from the configuration hash.
- Explicit rules hash, nonce, slot deadline (at most 150 slots ahead), exact quote budget, positive minimum token output and maximum additional native-lamport debit in every guarded buy.
- Validation of canonical pool derivation, account owners, mint programs, global/fee PDAs, configured buyback recipient, exact 17-account CPI contract and wallet ATAs. No arbitrary remaining accounts or caller-chosen CPI target.
- Checks both the requested quote budget and actual post-CPI quote debit, actual received base amount, and additional wallet native-lamport debit. A successful trade consumes exactly one nonce. Rejections roll back those changes.
- The initial token scope accepts legacy SPL Token or Token-2022 with metadata-only mint extensions. Transfer fees, transfer hooks and other unreviewed extensions fail closed. Token accounts may have the immutable-owner extension. Delegated, frozen, or separately close-authorized accounts are rejected.
- A JavaScript instruction client, policy decoder, and fingerprint function with a matching Rust/JS hash vector. The client requires an explicit program ID and does not sign or send.

## Transaction assembly

1. Create the wallet's base-token ATA and native-quote ATA if required.
2. Wrap the user's reviewed SOL budget into the native-quote ATA and sync it.
3. Invoke the guard with the reviewed policy and one PumpSwap exact-quote-in buy.
4. Optionally close a newly created native-quote ATA after the guarded call.

Put setup, guarded trade and cleanup in one transaction when integrating the client. The native runtime tests prove this complete setup/wrap/guard/cleanup sequence succeeds in one transaction. A second test forces a post-swap rejection and verifies that account creation, wrapping, the swap, rent and nonce changes all roll back together. The browser-generated transaction still needs to be integrated and checked.

The quote cap is denominated in wrapped SOL. Transaction fees and account setup outside the guard are not that quote amount. `maxNativeDebit` separately limits native SOL spent inside the PumpSwap CPI, including any account rent. Transaction fees remain payable even when a submitted transaction fails; runtime rollback tests use a separate fee sponsor and assert the user's native SOL, quote/base accounts, pool/vaults, policy, volume accumulator and fee-recipient accounts remain unchanged on guard rejection.

For the shared browser assembly tests and the prefunded-policy fix, see [BROWSER_VALIDATION.md](BROWSER_VALIDATION.md).

## Build and run

Install Node/npm dependencies (`npm ci`), Rust, `cargo-build-sbf` 4.5.0, and platform-tools v1.57. Then, from the project root:

```sh
python3 scripts/fetch-guard-fixtures.py
scripts/test-guard.sh
npm test
```

Linux hosts need the ordinary compiler/OpenSSL development dependencies used by the Solana tooling. The lockfile pins the runtime dependency graph. `protocol/target` and all generated keypairs are ignored. The test suite requires a freshly built `protocol/target/deploy/senro_guard.so`; it does not silently fall back to the archived artifact.

The recorded local artifact is excluded from this public repository; build the guard from source. Captured Pump executable fixtures are also excluded; fetch them using the pinned verifier before runtime tests. The constant program ID is the public key consisting of 32 bytes of value 83, used only in the local VM. `cargo build-sbf` may generate a local keypair, but this does not make it the program's embedded ID. Choose and review the actual deployment identity before a future cluster build.

## Validation and limits

See [VALIDATION.md](VALIDATION.md) for results and fixture hashes. This version implements the quote cap and per-intent bounds only. It does not implement authoritative rolling history, sell cooldowns, account-balance limits, bonding-curve routing, automated orders, an upgrade-authority governance policy, or a completed independent review. The older generic Rust rule core is separate from this first CPI adapter; its broader features are not claimed as on-chain features here.

Direct PumpSwap calls remain bypassable by design. Policies only govern calls through this guard. Wallet owners can deliberately update or deactivate their own policy; token creators receive no authority over another wallet's settings. Both the guard's future upgrade authority and the venue's upgrade authority remain deployment trust considerations.
