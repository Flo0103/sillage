// Secteurs traversés par un itinéraire, complètement ou en partie, quel que soit le sens.
// Coordonnées [latitude, longitude]. Le calcul mesure la part de chaque secteur située à moins
// de `tolerance` mètres du tracé : l'ordre des points (le sens de parcours) n'intervient pas.
const R=6371008.8,RAD=Math.PI/180;
export const sectorCrossingDefaults=Object.freeze({tolerance:25,step:10,complete:.9,minPartial:100});
function projector(points){
 let lat=0;for(const p of points)lat+=p[0];lat/=points.length||1;const kx=R*RAD*Math.cos(lat*RAD),ky=R*RAD;
 return p=>[p[1]*kx,p[0]*ky];
}
function bounds(points,project,pad=0){
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){const [x,y]=project(p);if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
 return [x0-pad,y0-pad,x1+pad,y1+pad];
}
const WIDE=-1,cellKey=(x,y)=>(x+1048576)*2097152+y+1048576;
const overlaps=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
// Grille des segments du tracé pour trouver rapidement les segments proches d'un point.
function routeIndex(route,project,cell){
 const xy=route.map(project),along=[0],grid=new Map();
 for(let i=1;i<xy.length;i++)along.push(along[i-1]+Math.hypot(xy[i][0]-xy[i-1][0],xy[i][1]-xy[i-1][1]));
 for(let i=1;i<xy.length;i++){
  const a=xy[i-1],b=xy[i],cx0=Math.floor(Math.min(a[0],b[0])/cell),cx1=Math.floor(Math.max(a[0],b[0])/cell),cy0=Math.floor(Math.min(a[1],b[1])/cell),cy1=Math.floor(Math.max(a[1],b[1])/cell);
  if((cx1-cx0+1)*(cy1-cy0+1)>4096){if(!grid.has(WIDE))grid.set(WIDE,[]);grid.get(WIDE).push(i);continue;}
  for(let cx=cx0;cx<=cx1;cx++)for(let cy=cy0;cy<=cy1;cy++){const key=cellKey(cx,cy);let list=grid.get(key);if(!list)grid.set(key,list=[]);list.push(i);}
 }
 return {xy,along,grid,cell,seen:new Uint32Array(xy.length),stamp:0};
}
// Distance du point au tracé et position (en mètres depuis le départ) du point le plus proche.
function nearest(index,p,tolerance){
 const {xy,along,grid,cell,seen}=index,cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell),stamp=index.stamp=index.stamp+1>>>0||1;let best=Infinity,at=0;
 const visit=i=>{if(seen[i]===stamp)return;seen[i]=stamp;const a=xy[i-1],b=xy[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0,d=Math.hypot(a[0]+t*dx-p[0],a[1]+t*dy-p[1]);if(d<best){best=d;at=along[i-1]+t*(along[i]-along[i-1]);}};
 for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++){const list=grid.get(cellKey(x,y));if(list)for(const i of list)visit(i);}
 {const list=grid.get(WIDE);if(list)for(const i of list)visit(i);}
 return best<=tolerance?{distance:best,at}:null;
}
// Échantillonne le secteur tous les `step` mètres et additionne la longueur proche du tracé.
function coverage(sector,project,index,{tolerance,step}){
 const xy=sector.map(project);let total=0,covered=0,first=Infinity,last=-Infinity;
 const sample=p=>{const hit=nearest(index,p,tolerance);if(hit){if(hit.at<first)first=hit.at;if(hit.at>last)last=hit.at;}return hit;};
 let previous=sample(xy[0]);
 for(let i=1;i<xy.length;i++){
  const a=xy[i-1],b=xy[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(length/step));total+=length;
  for(let k=1;k<=n;k++){const t=k/n,hit=sample([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]),piece=length/n;if(hit&&previous)covered+=piece;else if(hit||previous)covered+=piece/2;previous=hit;}
 }
 return {total,covered:Math.min(total,covered),first,last};
}
const validPath=p=>Array.isArray(p)&&p.length>1&&p.every(q=>Array.isArray(q)&&Number.isFinite(q[0])&&Number.isFinite(q[1]));
/**
 * Liste les secteurs traversés par `route`.
 * Retourne, dans l'ordre de rencontre sur l'itinéraire :
 * {sector, kind:'complete'|'partial', ratio, covered, length, from, to}
 * - complete : au moins `complete` (90 %) du secteur suit l'itinéraire ;
 * - partial  : au moins `minPartial` mètres (ou tout le secteur s'il est plus court) suivent l'itinéraire.
 * from / to : distances en mètres sur l'itinéraire où le secteur commence et finit d'être suivi.
 */
export function crossedSectors(route,sectors,options={}){
 const o={...sectorCrossingDefaults,...options};if(!validPath(route)||!Array.isArray(sectors)||!sectors.length)return [];
 const project=projector(route),index=routeIndex(route,project,Math.max(50,o.tolerance*4)),area=bounds(route,project,o.tolerance),scale=index.along.at(-1)?realLength(route)/index.along.at(-1):1,out=[];
 for(const sector of sectors){
  if(!validPath(sector?.coordinates)||!overlaps(area,bounds(sector.coordinates,project)))continue;
  const c=coverage(sector.coordinates,project,index,o);if(!c.total||!c.covered)continue;
  const ratio=Math.min(1,c.covered/c.total),kind=ratio>=o.complete?'complete':c.covered>=Math.min(o.minPartial,o.complete*c.total)?'partial':null;if(!kind)continue;
  out.push({sector,kind,ratio,covered:c.covered,length:c.total,from:c.first*scale,to:c.last*scale});
 }
 return out.sort((a,b)=>a.from-b.from||b.ratio-a.ratio);
}
function realLength(p){let s=0;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],x=(b[0]-a[0])*RAD,y=(b[1]-a[1])*RAD,h=Math.sin(x/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(y/2)**2;s+=2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}return s;}
