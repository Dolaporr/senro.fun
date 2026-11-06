#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
python3 scripts/fetch-guard-fixtures.py --check
export PATH="$HOME/.cargo/bin:$PATH"
cargo build-sbf --manifest-path protocol/guard/Cargo.toml --tools-version v1.57 --sbf-out-dir protocol/target/deploy
cargo test --manifest-path protocol/guard/Cargo.toml --locked -j 2 -- --nocapture
node --test tests/guard-client.test.mjs
