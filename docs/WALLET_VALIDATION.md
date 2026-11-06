# Wallet boundary validation — 6 November 2026

Live trading remains disabled. No deployment or real-money trade was performed.

## Current checks

66 JavaScript tests pass. New coverage exercises synchronous account/disconnect/reconnect invalidation, rejected approvals, expired or reused challenges, changed message bytes and invalid Ed25519 signatures. A guarded-trade test confirms that a session change during signing prevents any send before React rerenders.

The existing 21 Rust checks and browser-wire runtime evidence are recorded separately in protocol/BROWSER_VALIDATION.md; that historical artifact has not been rewritten as evidence for these newer UI changes.

The optional wallet diagnostic signs a random, origin-bound, account-bound, expiring off-chain message. It verifies the signature locally, discards raw signatures and has no transaction or broadcast fallback. Advertised transaction capability is distinct from tested transaction signing.

## Manual extension test still required

1. Open Guarded buy and connect a mainnet-capable wallet.
2. Choose Check wallet signing. Read the exact challenge.
3. Choose Sign test message and approve it in your own wallet.
4. Confirm the UI reports verified message signing. Transaction signing must remain untested.
5. Repeat and cancel; the UI must show cancellation without creating a transaction.
6. Switch accounts or disconnect while approval is pending; the previous result must be discarded.

No actual wallet extension is available in the QA browser. Automated cryptographic and mocked wallet tests do not establish real extension behavior.

## Local scenario corrections

Synthetic rolling-window checks now distinguish a full 64-observation history from volume rejection. Tests also cover one-unit fills, u64 limits and time-window overflow. This corrects the scenario expectations; the Rust rule core is unchanged.

## Design refinement

The studio uses shorter icon-and-value rule controls, clearer currency/preset controls, a prominent connection action, consistent dialogs and responsive layouts. Rules still edit through explicit dialogs; preview and enforcement scope remain visible. Browser QA confirmed edited limits and expected capacity rejection.

## Hosting

The ChatGPT Site and Netlify deployment are separate. Updating one does not establish that senrotech.netlify.app has been updated. Live deployment requires its own host connection or deploying the latest GitHub source.

## Wallet panel and icon refinement

The connection panel is a right-aligned glass dialog with a separate read-only address form. Installed providers are detected through the existing Wallet Standard registry; their own inline data-image logos are displayed with a monogram fallback. No uninstalled provider is presented as a working connection. SENRO uses an original SVG icon family for navigation, rules, balances, network settings and wallet connection.

Browser QA checked opening the panel, focus placement, expanding read-only access, the disabled empty-submit state and rejection of invalid addresses. Actual provider logo rendering, connection and signing in a real extension still require the user's browser. The 70 regression tests and production build pass; trading remains disabled.

## Mobile browser handoff — 6 November 2026

The iPhone browser test exposed a missing entry path: installed wallet apps are not enumerated by Wallet Standard in an ordinary phone browser. The connection panel now offers explicit **Open in Phantom** and **Open in Solflare** links when no in-browser provider is registered. They use the wallets' documented universal browse links, with locally hosted brand assets and preserved license notices.

The wallet opens SENRO at `?connectWallet=1#studio`. The hint opens the connection panel and is removed from browser history; it never automatically calls connect, signs, or treats a URL as proof of an account. Existing Wallet Standard connection/session validation remains unchanged. The target keeps the same app origin and path but strips arbitrary query strings, hashes, RPC credentials and addresses. No attempt is made to infer which apps are installed. The app must still be approved in the wallet browser.

Another-wallet help provides a copyable link and manual Browser/Discover instructions. If clipboard permission is unavailable, the UI shows manual-copy guidance. Drafts and named rule sets are browser-local and are not silently transferred. The panel says to review limits again after switching browsers.

Verification: **80 JavaScript tests pass**, including URL encoding, same-origin targeting, credential/query stripping, unsafe-scheme rejection, one-time UI hints and mobile/iPad detection. A real 390px CSS iframe review confirmed both locally hosted wallet logos and links, the connection panel after handoff, and manual-copy feedback when iframe clipboard access is denied. This is not an actual iPhone app-switch test. Actual wallet opening, provider registration, approval/rejection, account switching and signing still require a real phone.

References:
- https://docs.phantom.com/phantom-deeplinks/other-methods/browse
- https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse

## Owner's iPhone/Solflare results — 6 November 2026

The owner supplied screenshots and reports confirming mobile app handoff, Solflare provider detection, connection rejection and retry/approval, disconnect, account switching, unsigned PumpSwap previews, trade-cap assessment, saved-rule persistence, six local scenario outcomes, Activity details and verified off-chain message signing. The 0.0001 SOL preview showed matching quoted/received output of 4.24075 tokens; the 0.0002 SOL preview correctly showed a locally blocked trade-size assessment under the 0.0001 SOL cap. These are observed owner tests on this device; guarded transaction signing, on-chain policies and real transaction confirmation remain untested. See LIVE_TRADING_ROLLOUT.md for the deployment path.
