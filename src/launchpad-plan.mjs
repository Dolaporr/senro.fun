import {validateLaunch} from './launchpad-model.mjs';
const BASE58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function prepareLaunchPlan({form,creator,metadataUri,mint,cluster='mainnet-beta',initialBuyLamports='0'}={}){
 const checked=validateLaunch(form??{});if(!checked.valid)throw Error('Fix token metadata before preparing a launch.');
 if(!BASE58.test(String(creator??'')))throw Error('Creator must be a Solana public key.');
 if(!BASE58.test(String(mint??'')))throw Error('Mint must be a Solana public key.');
 if(creator===mint)throw Error('Creator and mint must differ.');
 if(cluster!=='mainnet-beta'&&cluster!=='devnet')throw Error('Unsupported Solana cluster.');
 let uri;try{uri=new URL(metadataUri)}catch{throw Error('A verified metadata URI is required.');}
 if(!['https:','ipfs:','ar:'].includes(uri.protocol)||uri.username||uri.password||uri.hash||metadataUri.length>500)throw Error('Metadata URI must use HTTPS, IPFS or Arweave.');
 if(!/^(0|[1-9][0-9]*)$/.test(String(initialBuyLamports)))throw Error('Initial buy must be a nonnegative integer number of lamports.');
 if(BigInt(initialBuyLamports)>18446744073709551615n)throw Error('Initial buy exceeds u64.');
 return Object.freeze({version:1,chain:'solana',cluster,venue:'pump',creator,mint,metadataUri:uri.href,initialBuyLamports:String(initialBuyLamports),metadata:checked.metadata,execution:'not-enabled',requires:['verified SDK instruction schema','verified deployment identity','wallet signature','simulation','confirmation']});
}
export function assertSimulatedLaunch({plan,simulation,expectedMessageHash,actualMessageHash,now=Date.now()}={}){
 if(!plan||plan.execution!=='not-enabled')throw Error('Unknown launch plan.');
 if(!expectedMessageHash||expectedMessageHash!==actualMessageHash)throw Error('Transaction message changed after simulation.');
 if(!simulation||simulation.err||simulation.unitsConsumed==null)throw Error('Launch simulation did not succeed.');
 if(!Number.isSafeInteger(simulation.simulatedAt)||now-simulation.simulatedAt>30000||simulation.simulatedAt>now)throw Error('Launch simulation is stale.');
 return true;
}
