import {distance,routeLength} from './model.js';
import {createOSMService,validateBox} from './osm.js';
import {bicycleDirections,bicycleAccess,bicycleForbidden,surfaceInfo} from '../dist/osm-tags.js';
const tooLarge=()=>Object.assign(Error('Étape trop étendue pour le calcul OSM local. Ajoutez un point de passage.'),{code:'LOCAL_TOO_LARGE'});
const noPath=()=>Object.assign(Error('Aucune liaison vélo trouvée dans les chemins OSM chargés. Vérifiez les accès ou ajoutez un point de passage.'),{status:422,localNoPath:true});
export function routingBox(points,margin=650){const lat=points.reduce((n,p)=>n+p[0],0)/points.length,dy=margin/111320,dx=dy/Math.max(.01,Math.cos(lat*Math.PI/180)),box=[Math.min(...points.map(p=>p[0]))-dy,Math.min(...points.map(p=>p[1]))-dx,Math.max(...points.map(p=>p[0]))+dy,Math.max(...points.map(p=>p[1]))+dx];try{return validateBox(box);}catch{throw tooLarge();}}
// OSM snapshots are immutable. Prepared networks are bounded independently of the raw-data cache.
const networks=new Map();let preparedEdges=0;
const routeFactor=tags=>Math.max(tags.highway==='footway'||tags.highway==='pedestrian'?1.7:tags.highway==='primary'?1.5:1,tags.tracktype==='grade5'?1.5:tags.tracktype==='grade4'?1.25:1);
function arc(data,edge,from,to,direction){const meters=(from===edge.a&&to===edge.b||from===edge.b&&to===edge.a)?edge.meters:distance(data.nodes.get(from),data.nodes.get(to));return {to,cost:meters*edge.factor,meters,tags:edge.tags,direction,edge,access:direction==='forward'?edge.forwardAccess:edge.backwardAccess};}
export function prepareOSM(elements){
 if(networks.has(elements)){const entry=networks.get(elements);networks.delete(elements);networks.set(elements,entry);return entry;}
 const nodes=new Map(),edges=[],graph=new Map();
 for(const way of elements){
  if(!way.tags?.highway)continue;
  if(!Array.isArray(way.nodes)||!Array.isArray(way.geometry)||way.nodes.length!==way.geometry.length)throw Error('Géométrie OSM incomplète.');
  for(let i=0;i<way.nodes.length;i++){
   const p=way.geometry[i];if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
   const id=String(way.nodes[i]);nodes.set(id,[p.lat,p.lon]);
   if(i){const a=String(way.nodes[i-1]);if(!nodes.has(a))continue;if(a===id||distance(nodes.get(a),nodes.get(id))<.001)continue;edges.push({a,b:id,tags:way.tags,wayId:way.id,index:edges.length});}
   if(nodes.size>150000||edges.length>250000)throw Error('Zone OSM trop détaillée.');
  }
 }
 if(!edges.length)throw Object.assign(Error('Aucun chemin OSM disponible.'),{status:422,localNoPath:true});
 // Cache tag properties once per way, and components once per snapshot.
 const data={nodes,edges,graph,routes:new Map(),routeBytes:0},properties=new WeakMap(),parents=new Map();
 const root=id=>{let p=parents.get(id);if(p===undefined){parents.set(id,id);return id;}while(p!==parents.get(p))p=parents.get(p);let at=id;while(parents.get(at)!==p){const next=parents.get(at);parents.set(at,p);at=next;}return p;};
 for(const edge of edges){let info=properties.get(edge.tags);if(!info){const d=bicycleDirections(edge.tags);info={forward:d.forward&&!bicycleForbidden(edge.tags,'forward'),backward:d.backward&&!bicycleForbidden(edge.tags,'backward'),forwardAccess:bicycleAccess(edge.tags,'forward'),backwardAccess:bicycleAccess(edge.tags,'backward'),surface:surfaceInfo(edge.tags),factor:routeFactor(edge.tags)};properties.set(edge.tags,info);}Object.assign(edge,info);edge.meters=distance(nodes.get(edge.a),nodes.get(edge.b));
  edge.restricted=!!(edge.forward&&edge.forwardAccess||edge.backward&&edge.backwardAccess);if(edge.restricted){const a=root(edge.a),b=root(edge.b);if(a!==b)parents.set(a,b);}
  for(const [allowed,a,b,direction]of [[edge.forward,edge.a,edge.b,'forward'],[edge.backward,edge.b,edge.a,'backward']])if(allowed){if(!graph.has(a))graph.set(a,[]);graph.get(a).push(arc(data,edge,a,b,direction));}
 }
 for(const edge of edges)edge.component=edge.restricted?root(edge.a):null;
 data.index=spatialIndex(data);
 while(networks.size&&(networks.size>=4||preparedEdges+edges.length>250000)){const first=networks.keys().next().value;preparedEdges-=networks.get(first).edges.length;networks.delete(first);}
 networks.set(elements,data);preparedEdges+=edges.length;return data;
}
function spatialIndex(data){
 const scale=111320*Math.max(.01,Math.cos(data.nodes.values().next().value[0]*Math.PI/180)),cell=160,grid=new Map();let count=0;
 for(const edge of data.edges){const a=data.nodes.get(edge.a),b=data.nodes.get(edge.b),ax=a[1]*scale,ay=a[0]*111320,dx=(b[1]-a[1])*scale,dy=(b[0]-a[0])*111320,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/80));
  for(let i=0;i<=steps;i++){const key=`${Math.floor((ax+dx*i/steps)/cell)},${Math.floor((ay+dy*i/steps)/cell)}`;if(!grid.has(key))grid.set(key,new Set());const bucket=grid.get(key);if(!bucket.has(edge)){bucket.add(edge);if(++count>1000000)return null;}}
 }return {scale,cell,grid};
}
function project(point,a,b,sx){const sy=111320,dx=(b[1]-a[1])*sx,dy=(b[0]-a[0])*sy,qx=(point[1]-a[1])*sx,qy=(point[0]-a[0])*sy,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,(qx*dx+qy*dy)/den)):0;return {t,point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],offset:Math.hypot(qx-t*dx,qy-t*dy)};}
// All selectable ways share the same snap radius. Only the restricted component
// actually chosen by a control is authorised; public controls never unlock a
// nearby private shortcut. Bicycle bans remain excluded from selectable edges.
function closest(point,data,tolerance,accessMode='explicit'){
 let candidates=data.edges;
 if(data.index){const {scale,cell,grid}=data.index,x=point[1]*scale,y=point[0]*111320,radius=tolerance+100;const nearby=new Set();for(let i=Math.floor((x-radius)/cell);i<=Math.floor((x+radius)/cell);i++)for(let j=Math.floor((y-radius)/cell);j<=Math.floor((y+radius)/cell);j++)for(const e of grid.get(`${i},${j}`)||[])nearby.add(e);candidates=nearby;}
 let best=null,forbidden=false;const sx=111320*Math.max(.01,Math.cos(point[0]*Math.PI/180));
 for(const edge of candidates){const p=project(point,data.nodes.get(edge.a),data.nodes.get(edge.b),sx);if(p.offset>tolerance)continue;if(!edge.forward&&!edge.backward){if(p.offset<=5)forbidden=true;continue;}
  const delta=best?p.offset-best.offset:-Infinity,prefer=best&&(Number(edge.restricted)<Number(best.edge.restricted)||edge.restricted===best.edge.restricted&&edge.index<best.edge.index);if(!best||delta< -1e-7||Math.abs(delta)<=1e-7&&prefer)best={...p,edge};
 }
 if(forbidden&&(!best||best.offset>5))throw Object.assign(Error('Ce point est sur un chemin interdit aux vélos. Déplacez-le ou utilisez une correction manuelle.'),{status:422,localNoPath:true,bicycleForbidden:true});
 if(!best)throw Object.assign(Error('Point trop éloigné du réseau OSM. Déplacez-le.'),{status:422,localNoPath:true});return best;
}
// Split only edges containing controls. The rest of the directed graph is shared read-only.
function build(data,anchors){
 const extraNodes=new Map(),extraGraph=new Map(),controls=[],groups=new Map(),nodes={get:id=>extraNodes.get(id)||data.nodes.get(id)};
 for(const [i,anchor]of anchors.entries()){const edge=anchor.edge;if(!groups.has(edge))groups.set(edge,[]);groups.get(edge).push({i,anchor});}
 for(const [edge,items]of groups){const start=data.nodes.get(edge.a),end=data.nodes.get(edge.b),cuts=[{id:edge.a,t:0},{id:edge.b,t:1}];
  for(const {i,anchor}of items){let id;if(distance(anchor.point,start)<.01)id=edge.a;else if(distance(anchor.point,end)<.01)id=edge.b;else{const same=cuts.find(c=>c.id.startsWith('control:')&&distance(nodes.get(c.id),anchor.point)<.01);if(same)id=same.id;else{id='control:'+i;extraNodes.set(id,anchor.point);cuts.push({id,t:anchor.t});}}controls[i]=id;}
  for(const id of [edge.a,edge.b]){const previous=extraGraph.get(id)||data.graph.get(id)||[];extraGraph.set(id,previous.filter(a=>a.edge!==edge));}
  cuts.sort((a,b)=>a.t-b.t);
  for(let i=1;i<cuts.length;i++){const a=cuts[i-1].id,b=cuts[i].id;for(const [allowed,from,to,direction]of [[edge.forward,a,b,'forward'],[edge.backward,b,a,'backward']])if(allowed){if(!extraGraph.has(from))extraGraph.set(from,[]);extraGraph.get(from).push(arc({nodes},edge,from,to,direction));}}
 }
 return {nodes,controls,graph:{get:id=>extraGraph.has(id)?extraGraph.get(id):data.graph.get(id)}};
}
function pathBetween(data,start,end,components=null){if(start===end)throw Object.assign(Error('Les points rejoignent exactement le même endroit sur OSM.'),{status:422,localNoPath:true});const {nodes,graph}=data,ds=new Map([[start,0]]),prev=new Map(),heap=[[0,start,0]];
 const push=item=>{heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;}heap[i]=item;};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=last[0])break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;};
 while(heap.length){const[,id,cost]=pop();if(cost!==ds.get(id))continue;if(id===end){const steps=[];let at=end;while(at!==start){const p=prev.get(at);steps.push({from:p.from,to:at,...p.edge});at=p.from;}return steps.reverse();}for(const edge of graph.get(id)||[]){if(components&&edge.access&&!components.has(edge.edge.component))continue;const next=cost+edge.cost;if(next<(ds.get(edge.to)??Infinity)){ds.set(edge.to,next);prev.set(edge.to,{from:id,edge});push([next+distance(nodes.get(edge.to),nodes.get(end)),edge.to,next]);}}}throw noPath();
}
export function annotateSteps(steps,nodes){const surfaceRuns=[],accessRuns=[],lengths=new Map();let surface,access;for(const step of steps){const start=nodes.get(step.from),end=nodes.get(step.to),info=step.edge?.surface||surfaceInfo(step.tags),restricted=Object.hasOwn(step,'access')?step.access:bicycleAccess(step.tags,step.direction),meters=distance(start,end);lengths.set(info.type,(lengths.get(info.type)||0)+meters);if(surface?.type===info.type&&surface.unpaved===info.unpaved)surface.coordinates.push(end);else{surface={type:info.type,unpaved:info.unpaved,coordinates:[start,end]};surfaceRuns.push(surface);}if(restricted){if(access?.label===restricted.label)access.coordinates.push(end);else{access={...restricted,coordinates:[start,end]};accessRuns.push(access);}}else access=null;}return {surfaceVersion:2,surfaceRuns,accessRuns,surfaces:[...lengths].map(([type,distance])=>({type,distance})),errors:[]};}
export function routeOnOSM(points,elements,{tolerance=150,maxDistance=15000,accessMode='explicit'}={}){const data=prepareOSM(elements),key=JSON.stringify([points,tolerance,maxDistance,accessMode]);if(data.routes.has(key)){const saved=data.routes.get(key);data.routes.delete(key);data.routes.set(key,saved);return {...saved.result,cached:true};}const anchors=points.map(p=>closest(p,data,tolerance,accessMode)),components=accessMode==='explicit'?new Set(anchors.filter(a=>a.edge.component!==null).map(a=>a.edge.component)):null,network=build(data,anchors),steps=[],legLengths=[];for(let i=1;i<network.controls.length;i++){const part=pathBetween(network,network.controls[i-1],network.controls[i],components);for(const step of part)steps.push(step);legLengths.push(part.reduce((n,e)=>n+e.meters,0));}const path=[network.nodes.get(steps[0].from),...steps.map(e=>network.nodes.get(e.to))],length=routeLength(path);if(length>maxDistance)throw tooLarge();let at=0;const result={coordinates:path,snappedPoints:network.controls.map(id=>network.nodes.get(id)),legFractions:[0,...legLengths.map(m=>{at+=m;return at/length;})],analysis:annotateSteps(steps,network.nodes),stats:{maxOffset:Math.round(Math.max(...anchors.map(a=>a.offset))),ignoredAnchors:0,tolerance},engine:'OSM local · sens vélo',cached:false,accessPolicy:accessMode};const bytes=path.length*96+steps.length*64+JSON.stringify(points).length;if(bytes<=4*1024*1024){while(data.routes.size&&(data.routes.size>=64||data.routeBytes+bytes>4*1024*1024)){const first=data.routes.keys().next().value;data.routeBytes-=data.routes.get(first).bytes;data.routes.delete(first);}data.routes.set(key,{result,bytes});data.routeBytes+=bytes;}return result;}
export function createLocalRouting({osmService=createOSMService({mapFallback:true})}={}){
 const resultFor=(input,data)=>{const start=performance.now(),result=routeOnOSM(input.points,data.elements,input);return {...result,osmSource:data.source||'Overpass',timings:{readMs:data.cached?0:data.readMs??null,computeMs:Math.round((performance.now()-start)*100)/100,offline:data.offline===true}};};
 const fromCache=input=>{try{const data=osmService.peek?.(routingBox(input.points,Math.max(200,(input.tolerance??150)+50)));return data&&!data.then?resultFor(input,data):null;}catch{return null;}};
 const service=async input=>{
  const direct=routeLength(input.points);if(direct>15000)throw tooLarge();
  let best=null,bestLength=Infinity,lastError=null,noPathError=null;const seen=new Set(),enough=result=>routeLength(result.coordinates)<=direct*1.8+200;
  const consider=data=>{if(seen.has(data.elements))return null;seen.add(data.elements);try{const result=resultFor(input,data),length=routeLength(result.coordinates);if(length<bestLength){best=result;bestLength=length;}return result;}catch(e){lastError=e;if(e.localNoPath)noPathError=e;return null;}};
  const narrow=Math.max(200,(input.tolerance??150)+50);let cached=null;try{cached=await osmService.peek?.(routingBox(input.points,narrow),{inFlight:true});}catch{/* A failed warm-up must not block a new request. */}
  if(cached){const result=consider(cached);if(result&&(cached.bbox||enough(result)))return result;}
  // Small frames can use the bounded direct OSM fallback when Overpass is down.
  // Grow only when the network is disconnected or forces a substantial detour.
  for(const margin of [...new Set([narrow,650,1800])]){
   let box;try{box=routingBox(input.points,margin);}catch(e){lastError=e;continue;}
   try{const data=await (osmService.forRouting?osmService.forRouting(box):osmService(box)),result=consider(data);if(result)return result;}catch(e){lastError=e;break;}
  }
  if(best)return best;
  // Keep this failure distinct from an upstream outage. A caller may request a
  // wider guide, but must verify it on OSM rather than accept an unchecked path.
  if(noPathError)throw noPathError;
  throw lastError||noPath();
 };
 service.cached=fromCache;
 if(osmService.covers)service.offline=input=>osmService.covers(input.points);
 if(osmService.status)service.status=()=>osmService.status();
 // The public router supplies a search guide, never an unchecked result.
 // Rebuild a directed OSM graph around its nodes and apply exactly the same
 // bicycle bans, explicit access components and surface annotation as locally.
 if(osmService.forRoute)service.guided=async(input,guide)=>{
  const cached=fromCache(input);if(cached)return cached;
  const data=await osmService.forRoute({nodes:guide.osmNodes,points:input.points,coordinates:guide.coordinates});
  return {...resultFor(input,data),engine:'OSM vélo · accès vérifiés'};
 };
 service.nearest=async input=>{
  const tolerance=input.tolerance??150,required=routingBox([input.point],tolerance+25);let cached=null;try{cached=await osmService.peek?.(required,{inFlight:true});}catch{}const data=cached||await osmService(routingBox([input.point],Math.max(400,tolerance+100))),anchor=closest(input.point,prepareOSM(data.elements),tolerance,input.accessMode);
  return {point:anchor.point,offset:Math.round(anchor.offset),cached:data.cached===true,engine:data.offline?'OSM local':'OSM en ligne',osmSource:data.source||'Overpass',timings:{offline:data.offline===true}};
 };return service;
}
