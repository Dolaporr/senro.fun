# Pumphooks Solana launch execution — implementation boundaries

The branch includes a token creation UI, metadata validation, a deterministic plan, mocked metadata verification tests, and simulation-result acceptance checks. It does not contain a functioning Pump create transaction builder or upload service. The SDK installed in package.json is @pump-fun/pump-sdk ^4.3.1; the exact create API must be verified from package source before constructing instructions.

## Critical build integration correction

Vite's existing vite.config.js contains the read-only Solana RPC middleware. A previously added vite.config.mjs would have taken precedence and accidentally dropped this middleware. The new commit removes vite.config.mjs and integrates the multipage build input into vite.config.js instead. Verify with npm run build, npm run check:netlify, and npm test before merging.

## Production completion gates

1. Metadata storage: image MIME sniffing, upload authentication, rate limits, content-addressed persistence, and URI verification. No storage credentials in the browser.
2. Pump SDK: verify program identity and the exact create instruction interface; prepare a mint signer with wallet-approved transaction; compute rent, priority fees and initial buy separately.
3. Simulation: simulate exact unsigned message on the intended cluster, pin blockhash/last-valid-height and message hash; reject stale simulation, wallet switch or changed metadata.
4. Submission: explicit wallet approval, RPC send and confirmation; verify mint account owner, metadata and venue events before success.
5. Discovery: index confirmed launches with source slot and pagination, handle duplicate events and reconciliation.
6. Trading: reuse existing Pump/PumpSwap read-only simulations; add wallet signing only behind verified guarded execution and user approval.
7. Hooks: distinguish router-only enforcement from native token-wide restrictions; never promise that direct Pump trades honor SENRO rules.

No mainnet launch, signature, payment or broadcast was performed. Mock tests are not live transaction tests.


## Status as of this branch (read this before relying on anything above)

| Gate | State | Evidence kind |
| --- | --- | --- |
| 1 Metadata storage | Service, auth, sniffing, rate limits, gateway re-verification implemented (`worker/launchpad-upload.mjs`, `/api/launchpad/upload`) | MOCKED provider and gateway. No real IPFS upload has been performed. Blocked on `PINATA_JWT` (and optional `IPFS_GATEWAY`) being set in the host. |
| 2 Pump SDK | `create_v2` builder/inspector (`src/launchpad-create-tx.mjs`) | Real `@pump-fun/pump-sdk` instruction building, unit-tested offline. |
| 3 Simulation | Exact-message simulation with hash/blockhash binding, through the launch-scoped relay (`/api/launch-rpc`) | MOCKED upstream RPC. No real-cluster simulation has been performed. |
| 4 Submission | Sign, send (relay), poll, verify mint/curve; no retries | MOCKED upstream RPC and wallet. Gated off: needs `VITE_LAUNCH_ENABLED=true`, which must not be set without explicit production approval. |
| 5 Discovery | Registry of launches made through this page (`src/launch-registry.mjs`): one record per mint, duplicate/conflict handling, slot-ordered cursor pagination, localStorage persistence, on-chain reconciliation (live / graduated / missing / mismatch / unreachable). **Not a network-wide feed.** | Registry logic unit-tested; reconciliation uses the real SDK with a MOCKED connection. A public all-launches feed is **blocked**: it needs an indexer or webhook provider key and a verified event schema. |
| 6 Trading | Existing read-only Pump/PumpSwap buy simulation untouched. The launchpad links each launch to it (`/?mint=…#studio`), which only prefills the contract field; nothing loads, signs or sends. | Browser e2e checks the link and that a bad mint is ignored. No new trade signing was added. |
| 7 Hooks | Not started; direct Pump/PumpSwap trades bypass router-only rules | n/a |

### Relays
- `/api/solana` (existing): read-only, refuses every broadcast. Unchanged.
- `/api/launch-rpc` (new): separate. Simulates or sends only a v0, two-signer, no-lookup-table transaction with at most ComputeBudget limit/price and exactly one Pump `create_v2` instruction; sends need both signatures to verify, preflight on, no relay retries. Small read allow-list; all other methods and batches refused.

### Required before any live launch
1. Real upload test with provider credentials (server-side only).
2. Real simulation on mainnet with a funded test wallet, with the owner's explicit approval.
3. Owner's explicit production approval, then build with `VITE_LAUNCH_ENABLED=true`.
4. A single supervised launch with the owner's approval, recorded by signature.
5. Add rate limiting to `/api/launch-rpc` (not implemented; per-instance limits are best-effort).

### Browser check (`npm run e2e:launchpad`)
Headless Chrome against the real relay and upload handler, with a MOCKED chain, storage and wallet. It checks: the preview build never asks the wallet to sign a transaction; the live-enabled build signs once and sends once; a failed simulation or upload stops before signing; a confirmed launch is listed, survives a reload and reconciles; the studio deep link; the landing entry; no mobile overflow. It found one real bug (Node `Buffer` used in browser code). It is not evidence of a live launch.

### Landing entry
The landing page has a "Launch" nav link and a "Go to launchpad" section that open `/launchpad.html`.
