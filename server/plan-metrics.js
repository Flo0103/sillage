import {createHash} from 'node:crypto';
import {coordinates,distance,routeLength} from './model.js';
const surfaceNames={asphalt:'Asphalte / bitume',bitumen:'Asphalte / bitume',concrete:'Béton','concrete:lanes':'Béton','concrete:plates':'Béton',fine_gravel:'Gravier fin',gravel:'Gravier',compacted:'Gravier compacté',dirt:'Terre',earth:'Terre',ground:'Terre',mud:'Boue',grass:'Herbe',grass_paver:'Dalles engazonnées',sand:'Sable',rock:'Roches',rocks:'Roches',pebblestone:'Pierres',cobblestone:'Pavés',unhewn_cobblestone:'Pavés',paving_stones:'Pavés',wood:'Bois',unpaved:'Non revêtu',paved:'Revêtu (non précisé)'};
const hard=new Set(['asphalt','bitumen','concrete','concrete:lanes','concrete:plates']);
const interpolate=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export function samplePath(path,spacing=60,max=401){
 const lengths=path.slice(1).map((p,i)=>distance(path[i],p)),total=lengths.reduce((n,x)=>n+x,0),count=Math.max(2,Math.min(max,Math.ceil(total/spacing)+1)),out=[];let index=0,at=0;
 for(let i=0;i<count;i++){const target=total*i/(count-1);while(index<lengths.length-1&&at+lengths[index]<target){at+=lengths[index++];}out.push({at:target,point:interpolate(path[index],path[index+1],lengths[index]?(target-at)/lengths[index]:0)});}return out;
}
export function elevationProfile(samples,values){
 if(values.length!==samples.length||values.some(v=>!Number.isFinite(v)||v< -500||v>9000))throw Error('Altitudes incomplètes.');
 // 3-point smoothing and a 3 m deadband avoid counting DEM noise as climbs.
 const smooth=values.map((v,i)=>i&&i<values.length-1?(values[i-1]+v+values[i+1])/3:v);let ascent=0,descent=0,anchor=smooth[0];
 for(let i=1;i<smooth.length;i++){const delta=smooth[i]-anchor;if(Math.abs(delta)>=3||i===smooth.length-1){if(delta>0)ascent+=delta;else descent-=delta;anchor=smooth[i];}}
 return {ascent:Math.round(ascent),descent:Math.round(descent),profile:samples.map((s,i)=>({at:Math.round(s.at*10)/10,altitude:Math.round(values[i]*10)/10})),spacing:Math.round(samples.at(-1).at/(samples.length-1)),source:'Open-Meteo · Copernicus DEM GLO-90'};
}
function project(p,scale){return [p[1]*scale,p[0]*111320];}
function projection(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
export function surfaceProfile(path,elements){
 const scale=111320*Math.max(.01,Math.cos(path[0][0]*Math.PI/180)),grid=new Map(),cell=60;let count=0;
 for(const way of elements){if(!way.tags?.highway||!way.geometry)continue;const tag=way.tags.surface,type=surfaceNames[tag]||'Inconnu',unpaved=type==='Inconnu'||tag==='paved'?null:!hard.has(tag);
  for(let i=1;i<way.geometry.length;i++){const a=project([way.geometry[i-1].lat,way.geometry[i-1].lon],scale),b=project([way.geometry[i].lat,way.geometry[i].lon],scale);if(![...a,...b].every(Number.isFinite))continue;const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len>20000)continue;const edge={a,b,type,unpaved};
   for(let k=0,n=Math.max(1,Math.ceil(len/40));k<=n;k++){const t=k/n,key=`${Math.floor((a[0]+(b[0]-a[0])*t)/cell)},${Math.floor((a[1]+(b[1]-a[1])*t)/cell)}`;if(!grid.has(key))grid.set(key,new Set());grid.get(key).add(edge);if(++count>1000000)throw Error('Trop de géométrie OSM.');}
  }
 }
 const runs=[],lengths=new Map();let current;
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=distance(a,b),steps=Math.max(1,Math.ceil(len/25));for(let k=0;k<steps;k++){
  const start=interpolate(a,b,k/steps),end=interpolate(a,b,(k+1)/steps),mid=project(interpolate(start,end,.5),scale),x=Math.floor(mid[0]/cell),y=Math.floor(mid[1]/cell);let best=null,offset=20;
  const dx=(end[1]-start[1])*scale,dy=(end[0]-start[0])*111320,heading=Math.hypot(dx,dy);
  for(let gx=x-1;gx<=x+1;gx++)for(let gy=y-1;gy<=y+1;gy++)for(const edge of grid.get(`${gx},${gy}`)||[]){const ex=edge.b[0]-edge.a[0],ey=edge.b[1]-edge.a[1],norm=Math.hypot(ex,ey);if(heading&&norm&&Math.abs((dx*ex+dy*ey)/(heading*norm))<.7)continue;const d=projection(mid,edge.a,edge.b);if(d<offset){best=edge;offset=d;}}
  const type=best?.type||'Inconnu',unpaved=best?.unpaved??null;lengths.set(type,(lengths.get(type)||0)+len/steps);
  if(current?.type===type&&current.unpaved===unpaved)current.coordinates.push(end);else{current={type,unpaved,coordinates:[start,end]};runs.push(current);}
 }}
 return {surfaceRuns:runs,surfaces:[...lengths].map(([type,distance])=>({type,distance:Math.round(distance*10)/10}))};
}
function corridor(path){
 const scale=111320*Math.max(.01,Math.cos(path[0][0]*Math.PI/180)),projected=path.map(p=>project(p,scale)),kept=new Set([0,path.length-1]),stack=[[0,path.length-1]];
 while(stack.length){const [a,b]=stack.pop();let best=8,index=-1;for(let i=a+1;i<b;i++){const d=projection(projected[i],projected[a],projected[b]);if(d>best){best=d;index=i;}}if(index>=0){kept.add(index);stack.push([a,index],[index,b]);}}
 const points=[...kept].sort((a,b)=>a-b).map(i=>path[i]);if(points.length>3000)throw Error('Tracé trop détaillé pour analyser le revêtement.');return points.map(p=>p.map(v=>v.toFixed(6)).join(',')).join(',');
}
export function createPlanMetrics({fetcher=(...args)=>fetch(...args),wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 const cache=new Map(),pending=new Map();let bytes=0,active=0,queue=Promise.resolve(),last=-Infinity,osmBackoff=0,elevationBackoff=0;
 async function limited(url,options={}){const job=queue.catch(()=>{}).then(async()=>{await wait(Math.max(0,1000-(now()-last)));last=now();const res=await fetcher(url,{...options,headers:{'User-Agent':'Sillage/6.1 (+https://sillage.gravelspa.be)',...options.headers},signal:AbortSignal.timeout(25000)});if(!res.ok)throw Error('Service cartographique indisponible.');let raw='';if(res.body?.getReader){const reader=res.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>20*1024*1024){await reader.cancel();throw Error('Réponse cartographique trop volumineuse.');}raw+=decoder.decode(r.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}else raw=await res.text();if(Buffer.byteLength(raw)>20*1024*1024)throw Error('Réponse cartographique trop volumineuse.');return JSON.parse(raw);});queue=job.catch(()=>{});return job;}
 return async input=>{
  const path=coordinates(input.coordinates);if(routeLength(path)>500000)throw Error('Analyse limitée à 500 km.');const key=createHash('sha256').update(JSON.stringify(path)).digest('hex');for(const[k,v]of cache)if(now()-v.time>(v.data.errors.length?60000:3600000)){cache.delete(k);bytes-=v.bytes;}if(cache.has(key)&&!(input.retry===true&&cache.get(key).data.errors.length))return cache.get(key).data;if(cache.has(key)){bytes-=cache.get(key).bytes;cache.delete(key);}if(pending.has(key))return pending.get(key);if(active>=4)throw Object.assign(Error('Analyse occupée. Réessayez dans un instant.'),{status:429});
  active++;const job=(async()=>{const errors=[];let elevation=null,surface={surfaces:[{type:'Inconnu',distance:routeLength(path)}],surfaceRuns:[]};
   try{if(now()<osmBackoff)throw Error();const data=await limited('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:`[out:json][timeout:20];way(around:35,${corridor(path)})[highway];out tags geom;`})});if(!Array.isArray(data.elements)||data.remark)throw Error();surface=surfaceProfile(path,data.elements);}catch{if(now()>=osmBackoff)osmBackoff=now()+60000;errors.push('Revêtements OSM indisponibles.');}
   try{if(now()<elevationBackoff)throw Error();const samples=samplePath(path),values=[];for(let i=0;i<samples.length;i+=100){const batch=samples.slice(i,i+100),url=new URL('https://api.open-meteo.com/v1/elevation');url.search=new URLSearchParams({latitude:batch.map(s=>s.point[0].toFixed(6)).join(','),longitude:batch.map(s=>s.point[1].toFixed(6)).join(',')});const result=await limited(url.toString());if(!Array.isArray(result.elevation))throw Error();values.push(...result.elevation);}elevation=elevationProfile(samples,values);}catch{if(now()>=elevationBackoff)elevationBackoff=now()+60000;errors.push('Altitudes indisponibles.');}
   const data={...surface,elevation,errors},size=Buffer.byteLength(JSON.stringify(data));if(size<=16*1024*1024){while(cache.size&&(cache.size>=128||bytes+size>32*1024*1024)){const k=cache.keys().next().value;bytes-=cache.get(k).bytes;cache.delete(k);}cache.set(key,{data,bytes:size,time:now()});bytes+=size;}return data;
  })();pending.set(key,job);try{return await job;}finally{active--;pending.delete(key);}
 };
}
