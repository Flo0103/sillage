import {surfaceInfo,bicycleAccess} from '../dist/osm-tags.js';
import {smoothElevation,elevationGain} from '../dist/elevation-data.js';
import {createHash} from 'node:crypto';
import {coordinates,distance,routeLength} from './model.js';
const interpolate=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export function samplePath(path,spacing=100,max=401){
 const lengths=path.slice(1).map((p,i)=>distance(path[i],p)),total=lengths.reduce((n,x)=>n+x,0),count=Math.max(2,Math.min(max,Math.ceil(total/spacing)+1)),out=[];let index=0,at=0;
 for(let i=0;i<count;i++){const target=total*i/(count-1);while(index<lengths.length-1&&at+lengths[index]<target){at+=lengths[index++];}out.push({at:target,point:interpolate(path[index],path[index+1],lengths[index]?(target-at)/lengths[index]:0)});}return out;
}
export function elevationProfile(samples,values){
 if(values.length!==samples.length||values.some(v=>!Number.isFinite(v)||v< -500||v>9000))throw Error('Altitudes incomplètes.');
 const profile=samples.map((s,i)=>({at:Math.round(s.at*10)/10,altitude:Math.round(values[i]*10)/10})),gain=elevationGain(smoothElevation(profile));
 return {...gain,profile,spacing:Math.round(samples.at(-1).at/(samples.length-1)),source:'Open-Meteo · Copernicus DEM GLO-90'};
}
function project(p,scale){return [p[1]*scale,p[0]*111320];}
function projection(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
export function surfaceProfile(path,elements){
 const scale=111320*Math.max(.01,Math.cos(path[0][0]*Math.PI/180)),grid=new Map(),cell=60;let count=0;
 for(const way of elements){if(!way.tags?.highway||!way.geometry)continue;const {type,unpaved}=surfaceInfo(way.tags);
  for(let i=1;i<way.geometry.length;i++){const a=project([way.geometry[i-1].lat,way.geometry[i-1].lon],scale),b=project([way.geometry[i].lat,way.geometry[i].lon],scale);if(![...a,...b].every(Number.isFinite))continue;const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len>20000)continue;const edge={a,b,type,unpaved,tags:way.tags,wayId:way.id};
   for(let k=0,n=Math.max(1,Math.ceil(len/40));k<=n;k++){const t=k/n,key=`${Math.floor((a[0]+(b[0]-a[0])*t)/cell)},${Math.floor((a[1]+(b[1]-a[1])*t)/cell)}`;if(!grid.has(key))grid.set(key,new Set());grid.get(key).add(edge);if(++count>1000000)throw Error('Trop de géométrie OSM.');}
  }
 }
 const runs=[],accessRuns=[],lengths=new Map();let current,accessCurrent;
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=distance(a,b),steps=Math.max(1,Math.ceil(len/25));for(let k=0;k<steps;k++){
  const start=interpolate(a,b,k/steps),end=interpolate(a,b,(k+1)/steps),mid=project(interpolate(start,end,.5),scale),x=Math.floor(mid[0]/cell),y=Math.floor(mid[1]/cell);let best=null,offset=20;
  const dx=(end[1]-start[1])*scale,dy=(end[0]-start[0])*111320,heading=Math.hypot(dx,dy);
  for(let gx=x-1;gx<=x+1;gx++)for(let gy=y-1;gy<=y+1;gy++)for(const edge of grid.get(`${gx},${gy}`)||[]){const ex=edge.b[0]-edge.a[0],ey=edge.b[1]-edge.a[1],norm=Math.hypot(ex,ey);if(heading&&norm&&Math.abs((dx*ex+dy*ey)/(heading*norm))<.7)continue;const d=projection(mid,edge.a,edge.b);if(d<offset){best=edge;offset=d;}}
  const type=best?.type||'Inconnu',unpaved=best?.unpaved??null;const direction=best&&(dx*(best.b[0]-best.a[0])+dy*(best.b[1]-best.a[1])<0)?'backward':'forward',access=best?bicycleAccess(best.tags,direction):null;if(access){if(accessCurrent?.label===access.label)accessCurrent.coordinates.push(end);else{accessCurrent={...access,coordinates:[start,end]};accessRuns.push(accessCurrent);}}else accessCurrent=null;lengths.set(type,(lengths.get(type)||0)+len/steps);
  if(current?.type===type&&current.unpaved===unpaved)current.coordinates.push(end);else{current={type,unpaved,coordinates:[start,end]};runs.push(current);}
 }}
 return {surfaceVersion:2,accessRuns,surfaceRuns:runs,surfaces:[...lengths].map(([type,distance])=>({type,distance:Math.round(distance*10)/10}))};
}
function corridor(path){
 const scale=111320*Math.max(.01,Math.cos(path[0][0]*Math.PI/180)),projected=path.map(p=>project(p,scale)),kept=new Set([0,path.length-1]),stack=[[0,path.length-1]];
 while(stack.length){const [a,b]=stack.pop();let best=8,index=-1;for(let i=a+1;i<b;i++){const d=projection(projected[i],projected[a],projected[b]);if(d>best){best=d;index=i;}}if(index>=0){kept.add(index);stack.push([a,index],[index,b]);}}
 const points=[...kept].sort((a,b)=>a-b).map(i=>path[i]);if(points.length>3000)throw Error('Tracé trop détaillé pour analyser le revêtement.');return points.map(p=>p.map(v=>v.toFixed(6)).join(',')).join(',');
}
export function createPlanMetrics({fetcher=(...args)=>fetch(...args),wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 const cache=new Map(),pending=new Map(),pointCache=new Map(),pointPending=new Map(),providers={osm:{queue:Promise.resolve(),last:-Infinity,backoff:0},elevation:{queue:Promise.resolve(),last:-Infinity,backoff:0}};let bytes=0,active=0;
 async function limited(provider,url,options={}){const state=providers[provider],job=state.queue.catch(()=>{}).then(async()=>{if(now()<state.backoff)throw Error('Service temporairement indisponible.');await wait(Math.max(0,1000-(now()-state.last)));state.last=now();try{const res=await fetcher(url,{...options,headers:{'User-Agent':'Sillage/6.4 (+https://sillage.gravelspa.be)',...options.headers},signal:AbortSignal.timeout(provider==='elevation'?12000:25000)});if(!res.ok)throw Error('Service cartographique indisponible.');let raw='';if(res.body?.getReader){const reader=res.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>20*1024*1024){await reader.cancel();throw Error('Réponse cartographique trop volumineuse.');}raw+=decoder.decode(r.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}else raw=await res.text();if(Buffer.byteLength(raw)>20*1024*1024)throw Error('Réponse cartographique trop volumineuse.');return JSON.parse(raw);}catch(e){state.backoff=now()+60000;throw e;}});state.queue=job.catch(()=>{});return job;}
 async function memo(scope,input,operation,retry=false){
  const key=scope+':'+createHash('sha256').update(JSON.stringify(input)).digest('hex');for(const[k,v]of cache)if(now()-v.time>(v.failed?60000:3600000)){cache.delete(k);bytes-=v.bytes;}if(cache.has(key)&&!(retry&&cache.get(key).failed))return cache.get(key).data;if(cache.has(key)){bytes-=cache.get(key).bytes;cache.delete(key);}if(pending.has(key))return pending.get(key);
  const job=(async()=>{const data=await operation(),size=Buffer.byteLength(JSON.stringify(data)),failed=Array.isArray(data)?data.some(d=>d.error):data.errors?.length;if(size<=16*1024*1024){while(cache.size&&(cache.size>=128||bytes+size>32*1024*1024)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bytes:size,time:now(),failed});bytes+=size;}return data;})();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 }
 function validPath(value){const path=coordinates(value);if(routeLength(path)>500000)throw Error('Analyse limitée à 500 km.');return path;}
 async function surface(path,retry){return memo('surface-v2',path,async()=>{try{const data=await limited('osm','https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:`[out:json][timeout:20];way(around:35,${corridor(path)})[highway];out body geom;`})});if(!Array.isArray(data.elements)||data.remark||data.elements.some(w=>w.tags?.highway&&!Array.isArray(w.geometry)))throw Error();return {...surfaceProfile(path,data.elements),errors:[]};}catch{if(now()>=providers.osm.backoff)providers.osm.backoff=now()+60000;return {surfaceVersion:2,accessRuns:[],surfaces:[{type:'Inconnu',distance:routeLength(path)}],surfaceRuns:[],errors:['Revêtements OSM indisponibles.']};}},retry);}
 async function elevations(input){
  if(!Array.isArray(input.paths)||input.paths.length<1||input.paths.length>199)throw Error('Analyse limitée à 199 portions.');const paths=input.paths.map(validPath);if(paths.reduce((n,p)=>n+p.length,0)>100200)throw Error('Itinéraire trop détaillé.');const lengths=paths.map(routeLength),total=lengths.reduce((n,m)=>n+m,0);if(total>500000||lengths.some(m=>m<1))throw Error('Analyse limitée à 500 km, avec des portions distinctes.');
  const desired=lengths.map(m=>Math.min(401,Math.max(2,Math.ceil(m/100)+1))),budget=4096,counts=desired.reduce((a,b)=>a+b,0)<=budget?desired:lengths.map(m=>Math.min(401,2+Math.floor((budget-2*paths.length)*m/total)));
  return memo('elevation-v2',{paths,counts},async()=>{
   for(const[k,v]of pointCache)if(now()-v.time>86400000)pointCache.delete(k);
   const samples=paths.map((p,i)=>samplePath(p,100,counts[i])),unique=new Map();for(const list of samples)for(const s of list){s.key=s.point.map(v=>v.toFixed(6)).join(',');if(!unique.has(s.key))unique.set(s.key,s.point);}
   let failure=null;const keys=[...unique.keys()];try{for(let i=0;i<keys.length;i+=100){const chunk=keys.slice(i,i+100),needed=chunk.filter(k=>!pointCache.has(k)&&!pointPending.has(k));if(needed.length){const url=new URL('https://api.open-meteo.com/v1/elevation');url.search=new URLSearchParams({latitude:needed.map(k=>unique.get(k)[0].toFixed(6)).join(','),longitude:needed.map(k=>unique.get(k)[1].toFixed(6)).join(',')});
     const job=(async()=>{const data=await limited('elevation',url.toString());if(!Array.isArray(data.elevation)||data.elevation.length!==needed.length||data.elevation.some(v=>!Number.isFinite(v)||v< -500||v>9000)){providers.elevation.backoff=now()+60000;throw Error('Altitudes incomplètes.');}needed.forEach((k,j)=>pointCache.set(k,{altitude:data.elevation[j],time:now()}));})();for(const k of needed)pointPending.set(k,job);try{await job;}finally{for(const k of needed)pointPending.delete(k);}}
     await Promise.all(chunk.filter(k=>pointPending.has(k)).map(k=>pointPending.get(k)));
   }}catch{failure='Altitudes indisponibles.';}
   const results=samples.map(list=>list.every(s=>pointCache.has(s.key))?{elevation:elevationProfile(list,list.map(s=>pointCache.get(s.key).altitude)),error:null}:{elevation:null,error:failure||'Altitudes indisponibles.'});while(pointCache.size>32768)pointCache.delete(pointCache.keys().next().value);return results;
  },input.retry===true);
 }
 async function guarded(operation){if(active>=4)throw Object.assign(Error('Analyse occupée. Réessayez dans un instant.'),{status:429});active++;try{return await operation();}finally{active--;}}
 const service=async input=>guarded(async()=>{const path=validPath(input.coordinates);if(input.kind==='surface')return surface(path,input.retry===true);if(input.kind!==undefined&&input.kind!=='all')throw Error('Type d’analyse invalide.');const [s,e]=await Promise.all([surface(path,input.retry===true),elevations({paths:[path],retry:input.retry})]);return {...s,elevation:e[0].elevation,errors:[...s.errors,...(e[0].error?[e[0].error]:[])]};});
 service.elevations=input=>guarded(()=>elevations(input));return service;
}
