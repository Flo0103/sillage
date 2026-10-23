import {buildElevationModel} from './elevation.js?v=6.7.0';
import {distance,routeLength} from './geo.js?v=6.7.0';
import {routePosition} from './route-edit.js';
let serial=0;
const point=p=>[...p];
const leg=(mode,coordinates=null)=>({id:++serial,mode,coordinates,analysis:null});
// Edges are immutable: snapshots share their geometry, not mutable arrays.
export class ItineraryDraft{
 constructor(){this.points=[];this.legs=[];this.past=[];this.future=[];this.context=null;}
 snapshot(){return {points:this.points.map(point),legs:this.legs.slice(),context:this.context};}
 remember(){this.past.push(this.snapshot());if(this.past.length>60)this.past.shift();this.future=[];}
 restore(state){this.points=state.points.map(point);this.legs=state.legs.slice();this.context=state.context??null;}
 undo(){if(!this.past.length)return false;this.future.push(this.snapshot());this.restore(this.past.pop());return true;}
 redo(){if(!this.future.length)return false;this.past.push(this.snapshot());this.restore(this.future.pop());return true;}
 append(p,mode='route'){if(this.points.length&&distance(this.points.at(-1),p)<(mode==='route'?5:2))throw Error('Choisissez un point un peu plus éloigné.');if(this.points.length>=200)throw Error('Maximum 200 points par itinéraire.');this.remember();if(this.points.length)this.legs.push(leg(mode,mode==='manual'?[point(this.points.at(-1)),point(p)]:null));this.points.push(point(p));}
 move(index,p){if(!this.points[index])return;for(const other of [this.points[index-1],this.points[index+1]])if(other&&distance(other,p)<2)throw Error('Les points doivent être distincts.');this.remember();this.points[index]=point(p);for(const i of [index-1,index])if(this.legs[i])this.legs[i]=leg(this.legs[i].mode,this.legs[i].mode==='manual'?[point(this.points[i]),point(this.points[i+1])]:null);}
 insert(index,p,manual=false){if(index<1||index>=this.points.length)return;if(distance(this.points[index-1],p)<2||distance(this.points[index],p)<2)throw Error('Éloignez le nouveau point de ses voisins.');if(this.points.length>=200)throw Error('Maximum 200 points par itinéraire.');this.remember();const outgoing=this.legs[index-1].mode,mode=manual?'manual':outgoing;this.points.splice(index,0,point(p));this.legs.splice(index-1,1,leg(mode,mode==='manual'?[point(this.points[index-1]),point(p)]:null),leg(outgoing,outgoing==='manual'?[point(p),point(this.points[index+1])]:null));}
 clear(context=null){this.remember();this.points=[];this.legs=[];this.context=context;}
 setIncomingMode(index,mode){if(index<=0||index>=this.points.length||!['manual','route'].includes(mode)||this.legs[index-1].mode===mode)return false;this.remember();this.legs[index-1]=leg(mode,mode==='manual'?[point(this.points[index-1]),point(this.points[index])]:null);return true;}
 remove(index){if(index<0||index>=this.points.length)return;this.remember();if(index===0)this.legs.shift();else if(index===this.points.length-1)this.legs.pop();else{const mode=this.legs[index-1].mode==='manual'||this.legs[index].mode==='manual'?'manual':'route';this.legs.splice(index-1,2,leg(mode,mode==='manual'?[point(this.points[index-1]),point(this.points[index+1])]:null));}this.points.splice(index,1);}
 resolve(id,result){const i=this.legs.findIndex(l=>l.id===id);if(i<0)return false;const old=this.legs[i];if(old.coordinates)return false;const path=result.coordinates.map(point);if(path.length<2)return false;
  // A completed neighbouring leg stays byte-for-byte intact when extending a route.
  if(!this.legs[i-1]?.coordinates)this.points[i]=point(path[0]);
  if(!this.legs[i+1]?.coordinates)this.points[i+1]=point(path.at(-1));
  if(this.points[i].some((v,k)=>v!==path[0][k]))path.unshift(point(this.points[i]));
  if(this.points[i+1].some((v,k)=>v!==path.at(-1)[k]))path.push(point(this.points[i+1]));
  this.legs[i]={...old,coordinates:path,analysis:result.analysis||old.analysis,routingWarning:result.warning||null};return true;
 }
 analyse(id,analysis){const i=this.legs.findIndex(l=>l.id===id);if(i<0)return false;this.legs[i]={...this.legs[i],analysis};return true;}
 coordinates(){const out=[];for(let i=0;i<this.legs.length;i++){const p=this.legs[i].coordinates||[this.points[i],this.points[i+1]];for(let k=out.length?1:0;k<p.length;k++)out.push(p[k]);}return out.length?out:this.points.map(point);}
 complete(){return this.points.length>=2&&this.legs.every(l=>l.coordinates);}
 fractions(){const lengths=this.legs.map((l,i)=>routeLength(l.coordinates||[this.points[i],this.points[i+1]])),sum=lengths.reduce((n,x)=>n+x,0);let acc=0;return [0,...lengths.map(n=>{acc+=n;return sum?acc/sum:0;})];}
 load(data){this.past=[];this.future=[];
  if(data.legs?.length){this.legs=data.legs.map(l=>({...leg(l.mode,l.coordinates.map(point)),analysis:l.analysis||null}));this.points=[point(this.legs[0].coordinates[0]),...this.legs.map(l=>point(l.coordinates.at(-1)))];return;}
  const path=data.coordinates,controls=data.routePoints?.length?data.routePoints:data.mode==='manual'&&path.length<=200?path:[path[0],path.at(-1)];this.points=controls.map(point);const total=routeLength(path),cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative.at(-1)+distance(path[i-1],path[i]));let previous=0;
  this.legs=[];for(let i=1;i<controls.length;i++){let end=path.length-1;if(i<controls.length-1){const target=routePosition(path,controls[i],total?cumulative[previous]/total:0)*total;end=previous;while(end<path.length-1&&cumulative[end]<target)end++;}const section=[point(controls[i-1]),...path.slice(previous+1,end).map(point),point(controls[i])];this.legs.push(leg(data.mode==='manual'?'manual':'route',section));previous=end;}
 }
 serialise(){return this.legs.map(({mode,coordinates,analysis})=>({mode,coordinates,analysis}));}
}
export function planSummary(legs){
 const model=buildElevationModel(legs);let total=model.total,known=0;const surfaces={};let failures=0;
 for(const l of legs){const a=l.analysis;if(!a)continue;for(const s of a.surfaces||[]){surfaces[s.type]=(surfaces[s.type]||0)+s.distance;if(s.type!=='Inconnu')known+=s.distance;}if(a.errors?.length)failures++;}
 return {ascent:model.ascent,descent:model.descent,elevationCoverage:total?Math.min(100,Math.round(100*model.elevationLength/total)):0,surfaceCoverage:total?Math.min(100,Math.round(100*known/total)):0,surfaces,total,failures};
}
