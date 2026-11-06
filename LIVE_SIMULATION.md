# SENRO mainnet simulation

The existing interface now provides a separate mainnet SOL-buy simulation flow.

- Wallet Standard discovery and explicit connection; only the public address is read. No signing API is called.
- Public-address simulation is explicitly marked read-only and does not prove ownership.
- Mainnet genesis verification, initialized mint validation, token-program checks and canonical Pump/PumpSwap discovery.
- Official @pump-fun/pump-sdk 4.3.1 builders: curve buy_exact_quote_in_v3 and PumpSwap buy_exact_quote_in_v2.
- Exact input budget, positive minimum token output and unsigned simulateTransaction; no send method.
- Quote, observed ATA balance delta, estimated network fee, compute usage, program logs and exportable report.
- Request fingerprint binds wallet, mint, venue, input, slippage, revision and rules; a separate hash identifies the built message. Neither is represented as an on-chain SENRO commitment.
- Edits invalidate visible results. Results expire after 30 seconds. Reports are diagnostic snapshots and are never execution authorization.
- Trade size and account cap can be assessed locally. Rolling volume is unverified without authoritative history. Sell cooldown is not applicable to the buy-only flow.
- The mainnet transaction calls the venue directly; SENRO guards are not deployed or enforced by it.
- Non-SOL quotes, noncanonical pools, legacy cashback curves and signing/execution are unsupported in this release.

The default browser connection uses PublicNode directly, with paced RPC requests. On connection failures or transport rate limits it can fall back to /api/solana, a same-origin Worker relay with two fixed public mainnet upstreams (PublicNode, then Solana’s public endpoint), an RPC method allowlist, request-size bounds, and validation that simulated transactions have one empty signature. It rejects broadcasting, signing, batching, and foreign-origin calls. Custom HTTPS endpoints are used directly from the browser, remain in tab memory, and are excluded from reports. The public upstream may rate limit; the UI reports failures and permits a custom RPC.

## Verification

`npm test` passes 21 tests covering the existing Rust WASM behavior plus network identity, mint and token-account validation, integer slippage, actual mint decimals, unknown history, request changes/expiry, endpoint redaction, and relay restrictions.

`npm run build` builds the Vite app and embeds its assets in the Sites Worker. `node scripts/validate-worker.mjs` verifies the generated app, JS, WASM, and broadcast rejection.

Opt-in live smoke test (only public data and unsigned simulation):

```
SENRO_SIMULATION_ADDRESS=<funded-public-wallet> node scripts/smoke-mainnet.mjs
```

Observed 5 November 2026 using public mainnet state:

| Venue | Simulation | Compute units | Expected/observed token output (raw) | Minimum output (raw) |
| --- | --- | ---: | ---: | ---: |
| Pump curve | Succeeded, slot 465811432 | 72776 | 2878549562 | 2849764066 |
| PumpSwap | Succeeded, slot 465811487 | 90028 | 4418081 | 4373900 |

Both used 0.0001 SOL input, 1% slippage, and an estimated network fee of 5000 lamports. No fee was charged. Live results change with market state; these numbers are validation evidence, not quotes.

Browser QA also completed an unsigned PumpSwap buy at slot 465814856 using a public read-only address. It quoted and simulated 4.367220 tokens with a 4.323547-token minimum, displayed a 0.000005 SOL network fee estimate, and correctly labelled rolling history unverified. The hosted relay independently returned mainnet identity and rejected broadcasting, but shared-provider account reads rate limited from the Worker; direct browser RPC passed the complete flow. Wallet extension approval was not tested because this browser has no installed Solana wallet.
