import {createLocalRouting} from './local-routing.js';
import {coordinates,distance,routeLength} from './model.js';
const endpoint='https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
export function routeRequest(body){
 if(body.accessMode!==undefined&&body.accessMode!=='explicit')throw Error('Politique d’accès invalide.');const points=coordinates(body.points),planning=body.purpose==='itinerary',maxPoints=planning?50:12,maxDistance=planning?500000:15000;
 if(points.length>maxPoints)throw Error(`Routage limité à ${maxPoints} points, départ et arrivée compris.`);
 if(![75,150,250].includes(body.tolerance??150))throw Error('Tolérance invalide.');
 if(points.slice(1).some((p,i)=>distance(points[i],p)<(body.allowRestricted===true ? .5 : 2))||routeLength(points)<(body.allowRestricted===true ? .5 : 5)||routeLength(points)>maxDistance)throw Error(`Choisissez des points distincts pour ${planning?'un itinéraire de moins de 500 km':'un secteur de moins de 15 km'}.`);
 return {points,tolerance:body.tolerance??150,maxDistance,planning};
}
export function createRoutingService({fetcher=(...args)=>fetch(...args),now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),base=process.env.BIKE_ROUTING_URL||endpoint,localRouting=createLocalRouting(),onlineRouting}={}){
 const cache=new Map(),pending=new Map();let lastStart=-Infinity,queue=Promise.resolve(),queued=0,cacheBytes=0;
 const verifiedCache=new Map(),verifiedPending=new Map();let verifiedBytes=0;
 const urlBase=new URL(base);if(urlBase.protocol!=='https:')throw Error('Le service de routage doit utiliser HTTPS.');
 async function request(url){
  let response;try{response=await fetcher(url.toString(),{headers:{'User-Agent':'Sillage/6.4 (+https://sillage.gravelspa.be)','Accept':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Le moteur vélo ne répond pas. Réessayez ou utilisez le mode manuel.'),{status:504});}
  if(!response.ok)throw Object.assign(Error(response.status===429?'Service de routage occupé. Réessayez plus tard.':'Le moteur vélo est indisponible. Le mode manuel reste disponible.'),{status:response.status===429?429:502});
  const text=await boundedText(response);try{return JSON.parse(text);}catch{throw Object.assign(Error('Réponse du moteur vélo invalide. Réessayez plus tard.'),{status:502});}
 }
 async function enqueue(key,operation){
  for(const[k,v]of cache)if(now()-v.time>600000){cache.delete(k);cacheBytes-=v.bytes;}
  if(cache.has(key))return {...cache.get(key).result,cached:true};if(pending.has(key))return pending.get(key);
  if(queued>=4)throw Object.assign(Error('Le routage est occupé. Réessayez dans quelques instants.'),{status:429});queued++;
  const job=queue.catch(()=>{}).then(async()=>{await wait(Math.max(0,1000-(now()-lastStart)));lastStart=now();const result=await operation(),bytes=Buffer.byteLength(JSON.stringify(result)),maxBytes=16*1024*1024;
   if(bytes<=maxBytes){while(cache.size&&(cache.size>=64||cacheBytes+bytes>maxBytes)){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{time:now(),result,bytes});cacheBytes+=bytes;}return result;
  });queue=job.catch(()=>{});pending.set(key,job);try{return await job;}finally{queued--;pending.delete(key);}
 }
 const provider=async({points,tolerance,maxDistance,planning},verified=false)=>{
  return enqueue(JSON.stringify({points,tolerance,planning,verified}),async()=>{
   const pair=points.map(p=>`${p[1]},${p[0]}`).join(';'),url=new URL(pair,urlBase.href.endsWith('/')?urlBase.href:urlBase.href+'/');
   // A guide can start on a neighbouring road missing from the provider's
   // bicycle graph. Only the subsequent OSM calculation snaps the real controls
   // and must keep their original tolerance, access and direction constraints.
   const providerRadius=verified?Math.max(1000,tolerance):tolerance;
   url.search=new URLSearchParams({overview:'full',geometries:'geojson',steps:'true',alternatives:'false',radiuses:points.map(()=>providerRadius).join(';'),continue_straight:'false'});
   if(verified)url.searchParams.set('annotations','nodes');
   const data=await request(url),chosen=data.routes?.[0];if(data.code!=='Ok'||chosen?.geometry?.type!=='LineString')throw Error('Aucun itinéraire vélo trouvé entre ces points. Essayez le mode manuel.');
   if(!verified&&chosen.legs?.some(l=>l.steps?.some(s=>['pushing bike','walking','steps up','steps down'].includes(s.mode))))throw Error('Le moteur vélo propose un passage à pied, parfois à contre-sens. Ajoutez des points rapprochés pour le calcul OSM local.');
   const path=coordinates(chosen.geometry.coordinates.map(p=>[p[1],p[0]])),length=routeLength(path);
   if(length<5)throw Error('Les points rejoignent le même endroit sur le réseau. Éloignez-les.');if(length>maxDistance)throw Error(`Le chemin calculé dépasse ${maxDistance/1000} km. Rapprochez les points.`);
   const snappedPoints=data.waypoints?.length===points.length?coordinates(data.waypoints.map(w=>[w.location?.[1],w.location?.[0]])):points.map((p,i)=>i===0?path[0]:i===points.length-1?path.at(-1):path.reduce((best,q)=>distance(p,q)<distance(p,best)?q:best,path[0]));
   const offsets=points.map((p,i)=>distance(p,snappedPoints[i]));if(offsets.some(m=>m>providerRadius+5))throw Error('Le chemin est trop éloigné des points choisis. Augmentez la tolérance ou utilisez le mode manuel.');
   const legs=chosen.legs;let legFractions=null;if(Array.isArray(legs)&&legs.length===points.length-1&&legs.every(l=>Number.isFinite(l.distance)&&l.distance>=0)){const sum=legs.reduce((n,l)=>n+l.distance,0);if(sum>0){let acc=0;legFractions=[0,...legs.map(l=>{acc+=l.distance;return acc/sum;})];}}
   const result={coordinates:path,snappedPoints,legFractions,surface:null,stats:{ignoredAnchors:0,maxOffset:Math.round(Math.max(...offsets)),tolerance},engine:base===endpoint?'OSRM vélo / FOSSGIS':'OSRM vélo',cached:false};
   if(verified)return {...result,osmNodes:chosen.legs?.flatMap(l=>l.annotation?.nodes||[])};
   return result;
  });
 };
 const guided=async(args,router)=>{
  const key=JSON.stringify({...args,online:router===onlineRouting});for(const[k,item]of verifiedCache)if(now()-item.time>600000){verifiedCache.delete(k);verifiedBytes-=item.bytes;}
  if(verifiedCache.has(key))return {...verifiedCache.get(key).result,cached:true};if(verifiedPending.has(key))return verifiedPending.get(key);
  // Release the provider's rate-limited queue before OSM verification. One
  // user's slow data source must not hold up every other user's bike router.
  const job=(async()=>{const guide=await provider(args,true),result=await router.guided({...args,accessMode:'explicit'},guide),bytes=Buffer.byteLength(JSON.stringify(result)),limit=16*1024*1024;
   if(bytes<=limit){while(verifiedCache.size&&(verifiedCache.size>=64||verifiedBytes+bytes>limit)){const first=verifiedCache.keys().next().value;verifiedBytes-=verifiedCache.get(first).bytes;verifiedCache.delete(first);}verifiedCache.set(key,{result,bytes,time:now()});verifiedBytes+=bytes;}return result;
  })();verifiedPending.set(key,job);try{return await job;}finally{verifiedPending.delete(key);}
 };
 const calculate=async(args,router)=>{
  const {points,tolerance,maxDistance}=args,localInput={points,tolerance,maxDistance,accessMode:'explicit'},cached=router.cached?.(localInput);if(cached)return cached;
  const long=routeLength(points)>2000&&!!router.guided;let guideError;
  if(long)try{return await guided(args,router);}catch(e){guideError=e;}
  try{return await router(localInput);}catch(e){
   // Nearby controls can require a long detour to reach a bridge or an opening.
   // No path in a bounded snapshot is not proof that no legal path exists.
   // The candidate is still rebuilt on OSM with the same access/direction rules.
   if(!long&&router.guided&&!e.bicycleForbidden)try{return await guided(args,router);}catch(f){guideError=f;}
   const error=!e.bicycleForbidden&&guideError&&(e.code==='LOCAL_TOO_LARGE'||e.localNoPath)?guideError:e;
   throw Object.assign(error,{status:error.status||(error.code==='LOCAL_TOO_LARGE'?422:503)});
  }
 };
 const route=async input=>{
  const args=routeRequest(input),{points,tolerance,maxDistance}=args;
  if(input.allowRestricted!==true&&input.accessMode!=='explicit')return provider(args);
  const localInput={points,tolerance,maxDistance,accessMode:'explicit'},cached=localRouting.cached?.(localInput);if(cached)return cached;
  // Coverage uses roads near the controls, never just an extract's rectangle.
  // Keep ordinary editing entirely offline; an uncovered control uses the
  // online graph directly instead of warming an incomplete PostGIS window.
  if(localRouting.offline){
   if(!await localRouting.offline(localInput))return calculate(args,onlineRouting||localRouting);
   try{return await localRouting(localInput);}catch(e){
    // A border crossing can leave the extract even with both controls inside.
    // Rebuild from online OSM and reapply access and direction rules; never
    // return an unchecked OSRM candidate or bypass an explicit bicycle ban.
    if(onlineRouting&&e.localNoPath&&!e.bicycleForbidden)return calculate(args,onlineRouting);
    if(e.code!=='LOCAL_TOO_LARGE')throw Object.assign(e,{status:e.status||503});
   }
  }
  return calculate(args,localRouting);
 };
 if(localRouting.status)route.status=()=>localRouting.status();
 route.nearest=async input=>{if(input.accessMode!==undefined&&input.accessMode!=='explicit')throw Error('Politique d’accès invalide.');const point=coordinates([input.point,input.point])[0],tolerance=input.tolerance??150;if(![75,150,250].includes(tolerance))throw Error('Tolérance invalide.');
  if(input.allowRestricted===true||input.accessMode==='explicit'){
   try{const args={point,tolerance,accessMode:'explicit'},covered=!onlineRouting||!localRouting.offline||await localRouting.offline({points:[point],tolerance}),router=covered?localRouting:onlineRouting;
    try{return await router.nearest(args);}catch(e){if(router===localRouting&&onlineRouting&&e.localNoPath&&!e.bicycleForbidden)return await onlineRouting.nearest(args);throw e;}
   }catch(e){throw Object.assign(e,{status:e.status||503});}
  }
  return enqueue(JSON.stringify({nearest:point,tolerance}),async()=>{
   if(!urlBase.pathname.includes('/route/v1/'))throw Error('Le fournisseur de routage ne propose pas l’accrochage des points.');
   const url=new URL(urlBase.href.replace('/route/v1/','/nearest/v1/'));url.pathname=url.pathname.replace(/\/?$/,`/${point[1]},${point[0]}`);url.search=new URLSearchParams({number:'1',radiuses:String(tolerance)});
   const data=await request(url),location=data.waypoints?.[0]?.location;if(data.code!=='Ok'||!location)throw Error('Aucun chemin vélo OSM à proximité. Déplacez le point ou utilisez le mode manuel.');
   const snapped=coordinates([[location[1],location[0]],[location[1],location[0]]])[0],offset=distance(point,snapped);if(offset>tolerance+5)throw Error('Point trop éloigné du réseau OSM. Déplacez-le ou augmentez la tolérance.');
   return {point:snapped,offset:Math.round(offset),cached:false};
  });
 };
 return route;
}
async function boundedText(response){
 const limit=8*1024*1024;if(!response.body?.getReader){const raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('Réponse de routage trop volumineuse.');return raw;}
 const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Réponse de routage trop volumineuse.');}raw+=decoder.decode(value,{stream:true});}return raw+decoder.decode();}finally{reader.releaseLock();}
}
