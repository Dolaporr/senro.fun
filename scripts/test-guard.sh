#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node scripts/check-program-identity.mjs
export PATH="$PATH:$HOME/.cargo/bin"
SENRO_SBF_VERSION="$(cargo build-sbf --version)"
printf '%s\n' "$SENRO_SBF_VERSION"
case "$SENRO_SBF_VERSION" in
  *"cargo-build-sbf 4.5.0"*) ;;
  *) printf 'Use cargo-build-sbf 4.5.0 for this candidate build. See protocol/CANDIDATE_IDENTITY.md.\n' >&2; exit 1 ;;
esac
python3 scripts/fetch-guard-fixtures.py --check
cargo build-sbf --manifest-path protocol/guard/Cargo.toml --tools-version v1.57 --sbf-out-dir protocol/target/deploy
cargo test --manifest-path protocol/guard/Cargo.toml --locked -j 2 -- --nocapture
node --test tests/guard-client.test.mjs
