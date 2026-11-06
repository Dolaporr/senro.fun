//! Local browser demonstration adapter. No RPC, signatures, or live token accounts.
//! Calls the actual reference Rust core compiled to WebAssembly.
use pump_next_route_guard::*;

fn code(e: Error) -> u32 {
    match e { Error::TradeSize => 1, Error::RollingVolume => 2, Error::SellCooldown => 3,
        Error::AccountBalance => 4, Error::InvalidPolicy | Error::InvalidBounds => 5,
        Error::PolicyChanged | Error::StateMismatch => 6, Error::DeadlineExpired => 7,
        Error::WindowCapacity => 8, Error::NonceMismatch => 9, _ => 10 }
}
fn scope() -> VerifiedScope {
    VerifiedScope { actor:[8;32],source_account:[9;32],destination_account:[10;32],
        base_mint:[3;32],quote_mint:[4;32],base_token_program:[5;32],quote_token_program:[6;32],venue_program:[7;32] }
}
fn apply(p:&Policy,s:&mut TraderState,q:u64,time:u64,side:Side,base_after:u64) -> Result<Receipt,Error> {
    let i=Intent { policy_id:p.id,policy_revision:p.revision,policy_fingerprint:p.fingerprint(),
        actor:[8;32],source_account:[9;32],destination_account:[10;32],side,
        nonce:s.next_nonce(),quoted_at_slot:100,deadline_slot:110,
        amount_in:if side==Side::Buy {q} else {100_000_000},
        min_out:if side==Side::Buy {1} else {q},max_protocol_fee_quote:0 };
    settle(p,&i,s,&scope(),Clock{slot:100,unix_seconds:time},MeasuredTrade {
        input_debit:i.amount_in,output_credit:if side==Side::Buy {100_000_000} else {q},
        base_account_balance_after:base_after,protocol_fee_quote:0 })
}

/// Scenarios: 0 trade, 1 boundary burst, 2 sell cooldown, 3 post-fill balance,
/// 4 stale policy, 5 expired intent. Zero optional limits mean disabled.
#[no_mangle]
pub extern "C" fn evaluate_case(cap:u64,rolling:u64,window:u64,cooldown:u64,account_cap:u64,amount:u64,scenario:u32) -> u32 {
    let p=Policy{id:[1;32],authority:[2;32],base_mint:[3;32],quote_mint:[4;32],
        base_token_program:[5;32],quote_token_program:[6;32],venue_program:[7;32],revision:1,active:true,
        max_quote_age_slots:10,limits:Limits {max_quote_per_trade:(cap>0).then_some(cap),
        max_account_base:(account_cap>0).then_some(account_cap),sell_cooldown_seconds:(cooldown>0).then_some(cooldown),
        rolling_quote:(rolling>0).then_some(Window{seconds:window,quote_limit:rolling})}};
    let result=(|| -> Result<(),Error> {
        let mut s=TraderState::new(&p,[8;32])?;
        match scenario {
            0 => {apply(&p,&mut s,amount,1000,Side::Buy,0)?;},
            1 => {
                if rolling==0 || window<2 {return Err(Error::InvalidPolicy);}
                apply(&p,&mut s,1,1000,Side::Buy,0)?;
                let mut remaining=rolling-1;
                let mut count=0;
                while remaining>0 {
                    let chunk=remaining.min(if cap>0 {cap} else {remaining});
                    apply(&p,&mut s,chunk,1000+window-1,Side::Buy,0)?;
                    remaining-=chunk;count+=1;
                    if count>MAX_WINDOW_EVENTS {return Err(Error::WindowCapacity);}
                }
                apply(&p,&mut s,amount,1000+window,Side::Buy,0)?;
            },
            2 => { apply(&p,&mut s,amount,1000,Side::Sell,0)?;
                apply(&p,&mut s,amount,1010,Side::Sell,0)?; },
            3 => {apply(&p,&mut s,amount,1000,Side::Buy,account_cap.checked_add(1).ok_or(Error::Overflow)?)?;},
            4 | 5 => {
                let mut i=Intent {policy_id:p.id,policy_revision:p.revision,policy_fingerprint:p.fingerprint(),actor:[8;32],
                    source_account:[9;32],destination_account:[10;32],side:Side::Buy,nonce:0,
                    quoted_at_slot:100,deadline_slot:110,amount_in:amount,min_out:1,max_protocol_fee_quote:0};
                if scenario==4 {i.policy_fingerprint[0]^=1;}
                preflight(&p,&i,&s,&scope(),Clock{slot:if scenario==5 {111} else {100},unix_seconds:1000})?;
            },
            _ => return Err(Error::InvalidPolicy)
        } Ok(())
    })();
    result.map_or_else(code, |_|0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn browser_exercises_the_rust_guards() {
        assert_eq!(evaluate_case(200,800,60,30,0,100,0),0);
        assert_eq!(evaluate_case(200,800,60,30,0,201,0),1);
        assert_eq!(evaluate_case(200,800,60,30,0,100,1),2);
        assert_eq!(evaluate_case(200,800,60,30,0,100,2),3);
        assert_eq!(evaluate_case(200,800,60,30,1000,100,3),4);
        assert_eq!(evaluate_case(200,800,60,30,0,100,4),6);
        assert_eq!(evaluate_case(200,800,60,30,0,100,5),7);
    }
}
