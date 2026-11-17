# Pumphooks Solana Launchpad — Phase 1

The separate /launchpad.html entrypoint is an interactive launch-draft UI, not an on-chain token launch. It validates token metadata, previews uploaded artwork locally, connects to a browser Solana wallet (address only), and exports a JSON draft. No upload, transaction construction, signing, or broadcast is implemented.

## Phase 2 implementation gates

1. Choose the canonical Pump SDK create flow and verify its current deployed program IDs and instruction schemas against official sources.
2. Upload metadata/image to a configured authenticated storage provider with MIME sniffing, content limits and URI verification. Do not place upload secrets in frontend code.
3. Prepare an unsigned launch transaction from the wallet address, current blockhash and verified metadata URI. Display network, program IDs, mint, rent, fees and any initial buy separately.
4. Simulate transaction with the same account metas and message bytes that the wallet will sign; handle blockhash expiry, failed simulations and wallet disconnects.
5. Add wallet-controlled signing and explicit confirmation after an independent review of transaction contents; reconcile signature to a finalized mint and index discovery events.
6. Add creator fee and hook configuration only when the supported Pump instructions and router enforcement are verified. Direct trades can bypass SENRO guard; do not advertise token-wide enforcement.

## Build

Run npm test and npm run build. Vite's multi-page configuration builds both index.html and launchpad.html. No mainnet transaction should occur in this phase.
