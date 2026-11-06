//! Executes the compiled guard and captured PumpSwap program inside LiteSVM, never mainnet.
use base64::Engine;
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use pump_adapter::{
    ix::{amm_v2_metas, AmmKeys},
    pda, NATIVE_MINT, PUMP_AMM_PROGRAM_ID, PUMP_FEES_PROGRAM_ID, SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
};
use senro_guard::{policy_address, Error, Policy, ID};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_program::pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{collections::BTreeMap, path::PathBuf, str::FromStr};
fn addr(p: &Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}
fn pk(p: &Address) -> Pubkey {
    Pubkey::new_from_array(p.to_bytes())
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}
fn convert(ix: solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: addr(&ix.program_id),
        data: ix.data,
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: addr(&m.pubkey),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
    }
}
fn meta(p: Pubkey, signer: bool, writable: bool) -> AccountMeta {
    AccountMeta {
        pubkey: addr(&p),
        is_signer: signer,
        is_writable: writable,
    }
}
fn compute() -> Instruction {
    Instruction {
        program_id: Address::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
        accounts: vec![],
        data: [vec![2], 1_000_000u32.to_le_bytes().to_vec()].concat(),
    }
}
fn ata(user: Pubkey, mint: Pubkey, program: Pubkey) -> Instruction {
    Instruction {
        program_id: addr(&pump_adapter::ATA_PROGRAM_ID),
        accounts: vec![
            meta(user, true, true),
            meta(pda::associated_token(&user, &program, &mint), false, true),
            meta(user, false, false),
            meta(mint, false, false),
            meta(SYSTEM_PROGRAM_ID, false, false),
            meta(program, false, false),
        ],
        data: vec![1],
    }
}
struct Env {
    svm: LiteSVM,
    payer: Keypair,
    user: Keypair,
    keys: AmmKeys,
    buyback: Pubkey,
    policy: Pubkey,
}
impl Env {
    fn new(cap: u64) -> Self {
        Self::with_atas(cap, true)
    }
    fn with_atas(cap: u64, prepare: bool) -> Self {
        let mut svm = LiteSVM::new().with_precompiles().with_log_bytes_limit(None);
        svm.add_program_from_file(addr(&ID), root().join("target/deploy/senro_guard.so"))
            .expect("build the guard first with cargo build-sbf");
        svm.add_program_from_file(
            addr(&PUMP_AMM_PROGRAM_ID),
            root().join("tests/fixtures/programs/pump_amm.so"),
        )
        .unwrap();
        svm.add_program_from_file(
            addr(&PUMP_FEES_PROGRAM_ID),
            root().join("tests/fixtures/programs/pump_fees.so"),
        )
        .unwrap();
        let dir = root().join("tests/fixtures/6DNxwecbtdNNstpB5tdnxZsfGe3HmsNgEUZhdue4b1PH");
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        for value in manifest["accounts"].as_object().unwrap().values() {
            let key = value.as_str().unwrap();
            let row: serde_json::Value =
                serde_json::from_slice(&std::fs::read(dir.join(format!("{key}.json"))).unwrap())
                    .unwrap();
            let a = &row["account"];
            let address = Address::from_str(key).unwrap();
            if key == NATIVE_MINT.to_string() && svm.get_account(&address).is_some() {
                continue;
            }
            svm.set_account(
                address,
                Account {
                    lamports: a["lamports"].as_u64().unwrap(),
                    data: base64::engine::general_purpose::STANDARD
                        .decode(a["data"][0].as_str().unwrap())
                        .unwrap(),
                    owner: Address::from_str(a["owner"].as_str().unwrap()).unwrap(),
                    executable: a["executable"].as_bool().unwrap(),
                    rent_epoch: 0,
                },
            )
            .unwrap();
        }
        let get = |s: &str| Pubkey::from_str(manifest["accounts"][s].as_str().unwrap()).unwrap();
        let mint = get("base_mint");
        let base_program = pk(&svm.get_account(&addr(&mint)).unwrap().owner);
        let keys = AmmKeys {
            pool: get("pool"),
            base_mint: mint,
            quote_mint: NATIVE_MINT,
            pool_base_token_account: get("pool_base_token_account"),
            pool_quote_token_account: get("pool_quote_token_account"),
            base_token_program: base_program,
            quote_token_program: TOKEN_PROGRAM_ID,
        };
        let user = Keypair::new();
        let payer = Keypair::new();
        svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
        svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let wallet = pk(&user.pubkey());
        let policy = policy_address(&ID, &wallet, &mint, &keys.pool).0;
        let mut e = Self {
            svm,
            payer,
            user,
            keys,
            buyback: Pubkey::from_str(manifest["buyback_fee_recipient"].as_str().unwrap()).unwrap(),
            policy,
        };
        let quote = pda::associated_token(&wallet, &TOKEN_PROGRAM_ID, &NATIVE_MINT);
        let sync = Instruction {
            program_id: addr(&TOKEN_PROGRAM_ID),
            accounts: vec![meta(quote, false, true)],
            data: vec![17],
        };
        if prepare {
            e.ok(&[
                ata(wallet, mint, base_program),
                ata(wallet, NATIVE_MINT, TOKEN_PROGRAM_ID),
                convert(solana_program::system_instruction::transfer(
                    &wallet, &quote, 20_000_000,
                )),
                sync,
            ]);
        }
        // Dust a yet-uninitialized policy to prove prefunding cannot squat its address.
        e.ok(&[convert(solana_program::system_instruction::transfer(
            &wallet, &e.policy, 1_000_000,
        ))]);
        let init = Instruction {
            program_id: addr(&ID),
            accounts: vec![
                meta(e.policy, false, true),
                meta(wallet, true, true),
                meta(mint, false, false),
                meta(e.keys.pool, false, false),
                meta(base_program, false, false),
                meta(SYSTEM_PROGRAM_ID, false, false),
            ],
            data: [vec![0], cap.to_le_bytes().to_vec()].concat(),
        };
        e.ok(&[init]);
        e
    }
    fn send(
        &mut self,
        ixs: &[Instruction],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let mut list = vec![compute()];
        list.extend_from_slice(ixs);
        let mut signers = vec![&self.payer];
        if list
            .iter()
            .flat_map(|i| &i.accounts)
            .any(|a| a.is_signer && a.pubkey == self.user.pubkey())
        {
            signers.push(&self.user);
        }
        let tx = Transaction::new_signed_with_payer(
            &list,
            Some(&self.payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        let result = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        result
    }
    fn ok(&mut self, ixs: &[Instruction]) -> TransactionMetadata {
        self.send(ixs)
            .unwrap_or_else(|e| panic!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }
    fn state(&self) -> Policy {
        Policy::decode(&self.svm.get_account(&addr(&self.policy)).unwrap().data).unwrap()
    }
    fn route(&self, amount: u64, min: u64, native: u64) -> Instruction {
        let p = self.state();
        let slot: solana_clock::Clock = self.svm.get_sysvar();
        let mut data = vec![2];
        data.extend_from_slice(&p.fingerprint(&ID));
        for x in [p.nonce, slot.slot + 30, amount, min, native] {
            data.extend_from_slice(&x.to_le_bytes());
        }
        let mut accounts = vec![meta(self.policy, false, true)];
        accounts.extend(
            amm_v2_metas(&self.keys, &pk(&self.user.pubkey()), &self.buyback)
                .into_iter()
                .map(|m| meta(m.pubkey, m.is_signer, m.is_writable)),
        );
        Instruction {
            program_id: addr(&ID),
            accounts,
            data,
        }
    }
    fn update(&self, cap: u64) -> Instruction {
        let mut data = vec![1];
        data.extend_from_slice(&self.state().revision.to_le_bytes());
        data.extend_from_slice(&cap.to_le_bytes());
        data.push(1);
        Instruction {
            program_id: addr(&ID),
            accounts: vec![
                meta(self.policy, false, true),
                meta(pk(&self.user.pubkey()), true, true),
            ],
            data,
        }
    }
    fn full_buy(&self, max_native: u64) -> Vec<Instruction> {
        let user = pk(&self.user.pubkey());
        let quote = pda::associated_token(&user, &TOKEN_PROGRAM_ID, &NATIVE_MINT);
        vec![
            ata(user, self.keys.base_mint, self.keys.base_token_program),
            ata(user, NATIVE_MINT, TOKEN_PROGRAM_ID),
            convert(solana_program::system_instruction::transfer(
                &user, &quote, 1_000_000,
            )),
            Instruction {
                program_id: addr(&TOKEN_PROGRAM_ID),
                accounts: vec![meta(quote, false, true)],
                data: vec![17],
            },
            self.route(1_000_000, 1, max_native),
            Instruction {
                program_id: addr(&TOKEN_PROGRAM_ID),
                accounts: vec![
                    meta(quote, false, true),
                    meta(user, false, true),
                    meta(user, true, false),
                ],
                data: vec![9],
            },
        ]
    }
    fn snapshots(&self) -> BTreeMap<Address, Option<Account>> {
        let wallet = pk(&self.user.pubkey());
        let keys = [
            self.policy,
            self.keys.pool,
            self.keys.pool_base_token_account,
            self.keys.pool_quote_token_account,
            wallet,
            pda::associated_token(&wallet, &self.keys.base_token_program, &self.keys.base_mint),
            pda::associated_token(&wallet, &TOKEN_PROGRAM_ID, &NATIVE_MINT),
            pda::amm::user_volume_accumulator(&wallet),
            pda::associated_token(&self.buyback, &TOKEN_PROGRAM_ID, &NATIVE_MINT),
        ];
        keys.into_iter()
            .map(|k| (addr(&k), self.svm.get_account(&addr(&k))))
            .collect()
    }
    fn rejects_unchanged(&mut self, ix: Instruction, error: Error) -> FailedTransactionMetadata {
        let before = self.snapshots();
        let failure = self.send(&[ix]).expect_err("trade must fail");
        assert!(
            format!("{:?}", failure.err).contains(&format!("Custom({})", error as u32)),
            "unexpected error: {:?}\n{}",
            failure.err,
            failure.meta.logs.join("\n")
        );
        assert_eq!(
            self.snapshots(),
            before,
            "a rejected trade changed guarded accounts"
        );
        failure
    }
}
#[test]
fn real_pumpswap_buy_succeeds_and_commits_nonce() {
    let mut e = Env::new(2_000_000);
    let before = e.snapshots();
    let hash = e.state().fingerprint(&ID);
    let ix = e.route(1_000_000, 1, 10_000_000);
    let result = e.ok(&[ix]);
    assert!(result.logs.iter().any(|s| s.contains("BuyExactQuoteInV2")));
    assert_eq!(e.state().nonce, 1);
    assert_eq!(e.state().fingerprint(&ID), hash);
    assert_ne!(before, e.snapshots());
    println!(
        "real PumpSwap success: {} CU",
        result.compute_units_consumed
    );
}
#[test]
fn over_cap_rejected_before_cpi_without_changing_balances() {
    let mut e = Env::new(500_000);
    let ix = e.route(1_000_000, 1, 10_000_000);
    let r = e.rejects_unchanged(ix, Error::TradeCap);
    assert!(!r.meta.logs.iter().any(|s| s.contains("BuyExactQuoteInV2")));
}
#[test]
fn post_cpi_native_debit_failure_rolls_back_real_swap_and_rent() {
    let mut e = Env::new(2_000_000);
    let ix = e.route(1_000_000, 1, 0);
    let r = e.rejects_unchanged(ix, Error::UnexpectedDebit);
    assert!(
        r.meta.logs.iter().any(|s| s.contains("BuyExactQuoteInV2")),
        "must execute the real swap before guard rejects it"
    );
    assert_eq!(e.state().nonce, 0);
}
#[test]
fn changed_policy_rejects_old_review() {
    let mut e = Env::new(2_000_000);
    let stale = e.route(1_000_000, 1, 10_000_000);
    e.ok(&[e.update(3_000_000)]);
    e.rejects_unchanged(stale, Error::RulesChanged);
}
#[test]
fn expired_and_unbounded_intents_reject() {
    let mut e = Env::new(2_000_000);
    let mut ix = e.route(1_000_000, 1, 10_000_000);
    let clock: solana_clock::Clock = e.svm.get_sysvar();
    ix.data[41..49].copy_from_slice(&(clock.slot + 151).to_le_bytes());
    e.rejects_unchanged(ix, Error::Expired);
    let ix = e.route(1_000_000, 1, 10_000_000);
    e.svm.warp_to_slot(clock.slot + 31);
    e.rejects_unchanged(ix, Error::Expired);
}
#[test]
fn same_nonce_cannot_execute_twice_even_with_fresh_signature() {
    let mut e = Env::new(2_000_000);
    let ix = e.route(1_000_000, 1, 10_000_000);
    e.ok(&[ix.clone()]);
    e.rejects_unchanged(ix, Error::Replay);
}
#[test]
fn zero_minimum_and_arbitrary_remaining_accounts_reject() {
    let mut e = Env::new(2_000_000);
    let ix = e.route(1_000_000, 0, 10_000_000);
    e.rejects_unchanged(ix, Error::MinimumOutput);
    let mut ix = e.route(1_000_000, 1, 10_000_000);
    ix.accounts.push(meta(Pubkey::new_unique(), false, false));
    e.rejects_unchanged(ix, Error::Accounts);
}
#[test]
fn wrong_pool_vault_is_rejected() {
    let mut e = Env::new(2_000_000);
    let mut ix = e.route(1_000_000, 1, 10_000_000);
    ix.accounts.swap(1 + 7, 1 + 8);
    e.rejects_unchanged(ix, Error::Accounts);
}

#[test]
fn missing_wallet_signature_is_rejected() {
    let mut e = Env::new(2_000_000);
    let mut ix = e.route(1_000_000, 1, 10_000_000);
    ix.accounts[2].is_signer = false;
    e.rejects_unchanged(ix, Error::Signature);
}
#[test]
fn another_signer_cannot_edit_the_wallet_policy() {
    let mut e = Env::new(2_000_000);
    let mut ix = e.update(9_000_000);
    ix.accounts[1] = meta(pk(&e.payer.pubkey()), true, true);
    let before = e.state();
    let r = e
        .send(&[ix])
        .expect_err("an unrelated signer cannot update this policy");
    assert!(format!("{:?}", r.err).contains("Custom(3)"));
    assert_eq!(e.state(), before);
}
#[test]
fn a_substituted_cpi_program_is_rejected() {
    let mut e = Env::new(2_000_000);
    let mut ix = e.route(1_000_000, 1, 10_000_000);
    ix.accounts[17] = meta(SYSTEM_PROGRAM_ID, false, false);
    e.rejects_unchanged(ix, Error::Accounts);
}

#[test]
fn setup_wrap_guard_and_cleanup_succeed_in_one_transaction() {
    let mut e = Env::with_atas(2_000_000, false);
    let list = e.full_buy(10_000_000);
    let r = e.ok(&list);
    assert!(r.logs.iter().any(|s| s.contains("BuyExactQuoteInV2")));
    assert_eq!(e.state().nonce, 1);
    let user = pk(&e.user.pubkey());
    let base = pda::associated_token(&user, &e.keys.base_token_program, &e.keys.base_mint);
    let quote = pda::associated_token(&user, &TOKEN_PROGRAM_ID, &NATIVE_MINT);
    assert!(
        u64::from_le_bytes(
            e.svm.get_account(&addr(&base)).unwrap().data[64..72]
                .try_into()
                .unwrap()
        ) > 0
    );
    assert_eq!(
        e.svm
            .get_account(&addr(&quote))
            .map(|a| a.lamports)
            .unwrap_or(0),
        0
    );
    println!(
        "atomic setup/wrap/guard/cleanup: {} CU",
        r.compute_units_consumed
    );
}
#[test]
fn post_guard_failure_rolls_back_setup_wrapping_and_real_swap_together() {
    let mut e = Env::with_atas(2_000_000, false);
    let before = e.snapshots();
    let list = e.full_buy(0);
    let r = e
        .send(&list)
        .expect_err("native debit bound must fail after swap");
    assert!(format!("{:?}", r.err).contains(&format!("Custom({})", Error::UnexpectedDebit as u32)));
    assert!(r.meta.logs.iter().any(|s| s.contains("BuyExactQuoteInV2")));
    assert_eq!(e.snapshots(), before);
}
