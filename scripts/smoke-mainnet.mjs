// Opt-in live checks. This script does not sign or send any transaction.
import {connectionFor,inspectMarket,simulateBuy} from '../src/live-chain.mjs';
import {DEFAULT_CONFIG} from '../src/model.mjs';
const connection=connectionFor(process.env.SENRO_RPC_URL||'https://api.mainnet-beta.solana.com');
const wallet=process.env.SENRO_SIMULATION_ADDRESS;
if(!wallet)throw Error('Set SENRO_SIMULATION_ADDRESS to a funded public wallet address. No signature is needed.');
console.log('Public read-only simulation address:',wallet);
for(const mint of ['AX4YTRmDzwrGPRBVN1g6K6fQZhgFtB43cdLiJEVspump','CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump']){
 try{const market=await inspectMarket(connection,mint);const r=await simulateBuy({connection,market,wallet,amount:'0.0001',slippageBps:100,config:DEFAULT_CONFIG,revision:1});console.log(JSON.stringify({venue:market.venue,ok:r.ok,error:r.error,expected:r.expected,received:r.observedOutput,minOut:r.minOut,units:r.units,slot:r.slot,fee:r.networkFee,checks:r.checks.map(c=>[c.name,c.state]),logs:r.ok?undefined:r.logs.slice(-5)}));}
 catch(e){console.log('Live check failed:',e.message);process.exitCode=1;}
}
