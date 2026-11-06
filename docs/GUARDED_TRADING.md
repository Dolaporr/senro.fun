# Guarded trading integration — disabled release

The browser now has a guarded PumpSwap transaction path and Wallet Standard sign-only submission flow. `src/guard-deployment.mjs` intentionally disables it. No cluster deployment or real trade was performed for this change.

## What is implemented

- SOL PumpSwap buys only. A positive trade cap is required; rolling volume, sell cooldown and account-cap rules must be off. No fallback to direct venue trading.
- Pin the mainnet program, programdata address, full deployed executable SHA-256 and upgrade authority. Verify loader layout and the deployed bytes before preparing and again before/after wallet approval. This trusts RPC responses; it is not a cryptographic light client or a security audit. An upgradeable program still trusts its upgrade authority and can change after a read.
- Load and validate the wallet's policy. Add policy creation or a revision-checked cap update to the same transaction as SDK ATA setup, wrapping, one guarded buy and cleanup.
- Exact budget/minimum output, policy hash, nonce, slot deadline and an explicit extra CPI native-debit bound. Signable reviews require a successful guarded simulation, observed minimum output, expected policy hash and nonce consumption, and a fee estimate.
- Simulate the actual recent blockhash without replacement, bind the exact message hash, and expire reviews after 30 seconds. Changed inputs, nonce, revision, policy, code or wallet invalidate signing.
- Show spend, minimum received, cap, policy action/rent, extra CPI debit bound, fee estimate, simulated total wallet debit, program and upgrade authority before an explicit wallet approval.
- Use `solana:signTransaction` with a version-0 capable mainnet account. Verify the returned message and Ed25519 signature. No wallet sign-and-send fallback. Used reviews cannot be reused.
- Submit once via the direct configured RPC with preflight enabled and `maxRetries: 0`. The read-only relay remains unable to broadcast.
- Derive the signature locally before submitting. Save pending receipts in session storage where available. A timeout is an uncertain outcome, never a failed buy that should automatically be repeated. Check status explicitly; unresolved outcomes block another buy in this tab. Session storage is not durable cross-device order tracking. Save the signature before closing the tab.

## Validation performed

JavaScript tests cover new/existing policies, exact atomic instruction replacement, deployment pins and chain checks, input/policy changes during wallet approval, message tampering, invalid signatures, cancellation, expiration, single-use reviews, submission timeouts, and confirmation states using mocked RPC/wallets and real message signing. These do not establish on-chain browser integration success.

The Rust guard and its prior local runtime evidence are unchanged. Re-run runtime tests and validate the complete browser-generated transaction against the intended venue deployment before enabling trading. This integration has not been independently reviewed.

## Release prerequisites

1. Choose the real guard identity, fee payer and upgrade-authority policy. Replace the embedded local-only identity in `protocol/guard/src/lib.rs` and rebuild. No production private keys belong in this repository.
2. Re-run Rust runtime tests using the exact final build and pinned/current venue code. Test the complete browser-generated creation/update, setup, swap and cleanup transaction, including over-cap/stale-policy/expired-intent failure and rollback.
3. Deploy the guard from an owner-controlled wallet; calculate rent and fees from that build and RPC rather than relying on an old estimate. Verify the deployed executable, programdata and authority.
4. Insert the reviewed deployment pins in `src/guard-deployment.mjs`; keep `enabled: false` until independent review and controlled cluster validation are complete. Test a separately gated integration build first.
5. Enable a controlled trial only after explicit approval of the amount and wallet signing. Check confirmed receipts and actual account changes before broader access.

The setup panel is a launch-status surface, not evidence of deployment. Public users must not infer that unsupported rules are enforced.
