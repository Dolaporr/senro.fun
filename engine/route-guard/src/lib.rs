//! Pump-focused reference core. This is NOT a deployed Solana program.
//! An adapter must authenticate Signer/PDA ownership, take trustworthy balance snapshots,
//! exclude SOL account-creation rent, perform the venue CPI, and commit in one transaction.
//! No hook can change venue-wide rules or prevent direct Pump trading.
#![no_std]

use sha2::{Digest, Sha256};

pub type Key = [u8; 32];
pub const MAX_WINDOW_EVENTS: usize = 64;
pub const POLICY_BYTES: usize = 290;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidPolicy, PolicyInactive, PolicyChanged, ScopeMismatch, StateMismatch,
    QuoteFromFuture, QuoteTooOld, DeadlineExpired, InvalidBounds, NonceMismatch,
    Overflow, ClockWentBackwards, InputMismatch, Slippage, FeeCap,
    TradeSize, AccountBalance, SellCooldown, RollingVolume, WindowCapacity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side { Buy, Sell }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window { pub seconds: u64, pub quote_limit: u64 }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Limits {
    pub max_quote_per_trade: Option<u64>,
    /// One bound token account; never advertised as all wallet holdings.
    pub max_account_base: Option<u64>,
    pub sell_cooldown_seconds: Option<u64>,
    pub rolling_quote: Option<Window>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    pub id: Key,
    pub authority: Key,
    pub base_mint: Key,
    pub quote_mint: Key,
    pub base_token_program: Key,
    pub quote_token_program: Key,
    pub venue_program: Key,
    pub revision: u64,
    pub active: bool,
    pub max_quote_age_slots: u64,
    pub limits: Limits,
}

impl Policy {
    pub fn validate(&self) -> Result<(), Error> {
        let l = self.limits;
        if self.id == [0; 32] || self.authority == [0; 32]
            || self.base_mint == [0; 32] || self.quote_mint == [0; 32]
            || self.base_mint == self.quote_mint || self.venue_program == [0; 32]
            || self.base_token_program == [0; 32] || self.quote_token_program == [0; 32]
            || self.revision == 0 || self.max_quote_age_slots == 0
            || l.max_quote_per_trade == Some(0) || l.max_account_base == Some(0)
            || l.sell_cooldown_seconds == Some(0)
            || l.rolling_quote.is_some_and(|w| w.seconds == 0 || w.quote_limit == 0)
        { return Err(Error::InvalidPolicy); }
        Ok(())
    }

    /// Fixed, domain-separated wire format. Optional limits have explicit presence bits.
    /// Runtime counters and balances are intentionally excluded from this fingerprint.
    pub fn canonical_bytes(&self) -> [u8; POLICY_BYTES] {
        let mut b = [0u8; POLICY_BYTES];
        b[..8].copy_from_slice(b"HKNXTP01");
        let mut offset = 8;
        for k in [self.id, self.authority, self.base_mint, self.quote_mint,
            self.base_token_program, self.quote_token_program, self.venue_program] {
            b[offset..offset+32].copy_from_slice(&k);
            offset += 32;
        }
        b[offset..offset+8].copy_from_slice(&self.revision.to_le_bytes());
        offset += 8;
        b[offset] = self.active as u8;
        offset += 1;
        let l = self.limits;
        b[offset] = (l.max_quote_per_trade.is_some() as u8)
            | ((l.max_account_base.is_some() as u8) << 1)
            | ((l.sell_cooldown_seconds.is_some() as u8) << 2)
            | ((l.rolling_quote.is_some() as u8) << 3);
        offset += 1;
        for value in [l.max_quote_per_trade.unwrap_or(0), l.max_account_base.unwrap_or(0),
            l.sell_cooldown_seconds.unwrap_or(0), l.rolling_quote.map_or(0, |w| w.quote_limit),
            l.rolling_quote.map_or(0, |w| w.seconds), self.max_quote_age_slots] {
            b[offset..offset+8].copy_from_slice(&value.to_le_bytes());
            offset += 8;
        }
        b
    }

