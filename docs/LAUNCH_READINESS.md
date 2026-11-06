# SENRO readiness review — 6 November 2026

Current decision: do not launch live trading. The simulation and rule-design product has a working local release candidate, with live Netlify deployment checks passing and real-wallet checks still required. This review is not an independent security audit.

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

1. Preserve the verified Netlify build and function configuration. After each release, run `npm run check:live -- https://senrotech.netlify.app`. The latest deployment passed the strict asset types, deployed WASM scenarios, API denial and mainnet checks. A folder-only deployment must also include the deployed function.
2. The owner has now tested Solflare on iPhone: provider/logo detection, connect/reject/disconnect, reported account switching, and verified off-chain message signing passed. Other wallets/devices and actual transaction signing remain unverified. See docs/WALLET_VALIDATION.md and docs/LIVE_TRADING_ROLLOUT.md.
3. For live trading, verify a final guard build and its actual cluster deployment, deployed program identity/hash, upgrade authority, policy setup, browser transaction bytes, rejection rollback, nonce/expiry and confirmation behaviour. Keep src/guard-deployment.mjs disabled until then.
4. Only the guard's per-trade cap is implemented for the narrow guarded buy. Rolling history, cooldown and account-cap enforcement are not a deployed complete product; do not advertise all rules as live enforcement. Direct venue trades remain bypassable.
5. Obtain independent review of the custody/signing/CPI and upgrade paths before a meaningful-funds release. No audit or mainnet readiness is implied by the automated tests.

## Product scope

Saved rule sets are local to the device, and activity is session-only. Users must not interpret drafts, local pass/fail scenarios or successful venue simulations as an activated policy. Backups are explicit exports. There are no unattended orders, platform fee revenue or token-wide anti-bot guarantees in this release.


## Follow-up deployment check — 6 November 2026

- The Netlify homepage references the latest icon/hover release bundles. The existing live check passed app/assets/icons/WASM existence, API presence, broadcast rejection and mainnet genesis identity.
- A stricter replacement now checks asset response types and PNG signatures, parses the manifest, executes all six default scenarios against the WASM fetched from the deployed host, and checks foreign-origin rejection. It rejects HTML fallbacks instead of accepting an arbitrary HTTP 200 response.
- This stricter check found the live manifest served as `application/octet-stream` under `nosniff`. Added `public/_headers` with explicit manifest and WASM types; the build validator checks these rules are packaged. After the GitHub push, the latest Netlify deployment passed the full strict check, including the corrected manifest content type.
- Fresh unsigned buys succeeded through **the Netlify relay**, using the supplied public simulation address: Pump curve at slot **466176070**, **68,428 CU**, output **2,902,371,911 raw token units**; PumpSwap at slot **466176095**, **91,421 CU**, output **4,191,583 raw token units**. Observed output matched the SDK quote in both. Each simulated network fee was 5,000 lamports, not an actual charge.
- Fixed the mainnet smoke CLI so `ok:false` results cause a failing exit status. Previously only thrown exceptions failed the command. Added regression coverage for this and broken deployments.
- **76 JavaScript tests passed**. Guard source and release identity are unchanged, and live trading remains disabled. These checks use real remote reads/simulations but do not test a real wallet extension, on-chain policy enforcement, or transaction confirmation.

Final post-push verification: `check:live` exited 0 against `https://senrotech.netlify.app`, with all three stages passing: app/bundles/icons; six deployed WASM scenarios; read-only API, broadcast and foreign-origin denial, and mainnet genesis. No wallet signing or live trade was performed.
