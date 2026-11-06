use pump_next_route_guard::*;

fn policy() -> Policy {
    Policy { id: [1;32], authority: [2;32], base_mint: [3;32], quote_mint: [4;32],
        base_token_program: [5;32], quote_token_program: [6;32], venue_program: [7;32],
        revision: 1, active: true, max_quote_age_slots: 10,
        limits: Limits { max_quote_per_trade: Some(100), max_account_base: Some(1_000),
            sell_cooldown_seconds: Some(30), rolling_quote: Some(Window { seconds: 60, quote_limit: 100 }) } }
}
fn scope() -> VerifiedScope {
    VerifiedScope { actor: [8;32], source_account: [9;32], destination_account: [10;32],
        base_mint: [3;32], quote_mint: [4;32], base_token_program: [5;32],
        quote_token_program: [6;32], venue_program: [7;32] }
}
fn intent(p: &Policy, nonce: u64) -> Intent {
    Intent { policy_id: p.id, policy_revision: p.revision, policy_fingerprint: p.fingerprint(),
        actor: [8;32], source_account: [9;32], destination_account: [10;32], side: Side::Buy,
        nonce, quoted_at_slot: 100, deadline_slot: 110, amount_in: 40, min_out: 50,
        max_protocol_fee_quote: 2 }
}
fn clock(t: u64) -> Clock { Clock { slot: 100, unix_seconds: t } }
fn fill() -> MeasuredTrade {
    MeasuredTrade { input_debit: 40, output_credit: 60, base_account_balance_after: 500, protocol_fee_quote: 1 }
}
fn rejection(p: &Policy, i: Intent, sc: VerifiedScope, c: Clock, m: MeasuredTrade, expected: Error) {
    let mut state = TraderState::new(p, [8;32]).unwrap();
    let original = state;
    assert_eq!(settle(p, &i, &mut state, &sc, c, m), Err(expected));
    assert_eq!(state, original, "a rejected fill must leave every counter unchanged");
}

#[test]
fn valid_trade_records_measured_amounts_and_router_scope() {
    let p = policy();
    let mut state = TraderState::new(&p, [8;32]).unwrap();
    let receipt = settle(&p, &intent(&p,0), &mut state, &scope(), clock(1000), fill()).unwrap();
    assert_eq!(receipt.quote_volume, 40);
    assert_eq!(receipt.output_credit, 60);
    assert_eq!(receipt.protocol_fee_quote, 1);
    assert!(receipt.router_only);
    assert_eq!(state.next_nonce(), 1);
}

#[test]
fn signed_revision_and_fingerprint_cannot_be_substituted() {
    let p = policy();
    for variant in 0..3 {
        let mut i = intent(&p,0);
        match variant { 0 => i.policy_revision += 1, 1 => i.policy_fingerprint[0] ^= 1, _ => i.policy_id[0] ^= 1 }
        rejection(&p, i, scope(), clock(1000), fill(), Error::PolicyChanged);
    }
}

#[test]
fn every_verified_scope_field_is_bound() {
    let p = policy();
    for variant in 0..8 {
        let mut s = scope();
        match variant {
            0 => s.actor[0] ^= 1, 1 => s.source_account[0] ^= 1, 2 => s.destination_account[0] ^= 1,
            3 => s.base_mint[0] ^= 1, 4 => s.quote_mint[0] ^= 1, 5 => s.base_token_program[0] ^= 1,
            6 => s.quote_token_program[0] ^= 1, _ => s.venue_program[0] ^= 1,
        }
        rejection(&p, intent(&p,0), s, clock(1000), fill(), Error::ScopeMismatch);
    }
}

#[test]
fn same_source_and_destination_is_rejected() {
    let p = policy(); let mut i = intent(&p,0); let mut s = scope();
    i.destination_account = i.source_account; s.destination_account = s.source_account;
    rejection(&p,i,s,clock(1000),fill(),Error::ScopeMismatch);
}

#[test]
fn quote_freshness_and_deadline_have_explicit_boundaries() {
    let p = policy(); let i = intent(&p,0);
    rejection(&p,i,scope(),Clock{slot:99, unix_seconds:1000},fill(),Error::QuoteFromFuture);
    rejection(&p,i,scope(),Clock{slot:111, unix_seconds:1000},fill(),Error::DeadlineExpired);
    let mut stale = i; stale.deadline_slot = 200;
    rejection(&p,stale,scope(),Clock{slot:111, unix_seconds:1000},fill(),Error::QuoteTooOld);
    let s = TraderState::new(&p,[8;32]).unwrap();
    assert!(preflight(&p,&i,&s,&scope(),Clock{slot:110, unix_seconds:1000}).is_ok());
}

