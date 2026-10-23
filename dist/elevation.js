import {smoothElevation,elevationGain} from './elevation-data.js?v=6.3.0';
import {distance,routeLength} from './geo.js';
export const elevationColors=['#31584a','#598661','#8b9c55','#b5a052','#bd8150','#a95c4b','#77434e'];
export const slopeBins=[[-Infinity,-10,'< −10 %','#446f99'],[-10,-5,'−10 à −5 %','#6598b3'],[-5,-2,'−5 à −2 %','#83aaa6'],[-2,2,'−2 à +2 %','#81945a'],[2,5,'+2 à +5 %','#c3a04f'],[5,10,'+5 à +10 %','#bc7950'],[10,Infinity,'> +10 %','#9f4850']];
export const routeSurfaceColors={'Asphalte / bitume':'#3c5447','Béton':'#788187','Gravier fin':'#d6b36d','Gravier':'#bf9845','Gravier compacté':'#aca263','Terre':'#986b48','Boue':'#6f4d3b','Herbe':'#78884d','Dalles engazonnées':'#99a26a','Sable':'#d5ba65','Roches':'#7a658b','Pierres':'#9a8280','Pavés':'#827e8e','Bois':'#9f7855','Non revêtu':'#b6845a','Revêtu (non précisé)':'#677c79','Inconnu':'#9b9b91'};
function locate(values,target,key=v=>v){let lo=0,hi=values.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(key(values[mid])<=target)lo=mid;else hi=mid-1;}return lo;}
const modelCache=new WeakMap();
export function buildElevationModel(legs){
 const signature=legs.map(l=>[l.coordinates,l.analysis?.elevation?.profile]),cached=modelCache.get(legs);if(cached&&cached.signature.length===signature.length&&signature.every((v,i)=>v[0]===cached.signature[i][0]&&v[1]===cached.signature[i][1]))return cached.model;
 const points=[],distances=[],rawSpans=[];let total=0;
 for(const l of legs){const path=l.coordinates||[];if(path.length<2)continue;const start=total;for(let i=0;i<path.length;i++){if(i)total+=distance(path[i-1],path[i]);if(!points.length||i){points.push(path[i]);distances.push(total);}}
  const p=l.analysis?.elevation?.profile;if(p?.length>=2){const profile=p.filter(v=>Number.isFinite(v.at)&&Number.isFinite(v.altitude)&&v.at>=0&&v.at<=total-start+1).map(v=>({at:start+Math.min(total-start,v.at),altitude:v.altitude}));if(profile.length>=2)rawSpans.push({start:profile[0].at,end:profile.at(-1).at,profile});}
 }
 const spans=[];for(const next of rawSpans){const previous=spans.at(-1);if(previous&&Math.abs(previous.end-next.start)<=.2){const shared=previous.profile.at(-1);shared.altitude=(shared.altitude+next.profile[0].altitude)/2;previous.profile.push(...next.profile.slice(1));previous.end=next.end;}else spans.push({...next,profile:next.profile.map(p=>({...p}))});}
 let ascent=0,descent=0,min=null,max=null,elevationLength=0;for(const span of spans){span.profile=smoothElevation(span.profile);const gain=elevationGain(span.profile);ascent+=gain.ascent;descent+=gain.descent;elevationLength+=span.end-span.start;for(const p of span.profile){min=min===null?p.altitude:Math.min(min,p.altitude);max=max===null?p.altitude:Math.max(max,p.altitude);}}
 const model={points,distances,spans,total,min,max,ascent,descent,elevationLength};modelCache.set(legs,{signature,model});return model;
}
export function pointAtDistance(model,value){if(!model.points.length)return null;const at=Math.max(0,Math.min(model.total,value)),i=Math.min(model.points.length-2,locate(model.distances,at));if(i<0)return model.points[0];const a=model.points[i],b=model.points[i+1],length=model.distances[i+1]-model.distances[i],t=length?(at-model.distances[i])/length:0;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}
function spanAt(model,at){if(!model.spans.length)return null;const i=locate(model.spans,at,s=>s.start),span=model.spans[i];return at>=span.start-.01&&at<=span.end+.01?span:null;}
function height(span,at){const p=span.profile,i=Math.min(p.length-2,locate(p,at,s=>s.at)),a=p[i],b=p[i+1],t=b.at>a.at?Math.max(0,Math.min(1,(at-a.at)/(b.at-a.at))):0;return a.altitude+(b.altitude-a.altitude)*t;}
export function elevationAt(model,at){const span=spanAt(model,at);return span?height(span,at):null;}
export function slopeAt(model,at){const span=spanAt(model,at);if(!span)return null;const a=Math.max(span.start,at-75),b=Math.min(span.end,at+75);return b-a>=5?100*(height(span,b)-height(span,a))/(b-a):null;}
export function elevationColor(value,model){if(value===null||model.min===null)return '#9b9b91';const fraction=(value-model.min)/Math.max(1,model.max-model.min);return elevationColors[Math.max(0,Math.min(elevationColors.length-1,Math.floor(fraction*elevationColors.length)))];}
export function slopeColor(value){return value===null?'#9b9b91':(slopeBins.find(([a,b])=>value>=a&&value<b)||slopeBins.at(-1))[3];}
export function routeRenderRuns(legs,mode,model){
 const result=[];let offset=0;
 for(const l of legs){const path=l.coordinates||[];if(path.length<2)continue;const runs=l.analysis?.surfaceRuns?.length?l.analysis.surfaceRuns:[{coordinates:path,type:'Inconnu',unpaved:null}];let runOffset=offset;
  for(const run of runs){const dash=run.unpaved===true?'7 7':null;
   if(mode!=='altitude'&&mode!=='slope'){result.push({coordinates:run.coordinates,color:mode==='surface'?routeSurfaceColors[run.type]||routeSurfaceColors.Inconnu:'#b5654c',dashArray:dash});runOffset+=routeLength(run.coordinates);continue;}
   for(let i=1;i<run.coordinates.length;i++){const a=run.coordinates[i-1],b=run.coordinates[i],len=distance(a,b),steps=Math.max(1,Math.ceil(len/75));for(let k=0;k<steps;k++){const f=k/steps,t=(k+1)/steps,start=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],end=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],at=runOffset+len*(k+.5)/steps,color=mode==='altitude'?elevationColor(elevationAt(model,at),model):slopeColor(slopeAt(model,at)),last=result.at(-1);if(last&&last.color===color&&last.dashArray===dash&&distance(last.coordinates.at(-1),start)<.05)last.coordinates.push(end);else result.push({coordinates:[start,end],color,dashArray:dash});}runOffset+=len;}
  }offset+=routeLength(path);
 }
 return result;
}
export function kilometreMarkers(model,zoom){const interval=zoom>=14?1000:zoom>=12?5000:zoom>=10?10000:0;if(!interval)return [];const markers=[];for(let at=interval;at<model.total;at+=interval)markers.push({at,km:at/1000,point:pointAtDistance(model,at)});return markers;}
const chartStates=new WeakMap();
export function chartSamples(profile,limit){if(profile.length<=limit)return profile;const buckets=Math.max(1,Math.floor((limit-2)/2)),out=[profile[0]],step=(profile.length-2)/buckets;for(let i=0;i<buckets;i++){const start=1+Math.floor(i*step),end=1+Math.floor((i+1)*step);let low=start,high=start;for(let j=start+1;j<end;j++){if(profile[j].altitude<profile[low].altitude)low=j;if(profile[j].altitude>profile[high].altitude)high=j;}if(low===high)out.push(profile[low]);else for(const j of [low,high].sort((a,b)=>a-b))out.push(profile[j]);}out.push(profile.at(-1));return out;}
export function chartGeometry(model,compact=false){
 const width=800,height=compact?100:170,left=compact?8:54,right=compact?8:18,top=12,bottom=compact?8:30,base=height-bottom,range=Math.max(20,(model.max??0)-(model.min??0)),low=(model.min??0)-range*.08,high=(model.max??0)+range*.08,y=h=>base-(h-low)/(high-low)*(base-top),x=at=>left+at/Math.max(1,model.total)*(width-left-right);
 const budget=compact?320:1200,lines=model.spans.map(s=>chartSamples(s.profile,Math.max(4,Math.floor(budget*s.profile.length/Math.max(1,model.spans.reduce((n,s)=>n+s.profile.length,0))))).map((p,i)=>`${i?'L':'M'}${x(p.at).toFixed(2)},${y(p.altitude).toFixed(2)}`).join(' ')),areas=model.spans.map((s,i)=>`${lines[i]} L${x(s.end).toFixed(2)},${base} L${x(s.start).toFixed(2)},${base} Z`);
 return {width,height,left,right,base,x,y,low,high,lines,areas};
}
export function renderElevationChart(container,model,{compact=false,onSeek}={}){
 if(!container)return;chartStates.delete(container);container.replaceChildren();if(model.min===null||!model.total){const empty=document.createElement('p');empty.className='quiet elevation-empty';empty.textContent='Profil d’élévation indisponible';container.append(empty);return;}
 const g=chartGeometry(model,compact),labels=compact?'':`<text x="8" y="18">${Math.round(model.max)} m</text><text x="8" y="${g.base}">${Math.round(model.min)} m</text><text x="${g.left}" y="${g.height-5}">0 km</text><text text-anchor="end" x="${g.width-g.right}" y="${g.height-5}">${(model.total/1000).toFixed(1)} km</text>`;
 container.innerHTML=`<svg class="elevation-chart${compact?' compact':''}" viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="none" role="img" aria-label="Profil d’élévation estimé, distance en kilomètres et altitude en mètres">${g.areas.map(d=>`<path class="elevation-area" d="${d}"/>`).join('')}${g.lines.map(d=>`<path class="elevation-line" d="${d}"/>`).join('')}${labels}<line class="profile-cursor" x1="0" x2="0" y1="${g.base}" y2="12" visibility="hidden"/><circle class="profile-dot" r="4" visibility="hidden"/></svg>`;
 const svg=container.querySelector?.('svg');chartStates.set(container,{model,g,svg});if(!svg||!onSeek)return;
 const seek=e=>{const rect=svg.getBoundingClientRect();if(!rect.width)return;const x=(e.clientX-rect.left)/rect.width*g.width;onSeek(Math.max(0,Math.min(model.total,(x-g.left)/(g.width-g.left-g.right)*model.total)));};
 svg.addEventListener('pointermove',seek);svg.addEventListener('pointerdown',e=>{seek(e);if(e.pointerType==='touch')svg.setPointerCapture?.(e.pointerId);});
}
export function setChartCursor(container,at){const s=chartStates.get(container);if(!s?.svg)return;const altitude=elevationAt(s.model,at),line=s.svg.querySelector('.profile-cursor'),dot=s.svg.querySelector('.profile-dot');line.setAttribute('visibility',at===null?'hidden':'visible');dot.setAttribute('visibility',at===null||altitude===null?'hidden':'visible');if(at===null)return;const x=s.g.x(at);line.setAttribute('x1',x);line.setAttribute('x2',x);if(altitude!==null){dot.setAttribute('cx',x);dot.setAttribute('cy',s.g.y(altitude));}}
