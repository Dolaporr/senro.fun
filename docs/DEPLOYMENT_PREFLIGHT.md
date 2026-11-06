# Deployment preflight

A wallet public address identifies the intended fee payer. It does not authorize signing, prove control of its private key, select the guard's program identity, or assign upgrade authority. Connecting the browser wallet for simulation does not grant program-deployment signing access.

The guard remains local-only and trading stays disabled. Complete the actual browser-message runtime tests and final-build review before deployment.

## Read-only estimate

After building an executable, from the repository root:

```sh
node scripts/deployment-preflight.mjs \
  --wallet YOUR_PUBLIC_WALLET_ADDRESS \
  --artifact protocol/target/deploy/senro_guard.so
```

Use `--reference` when examining an old/local test build. Set `SENRO_RPC_URL` privately if necessary. The default is Solana's public mainnet endpoint. The script requires HTTPS, checks the genesis hash, validates the ELF header and reports the executable hash, account sizes, wallet balance and rent returned by RPC. It cannot establish deployment readiness from an arbitrary ELF; output always sets `readyToDeploy: false`.

By default the estimate allocates exactly the executable length. If the selected CLI command reserves more program capacity, pass the matching `--allocation-bytes` value. A CLI deployment using different allocation may cost more. The script does not infer CLI defaults.

The report separates permanent program-account rent from the temporary upload-buffer rent. It includes a conservative separate-account funding sum, not an exact peak-wallet quote: funding transfers and buffer recovery depend on the deployment flow. Network and priority fees, retries and failed-deployment buffer handling are additional.

No keypair is loaded. No wallet extension is called. Only genesis, balance and rent RPC reads are allowed. Reports can contain wallet balances and should not be committed to the public repository.

## Owner-controlled identity and signing

1. Check the installed local tooling with `solana --version`, `solana-keygen --version`, `cargo --version` and `cargo build-sbf --version`.
2. Create and retain a separate program keypair securely on the owner's computer. Its public key becomes the program ID. Keep it outside this checkout and build-output directories; never upload its private key or seed phrase to chat or GitHub.
3. Select the fee-payer signing method and upgrade authority explicitly. A browser wallet address alone is not a supported CLI signer; do not export a daily-use wallet's secret just to make a command work.
4. Update the embedded program identity, rebuild, and run the relevant unit/runtime and browser-message tests for that exact source. Account for program-ID-bound hash vectors when preparing release tests.
5. Query rent for the final artifact/allocation and review the deployment command, signers and maximum spend before funding or signing. No deployment command is run by the preflight script.
6. After deployment, verify programdata, executable bytes and upgrade authority; pin them in the release configuration. Keep guarded trading disabled until controlled end-to-end validation and review are complete.

Official references:
- https://solana.com/docs/programs/deploying
- https://solana.com/docs/references/solana-cli
