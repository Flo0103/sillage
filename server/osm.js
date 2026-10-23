const MAX_AREA=.012;
export function validateBox(value){
 if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))throw Error('Zone invalide.');
 const[s,w,n,e]=value;if(s< -90||n>90||w< -180||e>180||n<=s||e<=w||(n-s)*(e-w)>MAX_AREA)throw Error('Zone trop étendue pour OSM. Utilisez une portion plus courte.');
 return value;
}
const contains=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
export function createOSMService({fetcher=(...args)=>fetch(...args),now=Date.now,ttl=600000,maxBytes=32*1024*1024}={}){
 const cache=new Map(),pending=new Map();let bytes=0,active=0;
 function prune(){for(const[key,item]of cache)if(now()-item.time>ttl){cache.delete(key);bytes-=item.bytes;}}
 return async function getOSM(input){
  const bbox=validateBox(input);prune();
  for(const[key,item]of cache)if(contains(item.bbox,bbox)){cache.delete(key);cache.set(key,item);return {...item.data,cached:true};}
  const step=.0025;let box=[Math.floor(bbox[0]/step)*step,Math.floor(bbox[1]/step)*step,Math.ceil(bbox[2]/step)*step,Math.ceil(bbox[3]/step)*step].map(x=>Number(x.toFixed(6)));
  if((box[2]-box[0])*(box[3]-box[1])>MAX_AREA||box[0]< -90||box[2]>90||box[1]< -180||box[3]>180)box=bbox;
  const key=box.join(',');if(pending.has(key))return {...await pending.get(key),cached:true};
  if(active>=2)throw Object.assign(Error('Le service OSM est occupé. Réessayez dans quelques secondes.'),{status:429});
  const operation=(async()=>{
   active++;try{
    const query=`[out:json][timeout:20];way[highway][highway!~"motorway|trunk|motorway_link|trunk_link|steps|construction|proposed"](${box.join(',')});out body geom;`;
    const response=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'User-Agent':'Sillage/6.4 (+https://sillage.gravelspa.be)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Object.assign(Error('OSM est temporairement indisponible. Réessayez ou utilisez le mode manuel.'),{status:502});
    let raw='';const limit=20*1024*1024;
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Trop de données OSM. Réduisez la portion.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
    else{raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('Trop de données OSM. Réduisez la portion.');}
    const parsed=JSON.parse(raw);if(!Array.isArray(parsed.elements)||parsed.remark)throw Error('Réponse OSM incomplète. Réessayez plus tard.');
    const data={elements:parsed.elements,bbox:box},size=Buffer.byteLength(raw);
    if(size<=maxBytes){while(cache.size&&(bytes+size>maxBytes||cache.size>=16)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bbox:box,bytes:size,time:now()});bytes+=size;}
    return {...data,cached:false};
   }finally{active--;}
  })();pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
 };
}
