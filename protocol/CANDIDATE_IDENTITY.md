# Candidate program identity — 6 November 2026

Program address selected by the owner on their Mac:

`E1e4396v1CB8ttJ8FoBLN23Acfi25auiMabqpPjBgAwU`

The owner generated and retains the program-identity keypair locally. Only the public address was supplied. This is an intended identity, not an existing deployment or a funding address.

## Source changes

- The Rust guard's compiled `ID` now binds this address. Instruction/policy semantics are unchanged.
- The Rust runtime passes its compiled `ID` into the offline browser-wire bridge. The bridge no longer silently defaults to the old local test ID.
- The original `[83; 32]` Rust/JavaScript fingerprint vector remains a legacy conformance check. A second vector binds the candidate address: `20674d5a00354e0bfdbfbe39b5fdf42b6e0eca989dd5617c398a1d548c8eb7f6`.
- `protocol/client/program-id.mjs` exports the candidate identity for source checks. Browser live trading still requires a separate verified deployment configuration; it has not been enabled.
- `scripts/check-program-identity.mjs` checks that the Rust source and candidate client identity match. It does not inspect an ELF, load a private key or prove on-chain deployment.

## Validation completed here

84 JavaScript tests pass, including both identity vectors and a candidate-address instruction. The source identity checker passes. No Rust, cargo-build-sbf or local SVM is available in this execution environment, so the new Rust/SBF/runtime build is **pending on the owner's Mac**. Earlier artifact hashes and runtime measurements describe the former test identity and do not apply to this candidate.

## Mac setup and validation

Use the tested `cargo-build-sbf` 4.5.0 and platform-tools v1.57 for this candidate. Install the builder into a separate directory so it does not replace the owner's existing Solana tools:

```sh
cargo install cargo-build-sbf --version 4.5.0 --locked --root "$HOME/.local/share/senro-tools"
export PATH="$HOME/.local/share/senro-tools/bin:$PATH"
cargo build-sbf --version
```

Then run from the repository checkout:

```sh
node scripts/check-program-identity.mjs --program-id E1e4396v1CB8ttJ8FoBLN23Acfi25auiMabqpPjBgAwU
python3 scripts/fetch-guard-fixtures.py
bash scripts/test-guard.sh
```

The fixture fetch performs read-only public RPC requests and verifies pinned executable hashes. If a venue binary no longer matches its pin, stop and review the venue change rather than changing the pin to make tests pass. The test script checks the builder version, uses platform-tools v1.57, builds a new guard artifact, and executes the local runtime suite. It does not deploy or spend real SOL.

After a passing build, record its hash, actual tool versions and runtime results. Quote deployment rent against this artifact and the chosen allocation. The fee payer and upgrade-authority signing arrangements are still separate decisions. Any deployment must explicitly use the owner's program keypair for the candidate address; a generated build-output keypair may have a different public address. Do not upload either keypair to GitHub, Netlify or chat.
