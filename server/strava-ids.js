// Prefer Strava's string IDs. Numbers are accepted only while still exact;
// converting an already rounded Number to a string cannot recover its ID.
export function stravaId(object,field='id'){
 const value=object?.[field+'_str']??object?.[field];
 const id=typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
 if(!/^[1-9]\d{0,18}$/.test(id)||BigInt(id)>9223372036854775807n)throw Error('Identifiant Strava invalide.');
 return id;
}

// Webhooks still document numeric owner_id/object_id. Node 22+ exposes the
// original JSON token to revivers, before precision is lost to Number.
// Use this only for Strava payloads; distances, dates and streams stay numeric.
export function stravaIdReviver(key,value,context){
 if(['id','owner_id','object_id'].includes(key)&&typeof value==='number'&&!Number.isSafeInteger(value))return context?.source??value;
 return value;
}
