import {coordinates,distance,routeLength} from './model.js';
const endpoint='https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
export function routeRequest(body){
 const points=coordinates(body.points);if(points.length>12)throw Error('Routage limité à 12 points, départ et arrivée compris.');
 if(![75,150,250].includes(body.tolerance??150))throw Error('Tolérance invalide.');
 if(points.slice(1).some((p,i)=>distance(points[i],p)<2)||routeLength(points)<5||routeLength(points)>15000)throw Error('Choisissez des points distincts pour une portion de moins de 15 km.');
 return {points,tolerance:body.tolerance??150};
}
export function createRoutingService({fetcher=(...args)=>fetch(...args),now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),base=process.env.BIKE_ROUTING_URL||endpoint}={}){
 const cache=new Map(),pending=new Map();let lastStart=-Infinity,queue=Promise.resolve(),queued=0,cacheBytes=0;
 // This URL is server configuration, never supplied by a visitor. Keep a trailing /.
 const urlBase=new URL(base);if(urlBase.protocol!=='https:')throw Error('Le service de routage doit utiliser HTTPS.');
 return async function route(input){
  const {points,tolerance}=routeRequest(input),key=JSON.stringify({points,tolerance});
  for(const[k,v]of cache)if(now()-v.time>600000){cache.delete(k);cacheBytes-=v.bytes;}
  if(cache.has(key))return {...cache.get(key).result,cached:true};if(pending.has(key))return pending.get(key);
  if(queued>=4)throw Object.assign(Error('Le routage est occupé. Réessayez dans quelques instants.'),{status:429});
  queued++;
  const job=queue.catch(()=>{}).then(async()=>{
   await wait(Math.max(0,1000-(now()-lastStart)));lastStart=now();
   const pair=points.map(p=>`${p[1]},${p[0]}`).join(';'),url=new URL(pair,urlBase.href.endsWith('/')?urlBase.href:urlBase.href+'/');
   url.search=new URLSearchParams({overview:'full',geometries:'geojson',steps:'false',alternatives:'false',radiuses:points.map(()=>tolerance).join(';'),continue_straight:'false'});
   let response;try{response=await fetcher(url.toString(),{headers:{'User-Agent':'Sillage/5.1 (+https://sillage.gravelspa.be)','Accept':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Le moteur vélo ne répond pas. Réessayez ou utilisez le GPX / mode manuel.'),{status:504});}
   if(!response.ok)throw Object.assign(Error(response.status===429?'Service de routage occupé. Réessayez plus tard.':'Le moteur vélo est indisponible. Le mode GPX ou manuel reste disponible.'),{status:response.status===429?429:502});
   const text=await boundedText(response);let data;try{data=JSON.parse(text);}catch{throw Object.assign(Error('Réponse du moteur vélo invalide. Réessayez plus tard.'),{status:502});}const route=data.routes?.[0];
   if(data.code!=='Ok'||route?.geometry?.type!=='LineString')throw Error('Aucun itinéraire vélo trouvé entre ces points. Essayez le GPX ou le mode manuel.');
   const path=coordinates(route.geometry.coordinates.map(p=>[p[1],p[0]])),length=routeLength(path);
   if(length<5)throw Error('Les deux points rejoignent le même endroit sur le réseau. Éloignez le départ ou l’arrivée.');
   if(length>15000)throw Error('Le chemin calculé dépasse 15 km. Rapprochez le départ et l’arrivée.');
   const snapped=data.waypoints?.length===points.length?coordinates(data.waypoints.map(w=>[w.location?.[1],w.location?.[0]])):null;
   const offsets=snapped?points.map((p,i)=>distance(p,snapped[i])):[distance(points[0],path[0]),distance(points.at(-1),path.at(-1))];
   const legs=route.legs;let legFractions=null;if(Array.isArray(legs)&&legs.length===points.length-1&&legs.every(l=>Number.isFinite(l.distance)&&l.distance>=0)){const sum=legs.reduce((n,l)=>n+l.distance,0);if(sum>0){let acc=0;legFractions=[0,...legs.map(l=>{acc+=l.distance;return acc/sum;})];}}
   if(offsets.some(m=>m>tolerance+5))throw Error('Le chemin est trop éloigné des points choisis. Augmentez la tolérance ou utilisez le mode manuel.');
   const result={coordinates:path,legFractions,surface:null,stats:{ignoredAnchors:0,maxOffset:Math.round(Math.max(...offsets)),tolerance},engine:base===endpoint?'OSRM vélo / FOSSGIS':'OSRM vélo',cached:false};
   const bytes=Buffer.byteLength(JSON.stringify(result)),maxBytes=16*1024*1024;if(bytes<=maxBytes){while(cache.size&&(cache.size>=64||cacheBytes+bytes>maxBytes)){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{time:now(),result,bytes});cacheBytes+=bytes;}return result;
  });
  queue=job.catch(()=>{});pending.set(key,job);try{return await job;}finally{queued--;pending.delete(key);}
 };
}
async function boundedText(response){
 const limit=8*1024*1024;if(!response.body?.getReader){const raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('Réponse de routage trop volumineuse.');return raw;}
 const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Réponse de routage trop volumineuse.');}raw+=decoder.decode(value,{stream:true});}return raw+decoder.decode();}finally{reader.releaseLock();}
}
