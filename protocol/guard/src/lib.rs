//! SENRO PumpSwap SOL-buy guard. Candidate identity only; deployment is not implied.
use pump_adapter::{
    accounts::amm_v2 as a,
    ix::{amm_v2_data, Mode},
    layout::{amm_buyback_fee_recipients, PoolView, TokenAccountView},
    pda, NATIVE_MINT, PUMP_AMM_PROGRAM_ID, PUMP_FEES_PROGRAM_ID, SYSTEM_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::hashv,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

// Candidate identity: E1e4396v1CB8ttJ8FoBLN23Acfi25auiMabqpPjBgAwU
pub const ID: Pubkey = Pubkey::new_from_array([
    193, 81, 211, 69, 137, 184, 123, 227, 150, 157, 191, 173, 10, 105, 16, 241,
    143, 100, 196, 19, 188, 102, 252, 216, 17, 94, 89, 186, 228, 179, 188, 147,
]);
pub const POLICY_LEN: usize = 8 + 32 * 4 + 8 * 3 + 2;
pub const MAX_VALIDITY_SLOTS: u64 = 150;
const MAGIC: &[u8; 8] = b"SENROP01";
#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    InvalidInstruction = 1,
    Accounts,
    Signature,
    Policy,
    Venue,
    Token,
    UnsupportedExtensions,
    Inactive,
    RulesChanged,
    Expired,
    Replay,
    TradeCap,
    MinimumOutput,
    UnexpectedDebit,
    Arithmetic,
    Revision,
}
fn fail(e: Error) -> ProgramError {
    ProgramError::Custom(e as u32)
}
fn check(ok: bool, e: Error) -> ProgramResult {
    if ok {
        Ok(())
    } else {
        Err(fail(e))
    }
}
fn num(d: &[u8], at: usize) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(
        d.get(at..at + 8)
            .ok_or(fail(Error::InvalidInstruction))?
            .try_into()
            .unwrap(),
    ))
}
fn key(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().unwrap())
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub token_program: Pubkey,
    pub max_quote: u64,
    pub revision: u64,
    pub nonce: u64,
    pub bump: u8,
    pub active: bool,
}
impl Policy {
    pub fn decode(d: &[u8]) -> Result<Self, ProgramError> {
        check(
            d.len() == POLICY_LEN && d.get(..8) == Some(MAGIC),
            Error::Policy,
        )?;
        check(d[161] <= 1, Error::Policy)?;
        Ok(Self {
            wallet: key(d, 8),
            mint: key(d, 40),
            pool: key(d, 72),
            token_program: key(d, 104),
            max_quote: num(d, 136)?,
            revision: num(d, 144)?,
            nonce: num(d, 152)?,
            bump: d[160],
            active: d[161] != 0,
        })
    }
    pub fn encode(&self, d: &mut [u8]) {
        d[..8].copy_from_slice(MAGIC);
        for (at, k) in [
            (8, self.wallet),
            (40, self.mint),
            (72, self.pool),
            (104, self.token_program),
        ] {
            d[at..at + 32].copy_from_slice(k.as_ref());
        }
        d[136..144].copy_from_slice(&self.max_quote.to_le_bytes());
        d[144..152].copy_from_slice(&self.revision.to_le_bytes());
        d[152..160].copy_from_slice(&self.nonce.to_le_bytes());
        d[160] = self.bump;
        d[161] = self.active as u8;
    }
    /// Runtime nonce intentionally excluded. Program, venue, wallet, pair, revision and limits are bound.
    pub fn fingerprint(&self, program: &Pubkey) -> [u8; 32] {
        hashv(&[
            b"SENRO-POLICY-V1",
            program.as_ref(),
            PUMP_AMM_PROGRAM_ID.as_ref(),
            NATIVE_MINT.as_ref(),
            self.wallet.as_ref(),
            self.mint.as_ref(),
            self.pool.as_ref(),
            self.token_program.as_ref(),
            &self.max_quote.to_le_bytes(),
            &self.revision.to_le_bytes(),
            &[self.active as u8],
        ])
        .to_bytes()
    }
}
pub fn policy_address(
    program: &Pubkey,
    wallet: &Pubkey,
    mint: &Pubkey,
    pool: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"policy", wallet.as_ref(), mint.as_ref(), pool.as_ref()],
        program,
    )
}
fn load(program: &Pubkey, ai: &AccountInfo) -> Result<Policy, ProgramError> {
    check(ai.owner == program && ai.is_writable, Error::Policy)?;
    let p = Policy::decode(&ai.try_borrow_data()?)?;
    let (addr, bump) = policy_address(program, &p.wallet, &p.mint, &p.pool);
    check(*ai.key == addr && p.bump == bump, Error::Policy)?;
    Ok(p)
}
fn wallet(ai: &AccountInfo) -> ProgramResult {
    check(ai.is_signer, Error::Signature)?;
    check(
        ai.is_writable && *ai.owner == SYSTEM_PROGRAM_ID && ai.data_is_empty(),
        Error::Accounts,
    )
}
fn extensions(d: &[u8], base: usize, account_type: u8, allowed: &[u16]) -> ProgramResult {
    if d.len() == base {
        return Ok(());
    }
    check(d.len() >= 166 && d[165] == account_type, Error::Token)?;
    if base == 82 {
        check(d[82..165].iter().all(|x| *x == 0), Error::Token)?;
    }
    let mut at = 166;
    while at < d.len() {
        if d[at..].iter().all(|x| *x == 0) {
            break;
        }
        check(d.len() - at >= 4, Error::Token)?;
        let kind = u16::from_le_bytes(d[at..at + 2].try_into().unwrap());
        let len = u16::from_le_bytes(d[at + 2..at + 4].try_into().unwrap()) as usize;
        at += 4;
        check(allowed.contains(&kind), Error::UnsupportedExtensions)?;
        at = at.checked_add(len).ok_or(fail(Error::Arithmetic))?;
        check(at <= d.len(), Error::Token)?;
    }
    Ok(())
}
fn mint(ai: &AccountInfo, program: &Pubkey) -> ProgramResult {
    check(ai.owner == program, Error::Token)?;
    check(
        *program == TOKEN_PROGRAM_ID || *program == TOKEN_2022_PROGRAM_ID,
        Error::Token,
    )?;
    let d = ai.try_borrow_data()?;
    check(d.len() >= 82 && d[45] == 1, Error::Token)?;
    if *program == TOKEN_PROGRAM_ID {
        check(d.len() == 82, Error::Token)
    } else {
        extensions(&d, 82, 1, &[18, 19])
    }
}
fn token(
    ai: &AccountInfo,
    program: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
) -> Result<u64, ProgramError> {
    check(ai.owner == program, Error::Token)?;
    let d = ai.try_borrow_data()?;
    check(d.len() >= 165 && d[108] == 1, Error::Token)?;
    check(d[72..76] == [0; 4] && d[129..133] == [0; 4], Error::Token)?;
    if *program == TOKEN_PROGRAM_ID {
        check(d.len() == 165, Error::Token)?;
    } else {
        extensions(&d, 165, 2, &[7])?;
    }
    let v = TokenAccountView::parse(&d).map_err(|_| fail(Error::Token))?;
    check(v.owner == *owner && v.mint == *mint, Error::Token)?;
    Ok(v.amount)
}
fn pool(ai: &AccountInfo, mint: &Pubkey) -> Result<PoolView, ProgramError> {
    check(*ai.owner == PUMP_AMM_PROGRAM_ID, Error::Venue)?;
    let p = PoolView::parse(&ai.try_borrow_data()?).map_err(|_| fail(Error::Venue))?;
    check(
        p.base_mint == *mint
            && p.quote_mint == NATIVE_MINT
            && p.index == 0
            && p.creator == pda::pump::pool_authority(mint)
            && *ai.key == pda::amm::canonical_pool(mint, &NATIVE_MINT)
            && !p.is_cashback,
        Error::Venue,
    )?;
    Ok(p)
}
fn create(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    check(accounts.len() == 6 && data.len() == 9, Error::Accounts)?;
    let [policy, user, base, pool_ai, base_program, system] = accounts else {
        unreachable!()
    };
    wallet(user)?;
    check(
        system.key == &SYSTEM_PROGRAM_ID && system.executable && base_program.executable,
        Error::Accounts,
    )?;
    mint(base, base_program.key)?;
    pool(pool_ai, base.key)?;
    let cap = num(data, 1)?;
    check(cap > 0, Error::TradeCap)?;
    let (addr, bump) = policy_address(program, user.key, base.key, pool_ai.key);
    check(
        policy.is_writable
            && *policy.key == addr
            && *policy.owner == SYSTEM_PROGRAM_ID
            && policy.data_is_empty(),
        Error::Policy,
    )?;
    let rent = Rent::get()?.minimum_balance(POLICY_LEN);
    let seeds: &[&[u8]] = &[
        b"policy",
        user.key.as_ref(),
        base.key.as_ref(),
        pool_ai.key.as_ref(),
        &[bump],
    ];
    // Allocate a prefunded PDA too: anyone sending dust must not be able to squat the policy address.
    if policy.lamports() < rent {
        invoke(
            &system_instruction::transfer(user.key, policy.key, rent - policy.lamports()),
            &[user.clone(), policy.clone(), system.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(policy.key, POLICY_LEN as u64),
        &[policy.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(policy.key, program),
        &[policy.clone(), system.clone()],
        &[seeds],
    )?;
    Policy {
        wallet: *user.key,
        mint: *base.key,
        pool: *pool_ai.key,
        token_program: *base_program.key,
        max_quote: cap,
        revision: 1,
        nonce: 0,
        bump,
        active: true,
    }
    .encode(&mut policy.try_borrow_mut_data()?);
    Ok(())
}
fn update(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    check(accounts.len() == 2 && data.len() == 18, Error::Accounts)?;
    wallet(&accounts[1])?;
    let mut p = load(program, &accounts[0])?;
    check(p.wallet == *accounts[1].key, Error::Signature)?;
    check(num(data, 1)? == p.revision, Error::Revision)?;
    let cap = num(data, 9)?;
    check(cap > 0 && data[17] <= 1, Error::TradeCap)?;
    p.revision = p.revision.checked_add(1).ok_or(fail(Error::Arithmetic))?;
    p.max_quote = cap;
    p.active = data[17] == 1;
    p.encode(&mut accounts[0].try_borrow_mut_data()?);
    Ok(())
}
fn validate_venue(p: &Policy, ac: &[AccountInfo]) -> ProgramResult {
    check(ac.len() == a::LEN, Error::Accounts)?;
    wallet(&ac[a::USER])?;
    check(*ac[a::USER].key == p.wallet, Error::Signature)?;
    let view = pool(&ac[a::POOL], &p.mint)?;
    check(*ac[a::POOL].key == p.pool, Error::Venue)?;
    let expected = [
        p.pool,
        p.wallet,
        pda::amm::global_config(),
        p.mint,
        NATIVE_MINT,
        pda::associated_token(&p.wallet, &p.token_program, &p.mint),
        pda::associated_token(&p.wallet, &TOKEN_PROGRAM_ID, &NATIVE_MINT),
        view.pool_base_token_account,
        view.pool_quote_token_account,
        p.token_program,
        TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        pda::amm::user_volume_accumulator(&p.wallet),
        pda::amm::fee_config(),
        *ac[a::BUYBACK_FEE_RECIPIENT].key,
        pda::amm::event_authority(),
        PUMP_AMM_PROGRAM_ID,
    ];
    for (i, ai) in ac.iter().enumerate() {
        check(*ai.key == expected[i], Error::Accounts)?;
        let (s, w) = a::META[i];
        check(!s || ai.is_signer, Error::Signature)?;
        check(!w || ai.is_writable, Error::Accounts)?;
    }
    for i in [
        a::PROGRAM,
        a::BASE_TOKEN_PROGRAM,
        a::QUOTE_TOKEN_PROGRAM,
        a::SYSTEM_PROGRAM,
    ] {
        check(ac[i].executable, Error::Accounts)?;
    }
    for (i, ai) in ac.iter().enumerate().filter(|(i, _)| a::META[*i].1) {
        for (j, other) in ac.iter().enumerate().take(i) {
            if a::META[j].1 {
                check(ai.key != other.key, Error::Accounts)?;
            }
        }
    }
    mint(&ac[a::BASE_MINT], &p.token_program)?;
    mint(&ac[a::QUOTE_MINT], &TOKEN_PROGRAM_ID)?;
    token(
        &ac[a::USER_BASE_TOKEN_ACCOUNT],
        &p.token_program,
        &p.wallet,
        &p.mint,
    )?;
    token(
        &ac[a::USER_QUOTE_TOKEN_ACCOUNT],
        &TOKEN_PROGRAM_ID,
        &p.wallet,
        &NATIVE_MINT,
    )?;
    token(
        &ac[a::POOL_BASE_TOKEN_ACCOUNT],
        &p.token_program,
        &p.pool,
        &p.mint,
    )?;
    token(
        &ac[a::POOL_QUOTE_TOKEN_ACCOUNT],
        &TOKEN_PROGRAM_ID,
        &p.pool,
        &NATIVE_MINT,
    )?;
    check(
        *ac[a::GLOBAL_CONFIG].owner == PUMP_AMM_PROGRAM_ID
            && *ac[a::FEE_CONFIG].owner == PUMP_FEES_PROGRAM_ID,
        Error::Venue,
    )?;
    let recipients = amm_buyback_fee_recipients(&ac[a::GLOBAL_CONFIG].try_borrow_data()?)
        .map_err(|_| fail(Error::Venue))?;
    check(
        recipients.iter().any(|r| {
            *r != Pubkey::default()
                && pda::associated_token(r, &TOKEN_PROGRAM_ID, &NATIVE_MINT)
                    == *ac[a::BUYBACK_FEE_RECIPIENT].key
        }),
        Error::Venue,
    )?;
    Ok(())
}
/// Wire: tag, fingerprint[32], nonce, deadline_slot, exact_quote_in, min_base_out, max_native_debit.
fn route(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    check(
        accounts.len() == 1 + a::LEN && data.len() == 73,
        Error::Accounts,
    )?;
    let mut p = load(program, &accounts[0])?;
    let ac = &accounts[1..];
    validate_venue(&p, ac)?;
    check(p.active, Error::Inactive)?;
    check(data[1..33] == p.fingerprint(program), Error::RulesChanged)?;
    check(num(data, 33)? == p.nonce, Error::Replay)?;
    let deadline = num(data, 41)?;
    let slot = Clock::get()?.slot;
    check(
        deadline >= slot && deadline - slot <= MAX_VALIDITY_SLOTS,
        Error::Expired,
    )?;
    let amount = num(data, 49)?;
    let min_out = num(data, 57)?;
    let max_native = num(data, 65)?;
    check(amount > 0 && amount <= p.max_quote, Error::TradeCap)?;
    check(min_out > 0, Error::MinimumOutput)?;
    let before_base = token(
        &ac[a::USER_BASE_TOKEN_ACCOUNT],
        &p.token_program,
        &p.wallet,
        &p.mint,
    )?;
    let before_quote = token(
        &ac[a::USER_QUOTE_TOKEN_ACCOUNT],
        &TOKEN_PROGRAM_ID,
        &p.wallet,
        &NATIVE_MINT,
    )?;
    let before_native = ac[a::USER].lamports();
    check(before_quote >= amount, Error::UnexpectedDebit)?;
    let ix = solana_program::instruction::Instruction {
        program_id: PUMP_AMM_PROGRAM_ID,
        accounts: ac
            .iter()
            .zip(a::META)
            .map(|(ai, (s, w))| {
                if w {
                    solana_program::instruction::AccountMeta::new(*ai.key, s)
                } else {
                    solana_program::instruction::AccountMeta::new_readonly(*ai.key, s)
                }
            })
            .collect(),
        data: amm_v2_data(Mode::ExactQuoteIn, amount, min_out),
    };
    invoke(&ix, ac)?;
    let after_base = token(
        &ac[a::USER_BASE_TOKEN_ACCOUNT],
        &p.token_program,
        &p.wallet,
        &p.mint,
    )?;
    let after_quote = token(
        &ac[a::USER_QUOTE_TOKEN_ACCOUNT],
        &TOKEN_PROGRAM_ID,
        &p.wallet,
        &NATIVE_MINT,
    )?;
    let spent = before_quote
        .checked_sub(after_quote)
        .ok_or(fail(Error::UnexpectedDebit))?;
    check(
        spent == amount && spent <= p.max_quote,
        Error::UnexpectedDebit,
    )?;
    check(
        after_base
            .checked_sub(before_base)
            .ok_or(fail(Error::MinimumOutput))?
            >= min_out,
        Error::MinimumOutput,
    )?;
    check(
        before_native.saturating_sub(ac[a::USER].lamports()) <= max_native,
        Error::UnexpectedDebit,
    )?;
    p.nonce = p.nonce.checked_add(1).ok_or(fail(Error::Arithmetic))?;
    p.encode(&mut accounts[0].try_borrow_mut_data()?);
    Ok(())
}
pub fn process_instruction(
    program: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    check(*program == ID, Error::Policy)?;
    match data.first() {
        Some(0) => create(program, accounts, data),
        Some(1) => update(program, accounts, data),
        Some(2) => route(program, accounts, data),
        _ => Err(fail(Error::InvalidInstruction)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_matches_client_and_excludes_nonce() {
        let mut p = Policy {
            wallet: Pubkey::new_from_array([2; 32]),
            mint: Pubkey::new_from_array([3; 32]),
            pool: Pubkey::new_from_array([4; 32]),
            token_program: Pubkey::new_from_array([5; 32]),
            max_quote: 2_000_000,
            revision: 1,
            nonce: 0,
            bump: 0,
            active: true,
        };
        let legacy_expected = [
            0x7b, 0x06, 0x77, 0xa3, 0xa4, 0x9f, 0x20, 0x45, 0xb9, 0x91, 0xc7, 0xef, 0xba, 0xab,
            0xe7, 0xa6, 0xd3, 0x1c, 0x6d, 0x6c, 0x5f, 0x83, 0x0b, 0xf0, 0xf4, 0xe0, 0x7e, 0x2a,
            0xf3, 0x11, 0x40, 0x81,
        ];
        let expected = [
            0x20, 0x67, 0x4d, 0x5a, 0x00, 0x35, 0x4e, 0x0b, 0xfd, 0xbf, 0xbe, 0x39, 0xb5, 0xfd, 0xf4, 0x2b,
            0x6e, 0x0e, 0xca, 0x98, 0x9d, 0xd5, 0x61, 0x7c, 0x39, 0x8a, 0x1d, 0x54, 0x8c, 0x8e, 0xb7, 0xf6,
        ];
        assert_eq!(p.fingerprint(&Pubkey::new_from_array([83; 32])), legacy_expected);
        assert_ne!(expected, legacy_expected);
        assert_eq!(p.fingerprint(&ID), expected);
        p.nonce = 9;
        assert_eq!(p.fingerprint(&ID), expected);
        p.revision = 2;
        assert_ne!(p.fingerprint(&ID), expected);
    }
    #[test]
    fn policy_roundtrip_has_fixed_layout() {
        let p = Policy {
            wallet: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            pool: Pubkey::new_unique(),
            token_program: TOKEN_PROGRAM_ID,
            max_quote: 4,
            revision: 8,
            nonce: 9,
            bump: 250,
            active: true,
        };
        let mut d = [0; POLICY_LEN];
        p.encode(&mut d);
        assert_eq!(Policy::decode(&d).unwrap(), p);
        d[161] = 2;
        assert_eq!(Policy::decode(&d).unwrap_err(), fail(Error::Policy));
    }
    #[test]
    fn extension_hooks_and_transfer_fees_fail_closed() {
        let mut d = vec![0; 170];
        d[165] = 1;
        d[166..168].copy_from_slice(&14u16.to_le_bytes());
        assert_eq!(
            extensions(&d, 82, 1, &[18, 19]),
            Err(fail(Error::UnsupportedExtensions))
        );
        d[166..168].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(
            extensions(&d, 82, 1, &[18, 19]),
            Err(fail(Error::UnsupportedExtensions))
        );
        d[166..168].copy_from_slice(&18u16.to_le_bytes());
        assert!(extensions(&d, 82, 1, &[18, 19]).is_ok());
    }
}