#[test]
fn permissive_sdk_defaults_are_not_accepted() {
    let p = policy();
    for variant in 0..2 { let mut i = intent(&p,0);
        if variant == 0 { i.min_out = 0; } else { i.amount_in = 0; }
        rejection(&p,i,scope(),clock(1000),fill(),Error::InvalidBounds);
    }
}

#[test]
fn postconditions_are_always_enforced() {
    let p = policy(); let i = intent(&p,0);
    let mut m = fill(); m.base_account_balance_after = 1_001;
    rejection(&p,i,scope(),clock(1000),m,Error::AccountBalance);
    m = fill(); m.output_credit = 49;
    rejection(&p,i,scope(),clock(1000),m,Error::Slippage);
    m = fill(); m.input_debit = 41;
    rejection(&p,i,scope(),clock(1000),m,Error::InputMismatch);
    m = fill(); m.protocol_fee_quote = 3;
    rejection(&p,i,scope(),clock(1000),m,Error::FeeCap);
}

#[test]
fn per_trade_cap_uses_measured_quote() {
    let p = policy(); let mut i = intent(&p,0); let mut m = fill();
    i.amount_in = 101; m.input_debit = 101;
    rejection(&p,i,scope(),clock(1000),m,Error::TradeSize);
}

#[test]
fn trade_receipt_cannot_be_replayed() {
    let p = policy(); let mut s = TraderState::new(&p,[8;32]).unwrap(); let i = intent(&p,0);
    settle(&p,&i,&mut s,&scope(),clock(1000),fill()).unwrap();
    let original = s;
    assert_eq!(settle(&p,&i,&mut s,&scope(),clock(1001),fill()),Err(Error::NonceMismatch));
    assert_eq!(s, original);
}

#[test]
fn one_fill_is_accounted_once() {
    let p = policy(); let mut s = TraderState::new(&p,[8;32]).unwrap();
    settle(&p,&intent(&p,0),&mut s,&scope(),clock(1000),fill()).unwrap();
    settle(&p,&intent(&p,1),&mut s,&scope(),clock(1001),fill()).unwrap();
    let original = s;
    assert_eq!(settle(&p,&intent(&p,2),&mut s,&scope(),clock(1002),fill()),Err(Error::RollingVolume));
    assert_eq!(s, original);
}

#[test]
fn rolling_limit_does_not_reset_at_upstream_anchored_boundary() {
    let p = policy(); let mut s = TraderState::new(&p,[8;32]).unwrap();
    let mut i = intent(&p,0); let mut m = fill(); i.amount_in = 1; m.input_debit = 1;
    settle(&p,&i,&mut s,&scope(),clock(1000),m).unwrap();
    i = intent(&p,1); i.amount_in = 99; m.input_debit = 99;
    settle(&p,&i,&mut s,&scope(),clock(1059),m).unwrap();
    i.nonce = 2;
    let original = s;
    assert_eq!(settle(&p,&i,&mut s,&scope(),clock(1060),m),Err(Error::RollingVolume));
    assert_eq!(s,original);
    // At t=1119 the 99-unit observation expires; inclusive expiry is documented.
    settle(&p,&i,&mut s,&scope(),clock(1119),m).unwrap();
}

#[test]
fn cooldown_applies_to_sells_and_survives_intervening_buys() {
    let mut p = policy(); p.limits.rolling_quote = None;
    let mut s = TraderState::new(&p,[8;32]).unwrap(); let mut i = intent(&p,0); i.side = Side::Sell;
    settle(&p,&i,&mut s,&scope(),clock(1000),fill()).unwrap();
    settle(&p,&intent(&p,1),&mut s,&scope(),clock(1010),fill()).unwrap();
    i.nonce = 2;
    assert_eq!(settle(&p,&i,&mut s,&scope(),clock(1029),fill()),Err(Error::SellCooldown));
    settle(&p,&i,&mut s,&scope(),clock(1030),fill()).unwrap();
}

#[test]
fn selling_is_not_blocked_by_the_buy_balance_cap() {
    let p = policy(); let mut i = intent(&p,0); i.side = Side::Sell;
    let mut s = TraderState::new(&p,[8;32]).unwrap(); let mut m = fill(); m.base_account_balance_after = 5000;
    assert!(settle(&p,&i,&mut s,&scope(),clock(1000),m).is_ok());
}