    pub fn fingerprint(&self) -> Key { Sha256::digest(self.canonical_bytes()).into() }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Intent {
    pub policy_id: Key,
    pub policy_revision: u64,
    pub policy_fingerprint: Key,
    pub actor: Key,
    pub source_account: Key,
    pub destination_account: Key,
    pub side: Side,
    pub nonce: u64,
    pub quoted_at_slot: u64,
    pub deadline_slot: u64,
    /// Exact input, in the source asset's raw units; never inferred from an estimate.
    pub amount_in: u64,
    pub min_out: u64,
    pub max_protocol_fee_quote: u64,
}

/// Values established by the on-chain adapter, NOT accepted from an untrusted client.
#[derive(Clone, Copy, Debug)]
pub struct VerifiedScope {
    pub actor: Key,
    pub source_account: Key,
    pub destination_account: Key,
    pub base_mint: Key,
    pub quote_mint: Key,
    pub base_token_program: Key,
    pub quote_token_program: Key,
    pub venue_program: Key,
}

#[derive(Clone, Copy, Debug)]
pub struct Clock { pub slot: u64, pub unix_seconds: u64 }

/// Observed around the CPI by the adapter. Input debit includes the protocol fee where
/// it is paid in the input asset. Native SOL rent must be separately normalized.
#[derive(Clone, Copy, Debug)]
pub struct MeasuredTrade {
    pub input_debit: u64,
    pub output_credit: u64,
    pub base_account_balance_after: u64,
    pub protocol_fee_quote: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Event { time: u64, quote: u64 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TraderState {
    policy_id: Key,
    fingerprint: Key,
    actor: Key,
    next_nonce: u64,
    last_time: Option<u64>,
    last_sell_time: Option<u64>,
    events: [Event; MAX_WINDOW_EVENTS],
    event_count: usize,
}

impl TraderState {
    pub fn new(policy: &Policy, actor: Key) -> Result<Self, Error> {
        policy.validate()?;
        if actor == [0; 32] { return Err(Error::ScopeMismatch); }
        Ok(Self { policy_id: policy.id, fingerprint: policy.fingerprint(), actor,
            next_nonce: 0, last_time: None, last_sell_time: None,
            events: [Event::default(); MAX_WINDOW_EVENTS], event_count: 0 })
    }
    pub fn next_nonce(&self) -> u64 { self.next_nonce }
}

/// MUST run before the venue CPI. No silent zero min-out or stale-policy fallback.
pub fn preflight(policy: &Policy, intent: &Intent, state: &TraderState,
    scope: &VerifiedScope, clock: Clock) -> Result<(), Error> {
    policy.validate()?;
    if !policy.active { return Err(Error::PolicyInactive); }
    let fingerprint = policy.fingerprint();
    if intent.policy_id != policy.id || intent.policy_revision != policy.revision
        || intent.policy_fingerprint != fingerprint { return Err(Error::PolicyChanged); }
    if state.policy_id != policy.id || state.fingerprint != fingerprint || state.actor != intent.actor
        { return Err(Error::StateMismatch); }
    if intent.actor != scope.actor || intent.source_account != scope.source_account
        || intent.destination_account != scope.destination_account
        || scope.source_account == scope.destination_account
        || scope.source_account == [0; 32] || scope.destination_account == [0; 32]
        || policy.base_mint != scope.base_mint || policy.quote_mint != scope.quote_mint
        || policy.base_token_program != scope.base_token_program
        || policy.quote_token_program != scope.quote_token_program
        || policy.venue_program != scope.venue_program { return Err(Error::ScopeMismatch); }
    if intent.amount_in == 0 || intent.min_out == 0 { return Err(Error::InvalidBounds); }
    if clock.slot > intent.deadline_slot { return Err(Error::DeadlineExpired); }
    if intent.quoted_at_slot > clock.slot { return Err(Error::QuoteFromFuture); }
    if clock.slot - intent.quoted_at_slot > policy.max_quote_age_slots { return Err(Error::QuoteTooOld); }
    if state.next_nonce != intent.nonce { return Err(Error::NonceMismatch); }
    if state.last_time.is_some_and(|t| clock.unix_seconds < t) { return Err(Error::ClockWentBackwards); }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub policy_fingerprint: Key,
    pub policy_revision: u64,
    pub nonce: u64,
    pub slot: u64,
    pub quote_volume: u64,
    pub input_debit: u64,
    pub output_credit: u64,
    pub protocol_fee_quote: u64,
    /// Explicitly RouterOnly. This receipt is local until committed by an on-chain adapter.
    pub router_only: bool,
}

/// MUST run after the CPI in the same transaction. All checks execute exactly once;
/// callbacks cannot be selected to omit a postcondition or double-count an observation.
/// State is committed only after every check passes. CPI rollback remains the adapter's job.
pub fn settle(policy: &Policy, intent: &Intent, state: &mut TraderState,
    scope: &VerifiedScope, clock: Clock, measured: MeasuredTrade) -> Result<Receipt, Error> {
    preflight(policy, intent, state, scope, clock)?;
    if measured.input_debit != intent.amount_in { return Err(Error::InputMismatch); }
    if measured.output_credit < intent.min_out { return Err(Error::Slippage); }
    if measured.protocol_fee_quote > intent.max_protocol_fee_quote { return Err(Error::FeeCap); }
    let quote = match intent.side { Side::Buy => measured.input_debit, Side::Sell => measured.output_credit };
    let l = policy.limits;
    if l.max_quote_per_trade.is_some_and(|cap| quote > cap) { return Err(Error::TradeSize); }
    if intent.side == Side::Buy && l.max_account_base.is_some_and(|cap| measured.base_account_balance_after > cap)
        { return Err(Error::AccountBalance); }
    if intent.side == Side::Sell {
        if let (Some(delay), Some(last)) = (l.sell_cooldown_seconds, state.last_sell_time) {
            if clock.unix_seconds - last < delay { return Err(Error::SellCooldown); }
        }
    }
    let mut next = *state;
    if let Some(window) = l.rolling_quote {
        let mut count = 0;
        let mut volume = 0u64;
        for e in state.events[..state.event_count].iter().copied() {
            if clock.unix_seconds - e.time < window.seconds {
                volume = volume.checked_add(e.quote).ok_or(Error::Overflow)?;
                next.events[count] = e;
                count += 1;
            }
        }
        volume = volume.checked_add(quote).ok_or(Error::Overflow)?;
        if volume > window.quote_limit { return Err(Error::RollingVolume); }
        if count == MAX_WINDOW_EVENTS { return Err(Error::WindowCapacity); }
        next.events[count] = Event { time: clock.unix_seconds, quote };
        next.event_count = count + 1;
    }
    if intent.side == Side::Sell { next.last_sell_time = Some(clock.unix_seconds); }
    next.last_time = Some(clock.unix_seconds);
    next.next_nonce = next.next_nonce.checked_add(1).ok_or(Error::Overflow)?;
    *state = next;
    Ok(Receipt { policy_fingerprint: policy.fingerprint(), policy_revision: policy.revision,
        nonce: intent.nonce, slot: clock.slot, quote_volume: quote, input_debit: measured.input_debit,
        output_credit: measured.output_credit, protocol_fee_quote: measured.protocol_fee_quote,
        router_only: true })
}
