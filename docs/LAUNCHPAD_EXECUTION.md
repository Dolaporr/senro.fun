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
