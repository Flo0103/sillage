import {buildElevationModel} from './elevation.js?v=6.12.0';
import {routeLength} from './geo.js?v=6.12.0';
const metrics=new WeakMap();
const normalise=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('fr');
export function planLibraryStats(plan){
 const cached=metrics.get(plan);if(cached)return cached;
 const path=plan.coordinates||[],model=buildElevationModel(plan.legs||[]),value={distance:Number.isFinite(plan.distance)?plan.distance:routeLength(path),ascent:model.elevationLength>0?Math.round(model.ascent):null,start:path[0]||plan.legs?.[0]?.coordinates?.[0],end:path.at(-1)||plan.legs?.at(-1)?.coordinates?.at(-1),search:normalise([plan.name,plan.owner,plan.notes].join(' '))};metrics.set(plan,value);return value;
}
const limit=value=>value===null||value===undefined||String(value).trim()===''?null:Number.isFinite(Number(value))?Math.max(0,Number(value)):null;
export function filterPlans(plans,{scope='all',search='',distanceMin,distanceMax,ascentMin,ascentMax,mapFilter='all',bounds=null}={}){
 const words=normalise(search).trim().split(/\s+/).filter(Boolean),minKm=limit(distanceMin),maxKm=limit(distanceMax),minUp=limit(ascentMin),maxUp=limit(ascentMax);
 return plans.filter(p=>{
  if(scope==='mine'&&!p.isMine||scope==='others'&&p.isMine)return false;
  const stats=planLibraryStats(p);if(words.some(word=>!stats.search.includes(word)))return false;
  if(minKm!==null&&stats.distance<minKm*1000||maxKm!==null&&stats.distance>maxKm*1000)return false;
  if((minUp!==null||maxUp!==null)&&(stats.ascent===null||minUp!==null&&stats.ascent<minUp||maxUp!==null&&stats.ascent>maxUp))return false;
  if(mapFilter==='all')return true;
  const start=!!(bounds&&stats.start&&bounds.contains(stats.start)),end=!!(bounds&&stats.end&&bounds.contains(stats.end));
  return mapFilter==='start'?start:mapFilter==='end'?end:mapFilter==='both'?start&&end:start||end;
 });
}
