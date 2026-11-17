export const MAX_IMAGE_BYTES=5*1024*1024;
export function validateLaunch(input){
 const errors={};const name=String(input.name??'').trim(),symbol=String(input.symbol??'').trim(),description=String(input.description??'').trim();
 if(name.length<2||name.length>32)errors.name='Name must be 2–32 characters.';
 if(!/^[A-Za-z0-9]{2,10}$/.test(symbol))errors.symbol='Symbol must be 2–10 letters or numbers.';
 if(description.length>1000)errors.description='Description must be at most 1,000 characters.';
 for(const field of ['website','twitter','telegram']){const raw=String(input[field]??'').trim();if(!raw)continue;try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{errors[field]='Use a valid HTTPS URL.';}}
 const image=input.image;if(image&&(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>MAX_IMAGE_BYTES))errors.image='Use PNG, JPEG or WebP up to 5 MB.';
 return {valid:Object.keys(errors).length===0,errors,metadata:{name,symbol,description,website:String(input.website??'').trim(),twitter:String(input.twitter??'').trim(),telegram:String(input.telegram??'').trim()}};
}
export function launchChecklist({wallet,metadataUploaded=false,transactionPrepared=false}={}){return [{label:'Token details validated',done:true},{label:'Creator wallet connected',done:!!wallet},{label:'Metadata uploaded and URI verified',done:metadataUploaded},{label:'Pump launch transaction prepared',done:transactionPrepared},{label:'Wallet signature and confirmed on-chain launch',done:false}];}
