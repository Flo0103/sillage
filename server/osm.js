const MAX_AREA=.012;
export function validateBox(value){
 if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))throw Error('Zone invalide.');
 const[s,w,n,e]=value;if(s< -90||n>90||w< -180||e>180||n<=s||e<=w||(n-s)*(e-w)>MAX_AREA)throw Error('Zone trop étendue pour OSM. Utilisez une portion plus courte.');
 return value;
}
const contains=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
export function createOSMService({fetcher=(...args)=>fetch(...args),now=Date.now,ttl=600000,maxBytes=32*1024*1024,mapFallback=false,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const cache=new Map(),pending=new Map(),mapAreaBackoff=new Map();let bytes=0,active=0,overpassBackoff=0,overpassFailures=0,mapBackoff=0,mapLast=-Infinity,mapQueue=Promise.resolve();
 function prune(){for(const[k,t]of mapAreaBackoff)if(now()>=t)mapAreaBackoff.delete(k);for(const[key,item]of cache)if(now()-item.time>(item.ttl??ttl)){cache.delete(key);bytes-=item.bytes;}}
 const getOSM=async function(input){
  const bbox=validateBox(input);prune();
  for(const[key,item]of cache)if(contains(item.bbox,bbox)){cache.delete(key);cache.set(key,item);return {...item.data,cached:true};}
  const step=.0025;let box=[Math.floor(bbox[0]/step)*step,Math.floor(bbox[1]/step)*step,Math.ceil(bbox[2]/step)*step,Math.ceil(bbox[3]/step)*step].map(x=>Number(x.toFixed(6)));
  if((box[2]-box[0])*(box[3]-box[1])>MAX_AREA||box[0]< -90||box[2]>90||box[1]< -180||box[3]>180)box=bbox;
  const key=box.join(',');if(pending.has(key))return {...await pending.get(key),cached:true};
  if(active>=2)throw Object.assign(Error('Le service OSM est occupé. Réessayez dans quelques secondes.'),{status:429});
  const operation=(async()=>{
   active++;try{
    const query=`[out:json][timeout:20];way[highway][highway!~"motorway|trunk|motorway_link|trunk_link|steps|construction|proposed"](${box.join(',')});out body geom;`;
    const small=(box[2]-box[0])*(box[3]-box[1])<=.001,overpassAttempt=!mapFallback||now()>=overpassBackoff;let parsed,source='Overpass';
    try{
     if(!overpassAttempt)throw Error('Overpass en pause après une panne.');
     const response=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'User-Agent':'Sillage/6.4.1 (+https://sillage.gravelspa.be)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(mapFallback&&small?8000:25000)});
     if(!response.ok)throw Object.assign(Error('OSM est temporairement indisponible. Réessayez ou utilisez le mode manuel.'),{status:502});
     parsed=await osmJSON(response);if(!Array.isArray(parsed.elements)||parsed.remark)throw Error('Réponse OSM incomplète. Réessayez plus tard.');overpassFailures=0;overpassBackoff=0;
    }catch(error){
     if(!mapFallback)throw error;if(overpassAttempt){overpassFailures=Math.min(5,overpassFailures+1);overpassBackoff=now()+Math.min(900000,60000*2**(overpassFailures-1));}
     if(!small||now()<mapBackoff||now()<(mapAreaBackoff.get(key)??0))throw error;
     const job=mapQueue.catch(()=>{}).then(async()=>{
      if(now()<mapBackoff)throw error;await wait(Math.max(0,1000-(now()-mapLast)));mapLast=now();
      try{const [south,west,north,east]=box,url=new URL('https://api.openstreetmap.org/api/0.6/map.json');url.searchParams.set('bbox',[west,south,east,north].join(','));
       const response=await fetcher(url.toString(),{headers:{'User-Agent':'Sillage/6.4.1 (+https://sillage.gravelspa.be)','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
       if(!response.ok)throw Object.assign(Error(`Source OSM directe indisponible (${response.status}).`),{mapArea:response.status===400,status:response.status});try{return {elements:osmMapWays(await osmJSON(response))};}catch(e){throw Object.assign(e,{mapArea:true});}
      }catch(e){if(e.mapArea){if(mapAreaBackoff.size>=64)mapAreaBackoff.delete(mapAreaBackoff.keys().next().value);mapAreaBackoff.set(key,now()+60000);}else mapBackoff=now()+60000;throw e;}
     });mapQueue=job.catch(()=>{});parsed=await job;source='OSM API';
    }
    const data={elements:parsed.elements,bbox:box,source},size=Buffer.byteLength(JSON.stringify(parsed));
    if(size<=maxBytes){while(cache.size&&(bytes+size>maxBytes||cache.size>=16)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bbox:box,bytes:size,time:now(),ttl:source==='OSM API'?Math.max(ttl,3600000):ttl});bytes+=size;}
    return {...data,cached:false};
   }finally{active--;}
  })();pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
 };
 getOSM.peek=(input,{inFlight=false}={})=>{const bbox=validateBox(input);prune();let best=null,key;for(const[k,item]of cache)if(contains(item.bbox,bbox)&&(!best||(item.bbox[2]-item.bbox[0])*(item.bbox[3]-item.bbox[1])>(best.bbox[2]-best.bbox[0])*(best.bbox[3]-best.bbox[1]))){best=item;key=k;}if(!best){if(inFlight)for(const[k,job]of pending)if(contains(k.split(',').map(Number),bbox))return job.then(data=>({...data,cached:true}));return null;}cache.delete(key);cache.set(key,best);return {...best.data,cached:true};};
 return getOSM;
}

async function osmJSON(response){
 const limit=20*1024*1024;let raw='';
 if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Trop de données OSM. Réduisez la portion.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 else{raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('Trop de données OSM. Réduisez la portion.');}return JSON.parse(raw);
}
export function osmMapWays(data){
 if(!Array.isArray(data.elements)||data.remark)throw Error('Réponse OSM incomplète.');
 const nodes=new Map(data.elements.filter(e=>e.type==='node'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)).map(e=>[e.id,{lat:e.lat,lon:e.lon}]));
 const ways=data.elements.filter(e=>e.type==='way'&&e.tags?.highway&&!/^(motorway|trunk|motorway_link|trunk_link|steps|construction|proposed)$/.test(e.tags.highway)).map(w=>{
  if(!Array.isArray(w.nodes)||w.nodes.length<2||w.nodes.some(id=>!nodes.has(id)))throw Error('Géométrie OSM incomplète.');
  return {type:'way',id:w.id,nodes:w.nodes,geometry:w.nodes.map(id=>nodes.get(id)),tags:w.tags};
 });if(!ways.length)throw Error('Aucun chemin OSM disponible.');return ways;
}
