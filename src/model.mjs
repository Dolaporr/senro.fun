import { parseAmount, U64_MAX, u64 } from './policy-client.mjs';
export const DEFAULT_CONFIG = Object.freeze({cap:'0.20',rolling:'0.80',minutes:'60',cooldown:'30',account:'1000000',
  capOn:true,rollingOn:true,cooldownOn:true,accountOn:false,quote:'SOL',token:'WIF'});
export const QUOTES={SOL:{decimals:9,label:'SOL'},USDC:{decimals:6,label:'USDC'}};
export function quantities(c) {
  const d=QUOTES[c.quote]?.decimals;
  if(d===undefined)throw new Error('Choose a supported quote asset.');
  const positive=(s,n)=>{const v=parseAmount(s,n);if(v===0n)throw new Error('Enabled limits must be above zero.');return v;};
  const integer=s=>{if(!/^\d+$/.test(s))throw new Error('Time limits use whole numbers.');return positive(s,0);};
  return {cap:c.capOn?positive(c.cap,d):0n,rolling:c.rollingOn?positive(c.rolling,d):0n,
    window:c.rollingOn?u64(integer(c.minutes)*60n+1000n,'Time window')-1000n:60n,cooldown:c.cooldownOn?integer(c.cooldown):0n,
    account:c.accountOn?positive(c.account,6):0n,decimals:d};
}
export function makePolicy(c,revision) {
  const q=quantities(c);return {id:new Uint8Array(32).fill(1),authority:new Uint8Array(32).fill(2),
    baseMint:new Uint8Array(32).fill(c.token==='BONK'?11:3),quoteMint:new Uint8Array(32).fill(c.quote==='USDC'?12:4),
    baseTokenProgram:new Uint8Array(32).fill(5),quoteTokenProgram:new Uint8Array(32).fill(6),
    venueProgram:new Uint8Array(32).fill(7),revision:BigInt(revision),active:true,maxQuoteAgeSlots:10n,
    limits:{...(q.cap>0n?{maxQuotePerTrade:q.cap}:{}),...(q.rolling>0n?{rollingQuote:{limit:q.rolling,seconds:q.window}}:{}),
      ...(q.cooldown>0n?{sellCooldownSeconds:q.cooldown}:{}),...(q.account>0n?{maxAccountBase:q.account}:{})}};
}
export function evaluate(engine,c,amount,scenario=0){const q=quantities(c);return engine.evaluate_case(q.cap,q.rolling,q.window,q.cooldown,q.account,amount,scenario);}
export const REASONS={0:'Within the configured limits.',1:'Above the per-trade quote cap.',2:'Recent routed volume still counts inside the rolling window.',
  3:'The sell cooldown has not elapsed.',4:'Observed post-trade balance exceeds the account cap.',5:'This configuration needs valid positive bounds.',
  6:'The reviewed rules differ from the execution rules.',7:'The signed slot deadline has expired.',8:'The local history capacity is full. It fails closed.',9:'This intent was already consumed.',10:'A required guard rejected the operation.'};
export function makeCases(engine,c){
  const q=quantities(c),unit=10n**BigInt(q.decimals);
  let small=q.cap>0n?q.cap/2n:unit/10n;
  if(q.rolling>0n&&small>q.rolling/4n)small=q.rolling/4n;
  if(small<1n)small=1n;
  const cases=[{key:'normal',name:'Inside the limits',detail:'A single routed trade using synthetic balances.',amount:small,scenario:0,expected:0}];
  if(c.capOn&&q.cap<U64_MAX)cases.push({key:'size',name:'Above the trade cap',detail:'A synthetic fill above the configured quote cap.',amount:q.cap+q.cap/4n+1n>U64_MAX?U64_MAX:q.cap+q.cap/4n+1n,scenario:0,expected:1});
  if(c.rollingOn){
    const chunks=q.rolling>1n?(q.cap>0n?(q.rolling-1n+q.cap-1n)/q.cap:1n):0n;
    const full=chunks+1n>64n;
    cases.push({key:'window',name:full?'History reaches capacity':'Across the window boundary',detail:full?'This draft needs more than 64 live observations to fill the window. The core rejects new history instead of dropping existing volume.':'The first fill expires; the remaining fills still count. A one-unit trade may fit exactly at the limit.',amount:small,scenario:1,expected:full?8:small>1n?2:0});
  }
  if(c.cooldownOn)cases.push({key:'cooldown',name:'A second sell after 10s',detail:'Two synthetic sells with a ten-second gap.',amount:small,scenario:2,expected:q.cooldown>10n?3:q.rolling>0n&&small*2n>q.rolling?2:0});
  if(c.accountOn&&q.account<U64_MAX)cases.push({key:'balance',name:'A fill above the balance cap',detail:'The observed post-trade account balance exceeds its cap.',amount:small,scenario:3,expected:4});
  cases.push({key:'version',name:'Rules changed after review',detail:'The reviewed policy fingerprint is changed before execution.',amount:small,scenario:4,expected:6});
  cases.push({key:'expiry',name:'An expired trade intent',detail:'Execution happens after its signed slot deadline.',amount:small,scenario:5,expected:7});
  return cases.map(r=>{const code=evaluate(engine,c,r.amount,r.scenario);return {...r,code,matched:code===r.expected,allowed:code===0,reason:REASONS[code]??REASONS[10]};});
}
