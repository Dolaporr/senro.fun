import {quantities,DEFAULT_CONFIG} from './model.mjs';
const STORAGE_KEY='senro-rule-library-v1';
export function validateSnapshot(value){
 if(!value||typeof value.id!=='string'||!value.id||typeof value.name!=='string'||!value.name.trim()||value.name.length>48||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isFinite(value.createdAt))throw Error('Invalid saved rule set.');
 const config={};for(const k of Object.keys(DEFAULT_CONFIG)){if(typeof value.config?.[k]!==typeof DEFAULT_CONFIG[k])throw Error('Invalid saved rule values.');config[k]=value.config[k]}
 quantities(config);return {id:value.id,name:value.name.trim(),revision:value.revision,createdAt:value.createdAt,config};
}
export function loadSnapshots(storage){try{const raw=JSON.parse(storage.getItem(STORAGE_KEY)||'[]');if(!Array.isArray(raw))return [];return raw.slice(0,24).flatMap(v=>{try{return [validateSnapshot(v)]}catch{return []}})}catch{return []}}
export function saveSnapshots(storage,values){if(values.length>24)throw Error('You have 24 saved rule sets. Remove a saved copy before saving another.');const next=values.map(validateSnapshot);storage.setItem(STORAGE_KEY,JSON.stringify(next));return next;}
