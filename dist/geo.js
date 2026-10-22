export const distance=(a,b)=>{const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r,h=Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2;return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};
export const routeLength=p=>p.slice(1).reduce((s,x,i)=>s+distance(p[i],x),0);
export function shortest(graph,start,end){
 const ds=new Map([[start,0]]),prev=new Map(),heap=[[0,start]];
 function push(v){heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=v[0])break;heap[i]=heap[p];i=p;}heap[i]=v;}
 function pop(){const v=heap[0],x=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=x[0])break;heap[i]=heap[j];i=j;}heap[i]=x;}return v;}
 while(heap.length){const[d,u]=pop();if(d!==ds.get(u))continue;if(u===end){const path=[u];while(prev.has(path.at(-1)))path.push(prev.get(path.at(-1)));return path.reverse();}for(const[v,w]of graph.get(u)||[]){const nd=d+w;if(nd<(ds.get(v)??Infinity)){ds.set(v,nd);prev.set(v,u);push([nd,v]);}}}
 throw Error('Les chemins OSM ne sont pas reliés. Passez en mode manuel.');
}
export function matchOSM(original,elements){
 const nodes=new Map(),graph=new Map();
 const add=(id,p)=>{nodes.set(id,p);if(!graph.has(id))graph.set(id,[]);};
 const link=(a,b)=>{const d=distance(nodes.get(a),nodes.get(b));graph.get(a).push([b,d]);graph.get(b).push([a,d]);};
 for(const way of elements){if(!way.nodes||!way.geometry)continue;for(let i=0;i<way.nodes.length;i++){const p=way.geometry[i];if(!p)continue;add(way.nodes[i],[p.lat,p.lon]);if(i&&nodes.has(way.nodes[i-1])){const a=nodes.get(way.nodes[i-1]),b=nodes.get(way.nodes[i]),steps=Math.max(1,Math.ceil(distance(a,b)/40));let last=way.nodes[i-1];for(let k=1;k<steps;k++){const id=`${way.id}:${i}:${k}`;add(id,[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps]);link(last,id);last=id;}link(last,way.nodes[i]);}}if(nodes.size>150000)throw Error('Trop de chemins dans cette zone. Réduisez la portion.');}
 if(!nodes.size)throw Error('Aucun chemin OSM. Passez en mode manuel.');
 const anchors=[original[0]];let carry=0;
 for(let i=1;i<original.length;i++){let a=original[i-1];const b=original[i];let d=distance(a,b);while(carry+d>=120){const t=(120-carry)/d;const p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];anchors.push(p);a=p;d=distance(a,b);carry=0;}carry+=d;}
 anchors.push(original.at(-1));
 const nearest=anchors.map(p=>{let id,best=Infinity;for(const[k,v]of nodes){const d=distance(p,v);if(d<best){id=k;best=d;}}if(best>100)throw Error('La trace est trop éloignée des chemins OSM. Passez en mode manuel.');return id;});
 const ids=[nearest[0]];for(let i=1;i<nearest.length;i++)ids.push(...shortest(graph,nearest[i-1],nearest[i]).slice(1));
 const result=ids.map(id=>nodes.get(id));if(result.length<2||routeLength(result)>routeLength(original)*1.6+200)throw Error('Le tracé OSM fait un détour trop important. Passez en mode manuel.');return result;
}
