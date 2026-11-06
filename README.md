# SENRO

A rule studio for Solana: set limits and inspect an unsigned Pump / PumpSwap buy simulation before trading.

**Experimental, simulation-only.** The published configuration does not sign or broadcast transactions. The guard program is local, undeployed and unaudited. A gated browser integration is included but disabled pending deployment and end-to-end validation. A passing venue simulation is not proof that SENRO rules were enforced on-chain.

## Run the app

Requires Node >=22.12.0 and npm.

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run build` produces a static frontend. Its `/api/solana` endpoint needs the included RPC relay for live simulations. For a Worker bundle that includes both frontend and relay:

```sh
npm run build:worker
node scripts/validate-worker.mjs
```

The frontend supports wallet address connection, contract address (CA) discovery for supported SOL Pump / PumpSwap markets, unsigned venue simulations, and local draft assessments. RPC requests are allowlisted; transaction broadcasting is rejected. Rolling history remains unverified without an authoritative history source.

## Experimental guard

`protocol/guard` contains a Solana program for wallet-owned per-trade quote caps around canonical SOL PumpSwap buys. It binds the policy hash, revision, nonce, slot deadline, exact quote budget and minimum output; validates the CPI accounts; and checks observed balance changes. Setup, wrapping, guard CPI and cleanup are covered by atomic runtime success and rollback tests.

The guard implements trade caps and per-intent bounds. It does not yet implement rolling volume, sell cooldowns, account caps, bonding-curve routing, or automated orders. Direct venue trades bypass it. The embedded program identity is a local test placeholder.

Requires Rust, cargo-build-sbf 4.5.0, platform-tools v1.57, and ordinary compiler/OpenSSL dependencies on Linux:

```sh
python3 scripts/fetch-guard-fixtures.py
npm run test:guard
```

Captured Pump executables and generated guard binaries are excluded. The fetch script validates pinned executable hashes and fails if upstream deployments changed; it never silently updates pins. Set `SENRO_RPC_URL` for another HTTPS Solana mainnet RPC if the public endpoint rate-limits requests. Keep authenticated endpoints private.

The original local validation recorded 16 Rust checks (3 unit and 13 runtime). The JavaScript suite has 46 tests, including guarded browser-flow and read-only deployment-preflight regressions. See `protocol/VALIDATION.md` for recorded results, provenance, and limitations; recorded checks are not an audit.

## Source map

- `src/`: React studio, wallet connection, rule assessment and unsigned transaction builder.
- `worker/rpc.mjs`: restricted simulation RPC relay.
- `engine/`: Rust rule core and browser WASM source.
- `public/engine/`: first-party browser WASM build.
- `protocol/`: experimental Solana guard, client, runtime tests and public account fixtures.
- `protocol-changes/`: earlier upstream router patch.
- `tests/`: JavaScript regression tests.

## Before live trading

See `docs/GUARDED_TRADING.md` for the disabled browser integration, validation scope and release prerequisites. Choose a deployment identity and upgrade governance, verify browser-generated guarded transactions end to end, and obtain independent review. Publishing this repository does not deploy a program or enable trading.

## License and attribution

Apache-2.0. Includes Pump Hooks source adapted from https://github.com/Pumphooks/pumphooks at commit `b7fc9f008ebd474b29a770ec7c4d434df84eff2d`. See `LICENSE`, `NOTICE` and `protocol/NOTICE`. SENRO is not affiliated with Pump.fun or endorsed by Pump Hooks.

For owner-controlled signing setup and read-only rent estimates, see `docs/DEPLOYMENT_PREFLIGHT.md`.
