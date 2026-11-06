# SENRO live-trading rollout

Status: deployment preparation. Live trading is disabled. There is no production guard identity configured, no deployment signer connected to this environment, and this environment has no Solana CLI, cargo or cargo-build-sbf on PATH. The existing archived guard is a local-test artifact, not a mainnet release.

## What the phone tests established

The owner tested Solflare on iPhone and supplied screenshots/results for: opening the wallet browser; provider detection; connection cancellation and approval; disconnect; account switching; unsigned PumpSwap buy simulation; trade-cap pass at 0.0001 SOL and local rejection at 0.0002 SOL; saving rule copies across refresh; six local scenarios; Activity details; and verified off-chain message signing. Account-switch invalidation was reported by the owner. These results cover one wallet/device combination. They do not establish transaction signing or on-chain enforcement.

## First live release

Start with a wallet-owned SOL trade cap around canonical SOL PumpSwap buys. `requireSupportedDraft` already rejects rolling-volume, sell-cooldown and account-cap rules in this guarded flow. Keep those restrictions until their on-chain implementations and runtime tests exist. Successful venue simulation is not sufficient to activate the guard.

The Rust program rejects calls when its runtime program ID differs from its compiled `ID`. The owner has now selected `E1e4396v1CB8ttJ8FoBLN23Acfi25auiMabqpPjBgAwU`; the source and runtime bridge bind that candidate. The earlier `[83; 32]` identity and its archived ELF remain historical test evidence. A fresh candidate SBF build and runtime suite are still required. Do not simply set `enabled:true`, deploy the archived ELF under the new address, or reuse test executable hashes. See `protocol/CANDIDATE_IDENTITY.md`.

## Execution order

1. **Local deployment tools and signers.** On the owner's Mac, check `solana --version`, `cargo --version`, and `cargo build-sbf --version`. Use the pinned/tested SBF toolchain recorded in `protocol/BROWSER_VALIDATION.md`. Keep deployment signers local or hardware-backed; never upload seed phrases, private keys or keypair JSON to chat, GitHub or Netlify. The program-identity keypair is distinct from the fee payer and upgrade authority. A connected extension-wallet session here is not a CLI deployment signer.
2. **Final identity and build.** Generate/review a program identity on the owner's machine; share its public address only. Bind that identity in Rust, record the intended fee payer and upgrade authority, rebuild and rerun all unit/runtime/browser-wire tests. Existing fixed test vectors must be adapted deliberately for the new identity, not removed to force a pass. Hash the final ELF and record public build provenance.
3. **Current venue compatibility.** Refresh and verify pinned PumpSwap/Pump Fees binaries and account fixtures. Execute the final browser-built create/update-policy, setup, swap and cleanup messages in the local VM/validator, including forced post-CPI failures. Test incorrect hashes, nonce reuse, expiry, altered message bytes, account switches, token extensions and atomic rollback. Keep generated signers and venue binaries out of the public repository. A public devnet deployment alone does not prove compatibility with the mainnet venue and accounts; cloned mainnet fixtures are a separate local test.
4. **Reviewable deployment budget.** Run the existing read-only preflight on the final artifact, real fee-payer public address and chosen allocation size. Get a fresh rent/fee estimate before funding; the earlier 0.45 SOL figure is not a final quote. Explain permanent rent, temporary upload-buffer funding and nonrefundable fees separately. Do not deploy based on the archived build estimate.
5. **Deployment signed by the owner.** Review exact cluster, artifact hash, program address, allocation, upgrade authority and budget, then deploy with the local CLI signer. Avoid accidental default authority/allocation settings. Solana CLI deployment allocates rent and spends network fees. No deployment command was executed in this preparation step.
6. **Verify actual on-chain code.** Use the read-only verifier below against the final reviewed ELF. Check loader ownership, canonical ProgramData address, full allocated executable hash, expected upgrade authority and mainnet identity. It compares ELF bytes plus zero-filled allocation padding and uses the same browser verifier. It produces a DISABLED candidate and cannot sign, broadcast, write application config, or declare runtime validation complete.
7. **Restricted activation and actual wallet test.** After final-build/runtime/review gates, commit the verified release configuration for the narrow cap-only scope. Simulate the guarded browser transaction before signing. In the owner's wallet, validate version-0 transaction signing, cancel/retry handling, policy creation/update, signature tracking, confirmed/failed/unknown states and no unguarded fallback. A real mainnet buy and failed transaction can spend SOL/fees; review amounts and let the owner approve each transaction.
8. **Expand enforcement separately.** Add the missing policies below, rerun the matrix, redeploy and re-pin code hashes. Preserve visible scope and direct-venue bypass disclosures. Independent review of the CPI/signing/upgrade paths is still required before a meaningful-funds release; these tests are not an audit.

## Read-only deployment verifier

A reviewed public manifest contains these fields (values below describe types, not a usable identity):

- `programId`: final program public address.
- `upgradeAuthority`: expected authority public address, or explicit JSON `null` if intentionally immutable. Do not revoke authority merely to satisfy this field.
- `artifactSha256`: SHA-256 of the exact final local `.so`.

Run locally after deployment:

```sh
node scripts/verify-guard-deployment.mjs --manifest reviewed-public-release.json --artifact protocol/target/deploy/senro_guard.so
```

For a private RPC endpoint, set `SENRO_RPC_URL` privately in the local environment. Never commit the URL/key. The report deliberately leaves `candidate.enabled` false. Its full allocation hash may differ from `artifactSha256` if the deployment includes zero padding; this distinction is required by the existing browser verifier.

## Additional on-chain work required for all four rules

| Rule | Missing implementation and acceptance check |
| --- | --- |
| Trade cap | Implemented locally in the guard; needs final-identity build, deployment and real wallet/cluster validation. Test below, equal to, and above the cap plus actual observed debit. |
| Rolling volume | Integrate authoritative routed fills into on-chain policy state; define exact window/boundary behavior, checked sums, concurrency and capacity rejection. Rejected trades must not consume quota. Direct venue trades remain outside routed history. |
| Sell cooldown | Add a validated guarded sell path and on-chain last-successful-sell state. Test first sell, early/exact/late boundaries, replay, concurrent submissions and rollback. A buy-only adapter cannot enforce this sell rule. |
| Account balance | Add the post-CPI account-balance ceiling with explicit token-account scope. Validate mint/program/owner/ATA, existing holdings and observed output, and rollback if exceeded. Do not label an account cap as aggregate wallet-wide holdings. |

## Remaining owner input

The next required input is the Mac tool-version output. Then choose the final program public address and a local signing method. There is no need to send a private key, fund an estimated deployment, or approve a real trade merely to complete this preparation.

Official deployment references:
- https://solana.com/docs/programs/deploying
- https://solana.com/docs/core/programs/program-deployment
