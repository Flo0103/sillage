import {bicycleDirections} from './osm-tags.js?v=6.9.0';
export const distance=(a,b)=>{const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r,h=Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2;return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};
export const routeLength=p=>p.slice(1).reduce((s,x,i)=>s+distance(p[i],x),0);
export function shortest(graph,start,end,nodes,{respectDirection=false}={}){
 const estimate=id=>nodes?distance(nodes.get(id),nodes.get(end)):0;
 const ds=new Map([[start,0]]),prev=new Map(),heap=[[estimate(start),start,0]];
 function push(v){heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=v[0])break;heap[i]=heap[p];i=p;}heap[i]=v;}
 function pop(){const v=heap[0],x=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=x[0])break;heap[i]=heap[j];i=j;}heap[i]=x;}return v;}
 while(heap.length){const[,u,d]=pop();if(d!==ds.get(u))continue;if(u===end){const path=[u];while(prev.has(path.at(-1)))path.push(prev.get(path.at(-1)));return path.reverse();}for(const[v,w,,allowed]of graph.get(u)||[]){if(respectDirection&&allowed===false)continue;const nd=d+w;if(nd<(ds.get(v)??Infinity)){ds.set(v,nd);prev.set(v,u);push([nd+estimate(v),v,nd]);}}}
 throw Error('Les chemins OSM ne sont pas reliés. Passez en mode manuel.');
}
const prepared=new WeakMap();
function prepare(elements,onProgress=()=>{}){
 if(prepared.has(elements))return prepared.get(elements);
 const nodes=new Map(),graph=new Map();
 const add=(id,p)=>{nodes.set(id,p);if(!graph.has(id))graph.set(id,[]);};
 const link=(a,b,tags)=>{const d=distance(nodes.get(a),nodes.get(b));if(a!==b){const {forward,backward}=bicycleDirections(tags);graph.get(a).push([b,d,tags,forward]);graph.get(b).push([a,d,tags,backward]);}};
 let processed=0;for(const way of elements){if((processed++%100)===0)onProgress({stage:'prepare',completed:processed-1,total:elements.length});if(!way.nodes||!way.geometry)continue;for(let i=0;i<way.nodes.length;i++){const p=way.geometry[i];if(!p)continue;add(way.nodes[i],[p.lat,p.lon]);if(i&&nodes.has(way.nodes[i-1])){const a=nodes.get(way.nodes[i-1]),b=nodes.get(way.nodes[i]),steps=Math.max(1,Math.ceil(distance(a,b)/35));if(steps>10000)throw Error('Géométrie OSM trop étendue. Réduisez la portion.');let last=way.nodes[i-1];for(let k=1;k<steps;k++){const id=`${way.id}:${i}:${k}`;add(id,[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps]);link(last,id,way.tags);last=id;}link(last,way.nodes[i],way.tags);}if(nodes.size>150000)throw Error('Trop de chemins dans cette zone. Réduisez la portion.');}}
 onProgress({stage:'prepare',completed:elements.length,total:elements.length});onProgress({stage:'index'});
 if(!nodes.size)throw Error('Aucun chemin OSM. Passez en mode manuel.');
 const components=new Map();let component=0;
 for(const id of nodes.keys())if(!components.has(id)){const stack=[id];components.set(id,component);while(stack.length){const u=stack.pop();for(const[v]of graph.get(u)){if(!components.has(v)){components.set(v,component);stack.push(v);}}}component++;}
 const lat=nodes.values().next().value[0],scaleX=111320*Math.max(.01,Math.cos(lat*Math.PI/180)),scaleY=111320,grid=new Map(),cell=100;
 for(const[id,p]of nodes){const x=p[1]*scaleX,y=p[0]*scaleY,key=`${Math.floor(x/cell)},${Math.floor(y/cell)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({id,x,y,component:components.get(id)});}
 function nearest(p,radius){const x=p[1]*scaleX,y=p[0]*scaleY,byComponent=new Map();for(let i=Math.floor((x-radius)/cell);i<=Math.floor((x+radius)/cell);i++)for(let j=Math.floor((y-radius)/cell);j<=Math.floor((y+radius)/cell);j++)for(const node of grid.get(`${i},${j}`)||[]){const d2=(node.x-x)**2+(node.y-y)**2;if(d2>radius*radius||d2>=(byComponent.get(node.component)?.d2??Infinity))continue;byComponent.set(node.component,{id:node.id,component:node.component,d2});}return byComponent;}
 const result={nodes,graph,nearest};prepared.set(elements,result);return result;
}
function sample(points,spacing){const anchors=[points[0]];let carry=0;for(let i=1;i<points.length;i++){let a=points[i-1];const b=points[i];let d=distance(a,b);while(d>0&&carry+d>=spacing){const t=(spacing-carry)/d,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];anchors.push(p);a=p;d=distance(a,b);carry=0;}carry+=d;}if(distance(anchors.at(-1),points.at(-1))>.1)anchors.push(points.at(-1));return anchors;}
export function matchOSMDetailed(original,elements,{tolerance=150,onProgress=()=>{}}={}){
 if(![75,150,250].includes(tolerance))throw Error('Tolérance invalide.');
 if(original.length<2)throw Error('Sélectionnez une portion.');
 const {nodes,graph,nearest}=prepare(elements,onProgress),anchors=sample(original,120),candidates=anchors.map(p=>nearest(p,tolerance));
 const choices=[];
 for(const component of candidates[0].keys())if(candidates.at(-1).has(component)){let coverage=0,error=0;for(const c of candidates){const n=c.get(component);if(n){coverage++;error+=n.d2;}}choices.push({component,coverage,error});}
 choices.sort((a,b)=>b.coverage-a.coverage||a.error-b.error);const chosen=choices[0];
 if(!chosen)throw Error('Départ et arrivée trop éloignés ou sur des chemins OSM non reliés. Essayez une tolérance supérieure ou le mode manuel.');
 const missed=anchors.length-chosen.coverage,allowed=tolerance===75?0:Math.max(1,Math.floor(anchors.length*.15));
 if(missed>allowed)throw Error('Trop de points sont éloignés du réseau OSM. Essayez une tolérance supérieure ou le mode manuel.');
 const ids=[],kept=[];let gap=0,maxOffset=0;
 for(let i=0;i<candidates.length;i++){const n=candidates[i].get(chosen.component);if(!n){gap++;if(gap>2)throw Error('Une trop longue partie de la trace manque dans OSM. Utilisez le mode manuel.');continue;}gap=0;maxOffset=Math.max(maxOffset,Math.sqrt(n.d2));if(kept.at(-1)!==n.id)kept.push(n.id);}
 onProgress({stage:'match',completed:0,total:kept.length});
 for(let i=0;i<kept.length;i++){if(!i)ids.push(kept[i]);else for(const id of shortest(graph,kept[i-1],kept[i],nodes).slice(1))ids.push(id);onProgress({stage:'match',completed:i+1,total:kept.length});}
 const result=ids.map(id=>nodes.get(id)),meters=routeLength(result),originalMeters=routeLength(original),detour=tolerance===75?1.6:1.8;
 if(result.length<2||meters>originalMeters*detour+200)throw Error('Le tracé OSM fait un détour trop important. Passez en mode manuel.');
 return {coordinates:result,surface:surfaceAlong(ids,graph),stats:{ignoredAnchors:missed,maxOffset:Math.round(maxOffset),tolerance}};
}
export function matchOSM(original,elements,options){return matchOSMDetailed(original,elements,options).coordinates;}
export function selectionBounds(points,tolerance=150){let s=90,w=180,n=-90,e=-180;for(const p of points){s=Math.min(s,p[0]);n=Math.max(n,p[0]);w=Math.min(w,p[1]);e=Math.max(e,p[1]);}const margin=tolerance+80,lat=margin/111320,lon=lat/Math.max(.01,Math.cos((s+n)/2*Math.PI/180));return [Math.max(-90,s-lat),Math.max(-180,w-lon),Math.min(90,n+lat),Math.min(180,e+lon)];}

// OSM surface values are hints; an untagged way never becomes a guessed surface.
const osmSurfaces={fine_gravel:'Gravier fin',gravel:'Gravier fin',compacted:'Gravier fin',dirt:'Chemin de terre',earth:'Chemin de terre',ground:'Chemin de terre',mud:'Chemin de terre',grass:'Chemin de terre',pebblestone:'Cailloux / pierres',cobblestone:'Cailloux / pierres',unhewn_cobblestone:'Cailloux / pierres',rock:'Grosses pierres / blocs',rocks:'Grosses pierres / blocs',sand:'Sable',asphalt:'Asphalte',concrete:'Asphalte','concrete:plates':'Asphalte',paved:'Asphalte',paving_stones:'Asphalte'};
function surfaceAlong(ids,graph){
 const lengths=new Map();let total=0,known=0;
 for(let i=1;i<ids.length;i++){const edge=graph.get(ids[i-1]).find(e=>e[0]===ids[i]);if(!edge)continue;const [,meters,tags]=edge,type=osmSurfaces[tags?.surface];total+=meters;if(type){known+=meters;lengths.set(type,(lengths.get(type)||0)+meters);}}
 if(!total||known/total<.5)return null;
 const [type,meters]=[...lengths].sort((a,b)=>b[1]-a[1])[0];return {type:meters/known>=.6?type:'Mixte',coverage:Math.round(100*known/total)};
}
export function routeOSM(original,elements,{tolerance=150,onProgress=()=>{}}={}){
 if(original.length<2)throw Error('Choisissez deux points.');
 if(![75,150,250].includes(tolerance))throw Error('Tolérance invalide.');
 const {nodes,graph,nearest}=prepare(elements,onProgress),a=nearest(original[0],tolerance),b=nearest(original.at(-1),tolerance);
 const pairs=[...a.values()].filter(p=>b.has(p.component)).sort((p,q)=>p.d2+b.get(p.component).d2-q.d2-b.get(q.component).d2),start=pairs[0];
 if(!start)throw Error('Départ et arrivée sans chemin OSM relié dans cette zone. Essayez une plus grande tolérance ou le mode manuel.');
 const end=b.get(start.component);onProgress({stage:'route'});const ids=shortest(graph,start.id,end.id,nodes,{respectDirection:true}),points=ids.map(id=>nodes.get(id));
 if(points.length<2)throw Error('Départ et arrivée trop proches sur le même chemin.');
 if(routeLength(points)>15000)throw Error('Routage limité à 15 km. Réduisez la portion.');
 return {coordinates:points,surface:surfaceAlong(ids,graph),stats:{ignoredAnchors:0,maxOffset:Math.round(Math.sqrt(Math.max(start.d2,end.d2))),tolerance}};
}
