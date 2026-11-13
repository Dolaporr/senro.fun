import {parseAmount,formatAmount,u64} from './policy-client.mjs';
import {QUOTES} from './model.mjs';

export const RULES=[
 {id:'cap',label:'Trade size',field:'cap',toggle:'capOn',unit:'quote',description:'Set the largest amount allowed for one trade.'},
 {id:'rolling',label:'Rolling volume',field:'rolling',toggle:'rollingOn',unit:'quote',description:'Limit the total amount traded during the time window you choose.'},
 {id:'cooldown',label:'Sell cooldown',field:'cooldown',toggle:'cooldownOn',unit:'seconds',description:'Choose the minimum time between sells.'},
 {id:'account',label:'Account balance',field:'account',toggle:'accountOn',unit:'tokens',description:'Set the most tokens an account can hold after a buy.'}
];

export function previewRule({id,value,quote='SOL',percent=75,elapsed='10',exampleAmount='0.10',minutes='60'}){
 try{
  const decimals=id==='cooldown'?0:id==='account'?6:QUOTES[quote]?.decimals;
  if(decimals===undefined)throw Error('Choose a supported currency.');
  if(id==='cooldown'&&!/^\d+$/.test(value))throw Error('Use a whole number of seconds.');
  const limit=parseAmount(value,decimals);
  if(limit===0n)throw Error('Set a limit above zero.');
  const unit=id==='cooldown'?'seconds':id==='account'?'tokens':quote;
  const format=n=>formatAmount(n,decimals);
  if(id==='cooldown'){
   if(!/^\d+$/.test(elapsed))throw Error('Use a whole number of elapsed seconds.');
   const amount=parseAmount(elapsed,0),remaining=amount<limit?limit-amount:0n;
   return {status:remaining?'block':'pass',amount,limit,over:0n,remaining,amountText:format(amount),unit,
    title:remaining?'Give it a little more time':'Cooldown complete',detail:remaining?`Wait ${remaining} more seconds before the next sell.`:'The example sell meets your minimum gap.'};
  }
  if(!['cap','rolling','account'].includes(id))throw Error('Choose a supported rule.');
  if(!Number.isInteger(percent)||percent<1||percent>150)throw Error('Choose an example between 1% and 150% of the limit.');
  const used=u64((limit*BigInt(percent)+99n)/100n,'Example amount');
  let amount=used;
  if(id==='rolling'){
   if(!/^\d+$/.test(minutes)||BigInt(minutes)===0n)throw Error('Use a whole number of minutes above zero.');
   u64(BigInt(minutes)*60n+1000n,'Time window');
   const next=parseAmount(exampleAmount,decimals);
   if(next===0n)throw Error('Set the next trade above zero.');
   amount=u64(used+next,'Combined example volume');
  }
  const blocked=amount>limit,over=blocked?amount-limit:0n,remaining=blocked?0n:limit-amount;
  return {status:blocked?'block':'pass',amount,limit,over,remaining,used,amountText:format(id==='rolling'?used:amount),unit,
   title:blocked?(id==='rolling'?'Over the window budget':id==='account'?'Above the balance cap':'Above your limit'):(id==='rolling'?'Room in the window':id==='account'?'Within the balance cap':'Within your limit'),
   detail:blocked?`${format(over)} ${unit} over your ${id==='rolling'?'window budget':id==='account'?'balance cap':'limit'}.`:remaining===0n?'Exactly at your maximum.':`${format(remaining)} ${unit} ${id==='rolling'?'left after the example trade':'below your maximum'}.`};
 }catch(error){return {status:'invalid',title:'Check the example values',detail:error.message};}
}
