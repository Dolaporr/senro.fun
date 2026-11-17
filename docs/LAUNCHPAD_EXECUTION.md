# Pumphooks — launch execution boundary

Phase 2 introduces deterministic launch planning and simulation acceptance checks, not a transaction broadcaster. The UI is still a draft preview. The planner rejects unsupported networks, malformed addresses, non-HTTPS/IPFS/Arweave metadata locations, invalid token identity, and malformed u64 buy values. A simulation may be accepted only for the same message hash, within 30 seconds, and without an RPC execution error.

## Not implemented

Metadata upload provider, authoritative Pump SDK create instruction assembly, mint keypair lifecycle, rent/fee calculation, unsigned transaction simulation, wallet signing, confirmation, discovery indexing, token trading, and creator fee collection. No tests should be described as a successful token creation. No mainnet transaction was attempted.

## Required integration sequence

1. Verify the installed @pump-fun/pump-sdk version's create instruction API against package source and official deployed program IDs; do not guess instruction layouts.
2. Introduce an authenticated metadata upload service, content-addressed metadata URI verification, and file-content validation. The current image preview is local-only.
3. Build unsigned create instructions, including optional initial buy, and compare fee/rent budgets to on-chain account state.
4. Simulate the exact unsigned transaction on the target cluster and bind the result to its serialized message hash, blockhash and wallet.
5. Add opt-in wallet signature and broadcast only after independently reviewing every account, signer and program ID. Verify confirmation and mint account ownership before showing success.
6. Index token events and creator balances; distinguish Pump venue mechanics from optional SENRO routed rules, which cannot constrain direct trades.

The phase-2 planner is deliberately chain-safe scaffolding, not proof that Pump create instructions work.
