# Browser assembly runtime validation — 6 November 2026

**Local VM evidence only. No public-chain deployment or real-wallet transaction.**

The JavaScript quote builder, policy planner and version-0 compiler are now shared by the browser and a Node/LiteSVM test bridge. The bridge calls the installed official Pump SDK using captured public account fixtures. LiteSVM executes the returned signed transaction bytes unchanged against the compiled guard and captured PumpSwap/Pump Fees programs; Rust does not reassemble or re-sign those messages.

Five new runtime checks passed:

| Browser-generated message | Result |
| --- | --- |
| Create policy + SDK ATA setup + wrap + guarded buy + close | Passed; revision 1, nonce 1, positive token output, quote ATA closed |
| Update policy cap + setup + guarded buy + close | Passed; revision 2, nonce 1, reviewed cap committed |
| Force post-CPI failure after creating a policy | Policy creation, account setup and real swap all rolled back |
| Force post-CPI failure after updating a policy | Policy revision, nonce, account setup and real swap all rolled back |
| Initialize a prefunded policy PDA | Passed; external system-owned dust did not block the browser planner or guard |

Messages measured **945 bytes** for creation and **950 bytes** for the update case, within the 1,232-byte packet limit. The successful creation-and-buy case consumed **149,872 compute units**, below the browser's 400,000-unit budget in this fixture. Those measurements are not production guarantees.

The generated test user is also the actual VM fee payer. Rollback assertions permit only the reported network fee to differ; they compare the user's remaining account state, the policy, base/quote ATAs, pool, vaults, volume accumulator and buyback recipient. The successful creation case charged 5,000 simulated lamports. No real SOL was spent.

## Bug found and fixed

The guard already handled empty system-owned prefunding of an uninitialized policy PDA, but the browser refused any occupied address. A third party could therefore prevent policy setup in the UI by prefunding that public address. The planner now accepts empty, non-executable system-owned accounts as uninitialized. It subtracts prefunding from the policy-rent estimate and tolerates it arriving during wallet approval. Foreign owners, initialized policies and nonempty system accounts still fail closed. The runtime reproduction uses 1,000,000 simulated lamports, enough to create a rent-exempt system account.

## Executed checks

- JavaScript: **51 tests passed**. Includes two tests using the official SDK and captured accounts, and three regressions for policy prefunding.
- Rust: **3 unit tests + 18 runtime tests passed** (21 total); the earlier 13 runtime checks still pass.
- Toolchain: Rust 1.99.1, cargo-build-sbf 4.5.0, platform-tools v1.57.
- Fresh guard build SHA-256: `3d94ce25b9449a44b3ecb6bbf4ced29a8a679436ba3f7484694282808e65398e` — identical to the earlier archived local artifact. The guard implementation did not change.
- The captured venue executable hashes were checked before testing. Executables, generated keypairs, build directories and test-user keys remain excluded from the public export.

See `artifacts/browser-runtime-validation.json` for the source and artifact hashes. `VALIDATION.md` and the earlier build manifest remain historical records.

## Scope of this evidence

The test bridge uses fixture-backed account reads, generated local signers and the local test program ID. It selects a buyback recipient already present in the captured global configuration and fixture set; it does not exercise every recipient. It bypasses the mainnet deployment verifier only by calling the shared instruction planner directly. The release config and mainnet verifier still reject the local program ID and keep live trading disabled.

This proves SDK/guard instruction compatibility, message serialization and local execution/rollback for these fixtures. It does not establish real extension-wallet behaviour, RPC reliability, current venue-version compatibility, cluster confirmation, or security under a final production identity. Re-run the checks on the final build and validate those boundaries before enabling live trading. This is not an independent audit.

## Reproduce

Install Node >=22.12.0, Rust and the SBF tools; then run from the repository root:

```sh
npm ci
npm test
python3 scripts/fetch-guard-fixtures.py
npm run test:guard
```

The runtime suite now requires Node and npm dependencies because it invokes the official SDK/browser bridge. Mainnet fixture retrieval can fail if upstream code no longer matches the pins; do not silently replace hashes to force a pass. Linux hosts need their compiler/OpenSSL development dependencies. If building vendored OpenSSL fails but system headers/libraries are installed, the host runtime build can use `OPENSSL_NO_VENDOR=1` with the appropriate OpenSSL paths.
