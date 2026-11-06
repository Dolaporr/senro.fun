// Keep the CLI exit status tied to the observed venue result.
export function requireSimulationSuccess(result){
 if(result?.ok!==true)throw Error('Venue simulation failed: '+JSON.stringify(result?.error??'No successful result'));
 return result;
}
