const MAX_AREA=.012;
export function validateBox(value){
 if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))throw Error('Zone invalide.');
 const[s,w,n,e]=value;if(s< -90||n>90||w< -180||e>180||n<=s||e<=w||(n-s)*(e-w)>MAX_AREA)throw Error('Zone trop étendue pour OSM. Utilisez une portion plus courte.');
 return value;
}
const contains=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
export function createOSMService({fetcher=(...args)=>fetch(...args),now=Date.now,ttl=600000,maxBytes=32*1024*1024,mapFallback=false,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const cache=new Map(),pending=new Map(),mapAreaBackoff=new Map();let bytes=0,active=0,overpassBackoff=0,overpassFailures=0,mapBackoff=0,mapLast=-Infinity,mapQueue=Promise.resolve();const routingPending=new Map();
 const guides=new Map(),guidePending=new Map(),guideBackoff=new Map();let guideBytes=0;
 function prune(){for(const[k,t]of mapAreaBackoff)if(now()>=t)mapAreaBackoff.delete(k);for(const[key,item]of cache)if(now()-item.time>(item.ttl??ttl)){cache.delete(key);bytes-=item.bytes;}}
 const getOSM=async function(input,{routing=false}={}){
  const bbox=validateBox(input);prune();
  for(const[key,item]of cache)if(contains(item.bbox,bbox)){cache.delete(key);cache.set(key,item);return {...item.data,cached:true};}
  const step=.0025;let box=[Math.floor(bbox[0]/step)*step,Math.floor(bbox[1]/step)*step,Math.ceil(bbox[2]/step)*step,Math.ceil(bbox[3]/step)*step].map(x=>Number(x.toFixed(6)));
  if((box[2]-box[0])*(box[3]-box[1])>MAX_AREA||box[0]< -90||box[2]>90||box[1]< -180||box[3]>180)box=bbox;
  const key=box.join(',');if(pending.has(key))return {...await pending.get(key),cached:true};
  if(active>=2)throw Object.assign(Error('Le service OSM est occupé. Réessayez dans quelques secondes.'),{status:429});
  const operation=(async()=>{
   active++;try{
    const query=`[out:json][timeout:${routing?5:20}];way[highway][highway!~"motorway|trunk|motorway_link|trunk_link|steps|construction|proposed"](${box.join(',')});out body geom;`;
    const small=(box[2]-box[0])*(box[3]-box[1])<=.001,overpassAttempt=!mapFallback||now()>=overpassBackoff;let parsed,source='Overpass';
    try{
     if(!overpassAttempt)throw Error('Overpass en pause après une panne.');
     const response=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'User-Agent':'Sillage/6.18.1 (+https://sillage.gravelspa.be)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(routing?6000:mapFallback&&small?8000:25000)});
     if(!response.ok)throw Object.assign(Error('OSM est temporairement indisponible. Réessayez ou utilisez le mode manuel.'),{status:502});
     parsed=await osmJSON(response);if(!Array.isArray(parsed.elements)||parsed.remark)throw Error('Réponse OSM incomplète. Réessayez plus tard.');overpassFailures=0;overpassBackoff=0;
    }catch(error){
     if(!mapFallback)throw error;if(overpassAttempt){overpassFailures=Math.min(5,overpassFailures+1);overpassBackoff=now()+Math.min(900000,60000*2**(overpassFailures-1));}
     if(!small||now()<mapBackoff||now()<(mapAreaBackoff.get(key)??0))throw error;
     const job=mapQueue.catch(()=>{}).then(async()=>{
      if(now()<mapBackoff)throw error;await wait(Math.max(0,1000-(now()-mapLast)));mapLast=now();
      try{const [south,west,north,east]=box,url=new URL('https://api.openstreetmap.org/api/0.6/map.json');url.searchParams.set('bbox',[west,south,east,north].join(','));
       const response=await fetcher(url.toString(),{headers:{'User-Agent':'Sillage/6.4.1 (+https://sillage.gravelspa.be)','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
       if(!response.ok)throw Object.assign(Error(`Source OSM directe indisponible (${response.status}).`),{mapArea:response.status===400,status:response.status});try{return {elements:osmMapWays(await osmJSON(response),{allowEmpty:true})};}catch(e){throw Object.assign(e,{mapArea:true});}
      }catch(e){if(e.mapArea){if(mapAreaBackoff.size>=64)mapAreaBackoff.delete(mapAreaBackoff.keys().next().value);mapAreaBackoff.set(key,now()+60000);}else mapBackoff=now()+60000;throw e;}
     });mapQueue=job.catch(()=>{});parsed=await job;source='OSM API';
    }
    const data={elements:parsed.elements,bbox:box,source},size=Buffer.byteLength(JSON.stringify(parsed));
    if(size<=maxBytes){while(cache.size&&(bytes+size>maxBytes||cache.size>=16)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bbox:box,bytes:size,time:now(),ttl:source==='OSM API'?Math.max(ttl,3600000):ttl});bytes+=size;}
    return {...data,cached:false};
   }finally{active--;}
  })();pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
 };
 // A user's routing frame can be joined from at most nine small cached areas.
 // Each request retains the existing throttling, error backoff and memory limits.
 getOSM.forRouting=async input=>{
  const box=validateBox(input),key=box.join(',');if(routingPending.has(key))return routingPending.get(key);
  const job=(async()=>{let original;try{return await getOSM(box,{routing:true});}catch(e){original=e;}
   if(!mapFallback||(box[2]-box[0])*(box[3]-box[1])<=.001)throw original;
   const step=.025,start=[Math.floor((box[0]+1e-9)/step),Math.floor((box[1]+1e-9)/step)],end=[Math.ceil((box[2]-1e-9)/step),Math.ceil((box[3]-1e-9)/step)];
   let rows=end[0]-start[0],cols=end[1]-start[1],origin=[start[0]*step,start[1]*step];
   // At grid boundaries an otherwise small frame can span too many cells.
   // Pack from its own origin in that case, retaining the same request budget.
   if(rows*cols>9){rows=Math.ceil((box[2]-box[0])/step);cols=Math.ceil((box[3]-box[1])/step);origin=box.slice(0,2);}
   if(rows*cols>9)throw original;
   const ways=new Map(),sources=new Set();let joinedBytes=0;
   for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const tile=[origin[0]+row*step,origin[1]+col*step,origin[0]+(row+1)*step,origin[1]+(col+1)*step].map(v=>Number(v.toFixed(6))),data=await getOSM(tile);sources.add(data.source);
    for(const way of data.elements){const id=way.id??JSON.stringify(way.nodes);if(!ways.has(id)){joinedBytes+=Buffer.byteLength(JSON.stringify(way));if(joinedBytes>maxBytes||ways.size>=100000)throw Error('Zone OSM trop détaillée. Ajoutez un point de passage.');ways.set(id,way);}}
   }
   const data={elements:[...ways.values()],bbox:box,source:sources.size===1?[...sources][0]:'OSM · zones jointes'},size=Buffer.byteLength(JSON.stringify(data));
   if(size<=maxBytes){while(cache.size&&(bytes+size>maxBytes||cache.size>=16)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bbox:box,bytes:size,time:now(),ttl:sources.has('OSM API')?Math.max(ttl,3600000):ttl});bytes+=size;}
   return {...data,cached:false};
  })();routingPending.set(key,job);try{return await job;}finally{routingPending.delete(key);}
 };
 // A long diagonal must not require every road in its bounding rectangle.
 // OSRM annotations identify the OSM nodes along a candidate. Fetch their ways
 // (and the actual clicked points' neighbourhoods) in one bounded query. This
 // snapshot is partial: never advertise it as coverage of a whole map area.
 getOSM.forRoute=async ({nodes,points})=>{
  if(!Array.isArray(nodes)||nodes.length>25000||nodes.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('Guide OSM incomplet ou trop détaillé.');
  const ids=[...new Set(nodes)].sort((a,b)=>a-b);if(ids.length<2)throw Error('Guide OSM sans identifiants de chemins.');
  const nearPoints=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),key=JSON.stringify([ids,nearPoints]);
  for(const[k,item]of guides)if(now()-item.time>ttl){guides.delete(k);guideBytes-=item.bytes;}
  if(guides.has(key))return {...guides.get(key).data,cached:true};if(guidePending.has(key))return guidePending.get(key);
  if(active>=2)throw Object.assign(Error('Le service OSM est occupé. Réessayez dans quelques secondes.'),{status:429});
  const job=(async()=>{active++;try{
   const filter='[highway][highway!~"motorway|trunk|motorway_link|trunk_link|steps|construction|proposed"]',near=nearPoints.map(p=>`way(around:175,${p[0]},${p[1]})${filter};`).join(''),query=`[out:json][timeout:5];node(id:${ids.join(',')})->.route;(way(bn.route)${filter};${near});out body geom;`;
   let lastError;
   for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
    if(now()<(guideBackoff.get(endpoint)||0)||endpoint.includes('overpass-api.de')&&now()<overpassBackoff)continue;
    try{
     const response=await fetcher(endpoint,{method:'POST',headers:{'User-Agent':'Sillage/6.18.1 (+https://sillage.gravelspa.be)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(6000)});
     if(!response.ok)throw Error(`Source OSM indisponible (${response.status}).`);
     const parsed=await osmJSON(response);if(!Array.isArray(parsed.elements)||parsed.remark)throw Error('Réponse OSM incomplète.');
     const data={elements:parsed.elements,source:'Overpass · chemins du trajet'},size=Buffer.byteLength(JSON.stringify(data))+Buffer.byteLength(key);
     if(size<=maxBytes/2){while(guides.size&&(guides.size>=16||guideBytes+size>maxBytes/2)){const first=guides.keys().next().value;guideBytes-=guides.get(first).bytes;guides.delete(first);}guides.set(key,{data,bytes:size,time:now()});guideBytes+=size;}
     return {...data,cached:false};
    }catch(e){lastError=e;guideBackoff.set(endpoint,now()+60000);if(endpoint.includes('overpass-api.de'))overpassBackoff=Math.max(overpassBackoff,now()+60000);}
   }
   throw Object.assign(Error('La vérification des chemins OSM est temporairement indisponible. Réessayez dans quelques instants.'),{status:503,cause:lastError});
  }finally{active--;}})();guidePending.set(key,job);try{return await job;}finally{guidePending.delete(key);}
 };
 getOSM.peek=(input,{inFlight=false}={})=>{const bbox=validateBox(input);prune();let best=null,key;for(const[k,item]of cache)if(contains(item.bbox,bbox)&&(!best||(item.bbox[2]-item.bbox[0])*(item.bbox[3]-item.bbox[1])>(best.bbox[2]-best.bbox[0])*(best.bbox[3]-best.bbox[1]))){best=item;key=k;}if(!best){if(inFlight)for(const[k,job]of pending)if(contains(k.split(',').map(Number),bbox))return job.then(data=>({...data,cached:true}));return null;}cache.delete(key);cache.set(key,best);return {...best.data,cached:true};};
 return getOSM;
}

async function osmJSON(response){
 const limit=20*1024*1024;let raw='';
 if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Trop de données OSM. Réduisez la portion.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 else{raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('Trop de données OSM. Réduisez la portion.');}return JSON.parse(raw);
}
export function osmMapWays(data,{allowEmpty=false}={}){
 if(!Array.isArray(data.elements)||data.remark)throw Error('Réponse OSM incomplète.');
 const nodes=new Map(data.elements.filter(e=>e.type==='node'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)).map(e=>[e.id,{lat:e.lat,lon:e.lon}]));
 const ways=data.elements.filter(e=>e.type==='way'&&e.tags?.highway&&!/^(motorway|trunk|motorway_link|trunk_link|steps|construction|proposed)$/.test(e.tags.highway)).map(w=>{
  if(!Array.isArray(w.nodes)||w.nodes.length<2||w.nodes.some(id=>!nodes.has(id)))throw Error('Géométrie OSM incomplète.');
  return {type:'way',id:w.id,nodes:w.nodes,geometry:w.nodes.map(id=>nodes.get(id)),tags:w.tags};
 });if(!ways.length&&!allowEmpty)throw Error('Aucun chemin OSM disponible.');return ways;
}