#[test]
fn policy_edits_cannot_silently_reset_live_history() {
    let p = policy(); let mut s = TraderState::new(&p,[8;32]).unwrap();
    settle(&p,&intent(&p,0),&mut s,&scope(),clock(1000),fill()).unwrap();
    let mut changed = p; changed.revision += 1;
    let original = s;
    assert_eq!(settle(&changed,&intent(&changed,1),&mut s,&scope(),clock(1001),fill()),Err(Error::StateMismatch));
    assert_eq!(s,original);
}

#[test]
fn backwards_time_is_not_a_window_reset() {
    let p = policy(); let mut s = TraderState::new(&p,[8;32]).unwrap();
    settle(&p,&intent(&p,0),&mut s,&scope(),clock(1000),fill()).unwrap();
    let original = s;
    assert_eq!(settle(&p,&intent(&p,1),&mut s,&scope(),clock(999),fill()),Err(Error::ClockWentBackwards));
    assert_eq!(s,original);
}

#[test]
fn event_capacity_fails_closed_instead_of_dropping_live_volume() {
    let mut p = policy(); p.limits.rolling_quote.as_mut().unwrap().quote_limit = u64::MAX;
    let mut s = TraderState::new(&p,[8;32]).unwrap();
    for nonce in 0..MAX_WINDOW_EVENTS as u64 {
        settle(&p,&intent(&p,nonce),&mut s,&scope(),clock(1000),fill()).unwrap();
    }
    let original = s;
    assert_eq!(settle(&p,&intent(&p,64),&mut s,&scope(),clock(1000),fill()),Err(Error::WindowCapacity));
    assert_eq!(s,original);
    settle(&p,&intent(&p,64),&mut s,&scope(),clock(1060),fill()).unwrap();
}

#[test]
fn cumulative_amount_overflow_is_rejected() {
    let mut p = policy(); p.limits.max_quote_per_trade = None;
    p.limits.rolling_quote.as_mut().unwrap().quote_limit = u64::MAX;
    let mut s = TraderState::new(&p,[8;32]).unwrap(); let mut i = intent(&p,0); let mut m = fill();
    i.amount_in = u64::MAX; m.input_debit = u64::MAX;
    settle(&p,&i,&mut s,&scope(),clock(1000),m).unwrap();
    let original = s;
    assert_eq!(settle(&p,&intent(&p,1),&mut s,&scope(),clock(1001),fill()),Err(Error::Overflow));
    assert_eq!(s,original);
}

#[test]
fn invalid_policy_limits_and_inactive_policy_are_rejected() {
    for variant in 0..5 { let mut p = policy();
        match variant { 0 => p.limits.max_quote_per_trade = Some(0),
            1 => p.limits.max_account_base = Some(0), 2 => p.limits.sell_cooldown_seconds = Some(0),
            3 => p.limits.rolling_quote.as_mut().unwrap().seconds = 0,
            _ => p.limits.rolling_quote.as_mut().unwrap().quote_limit = 0 }
        assert_eq!(p.validate(),Err(Error::InvalidPolicy));
    }
    let mut p = policy(); p.active = false;
    rejection(&p,intent(&p,0),scope(),clock(1000),fill(),Error::PolicyInactive);
}

#[test]
fn rust_and_javascript_policy_fingerprints_match_all_vectors() {
    let vectors = include_str!("../../fixtures/policy-vectors.tsv");
    for line in vectors.lines().filter(|l| !l.starts_with('#') && !l.is_empty()) {
        let fields: std::vec::Vec<_> = line.split('\t').collect();
        let flags: u8 = fields[0].parse().unwrap();
        let rev: u64 = fields[1].parse().unwrap();
        let mut p = policy(); p.revision = rev;
        p.limits.max_quote_per_trade = (flags & 1 != 0).then_some(100);
        p.limits.max_account_base = (flags & 2 != 0).then_some(1_000);
        p.limits.sell_cooldown_seconds = (flags & 4 != 0).then_some(30);
        p.limits.rolling_quote = (flags & 8 != 0).then_some(Window { seconds: 60, quote_limit: 100 });
        let got: std::string::String = p.fingerprint().iter().map(|b| std::format!("{b:02x}")).collect();
        assert_eq!(got,fields[2],"flags {flags}, revision {rev}");
        assert_eq!(p.canonical_bytes().len(),POLICY_BYTES);
    }
}
