# SENRO readiness review — 6 November 2026

Current decision: do not launch live trading. The simulation and rule-design product has a working local release candidate, subject to the Netlify redeployment and real-wallet checks below. This review is not an independent security audit.

## Landing page

The homepage now introduces SENRO, has a working local trade-cap example, explains the three-step flow and links into Studio at `/#studio`. Rule sets and Activity have direct hash links. Browser back/forward navigation is supported. The landing page explicitly describes the current simulation-only release and does not imply deployed enforcement.

## Fixes from this review

- Mobile flow artwork has its own centered canvas composition instead of negative horizontal insets. The complete gate was observed in a 400px browser iframe viewport. This is a real CSS viewport check, not an iOS/Android device test.
- Original SENRO SVG favicon, Apple touch icon and 192/512px app icons are included with a web manifest. No offline execution is promised.
- Netlify gets a dedicated static build, committed configuration and a native function at `/api/solana`, using the shared tested read-only handler. The prior live Netlify endpoint returned 404; homepage success did not mean the backend existed.
- The relay rejects oversized streamed bodies before accumulating the complete payload and cannot forward signed or broadcast transactions.
- A full saved-rule library refuses a new copy instead of silently deleting an older copy. Storage failure is visible; malformed revision metadata falls back to a safe integer.
- Rule, amount, slippage, market, RPC and mode changes synchronously invalidate pending review/simulation work, in addition to existing wallet-session invalidation.
- The disabled trading tab is named Trading setup to distinguish it from available simulations.

## Verification

| Area | Evidence / status |
| --- | --- |
| JavaScript regression suite | 73 passing checks |
| Netlify static release artifact | App, bundles, rule WASM, favicon, Apple/app icons and function route verified locally |
| Shared relay | Actual read returned the Solana mainnet genesis hash; broadcast and foreign-origin requests rejected in tests |
| Pump bonding curve | Actual unsigned buy simulation succeeded at slot 466116715; observed output matched quote; 68,402 compute units |
| PumpSwap | Actual unsigned buy simulation succeeded at slot 466116741; observed output matched quote; 91,448 compute units |
| Funds / signatures | No transaction signed or broadcast; no real SOL spent. Simulated 5,000-lamport fees are estimates, not charges |
| Rolling volume | Correctly Unverified in venue-only mainnet simulation; authoritative routed history is not connected |
| Browser UI | 400px viewport artwork, navigation, local checks and activity reviewed; desktop flow checked in earlier review |
| Rust runtime | Previously recorded 21 checks remain in protocol/BROWSER_VALIDATION.md; guard code unchanged and those checks were not rerun here |

## Remaining release gates

1. Redeploy the existing Netlify project from the GitHub source with its function. Run `npm run check:live -- https://senrotech.netlify.app` against the new deployment. A folder-only deployment is insufficient.
2. Test real Phantom/Solflare or the intended Wallet Standard wallet: detected logo, connection rejection, account switch, disconnect and off-chain message check. Also check a real iOS/Android wallet browser. No real extension is available in the QA browser.
3. For live trading, verify a final guard build and its actual cluster deployment, deployed program identity/hash, upgrade authority, policy setup, browser transaction bytes, rejection rollback, nonce/expiry and confirmation behaviour. Keep src/guard-deployment.mjs disabled until then.
4. Only the guard's per-trade cap is implemented for the narrow guarded buy. Rolling history, cooldown and account-cap enforcement are not a deployed complete product; do not advertise all rules as live enforcement. Direct venue trades remain bypassable.
5. Obtain independent review of the custody/signing/CPI and upgrade paths before a meaningful-funds release. No audit or mainnet readiness is implied by the automated tests.

## Product scope

Saved rule sets are local to the device, and activity is session-only. Users must not interpret drafts, local pass/fail scenarios or successful venue simulations as an activated policy. Backups are explicit exports. There are no unattended orders, platform fee revenue or token-wide anti-bot guarantees in this release.
