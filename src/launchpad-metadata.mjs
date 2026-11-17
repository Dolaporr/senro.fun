import {validateLaunch} from './launchpad-model.mjs';
export function createTokenMetadata(form,imageUri){
 const result=validateLaunch(form);if(!result.valid)throw Error('Token details are invalid.');
 const url=new URL(String(imageUri??''));if(!['https:','ipfs:','ar:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Image must have a verified content URI.');
 return {name:result.metadata.name,symbol:result.metadata.symbol,description:result.metadata.description,image:url.href,showName:true,...(result.metadata.website?{website:result.metadata.website}:{}),...(result.metadata.twitter?{twitter:result.metadata.twitter}:{}),...(result.metadata.telegram?{telegram:result.metadata.telegram}:{})};
}
export async function verifyMetadataDocument(uri,{fetcher=fetch,maxBytes=16384}={}){
 const url=new URL(uri);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Metadata verification requires a public HTTPS gateway URL.');
 const response=await fetcher(url.href,{method:'GET',redirect:'error',headers:{accept:'application/json'}});if(!response.ok)throw Error('Metadata could not be fetched.');
 const size=Number(response.headers?.get?.('content-length')??0);if(size>maxBytes)throw Error('Metadata exceeds the size limit.');
 const raw=await response.text();if(new TextEncoder().encode(raw).length>maxBytes)throw Error('Metadata exceeds the size limit.');
 let doc;try{doc=JSON.parse(raw)}catch{throw Error('Metadata is not valid JSON.');}
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||typeof doc.name!=='string'||typeof doc.symbol!=='string'||typeof doc.image!=='string')throw Error('Metadata is missing required token fields.');
 const checked=validateLaunch(doc);if(!checked.valid)throw Error('Metadata contains invalid token details.');
 return {name:checked.metadata.name,symbol:checked.metadata.symbol,image:doc.image,uri:url.href};
}
