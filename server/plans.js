import {elevationData} from './profile-data.js';
import {buildElevationModel,elevationAt} from '../dist/elevation.js';
import {randomUUID} from 'node:crypto';
import {coordinates,routeLength,distance} from './model.js';
import {importedRideLegs} from '../dist/planner.js';
import {withRideOrigins} from './ride-links.js';
function analysisData(a,path){
 if(!a||typeof a!=='object')return null;const finite=v=>Number.isFinite(v)&&v>=0,limit=routeLength(path)+10;
 const surfaces=Array.isArray(a.surfaces)&&a.surfaces.length<=50?a.surfaces.filter(s=>typeof s.type==='string'&&s.type.length<=50&&finite(s.distance)&&s.distance<=limit).map(s=>({type:s.type,distance:s.distance})):[];
 const surfaceRuns=Array.isArray(a.surfaceRuns)&&a.surfaceRuns.length<=25000?a.surfaceRuns.map(s=>{if(typeof s.type!=='string'||s.type.length>50||![true,false,null].includes(s.unpaved))throw Error('Revêtement invalide.');return {type:s.type,unpaved:s.unpaved,coordinates:coordinates(s.coordinates)};}):[];
 const accessRuns=Array.isArray(a.accessRuns)&&a.accessRuns.length<=25000?a.accessRuns.map(s=>{if(typeof s.label!=='string'||!s.label.trim()||s.label.length>200)throw Error('Accès invalide.');return {label:s.label,coordinates:coordinates(s.coordinates)};}):[];
 const elevation=elevationData(a.elevation,routeLength(path));
 return {surfaces,surfaceRuns,accessRuns,...(a.surfaceVersion===2?{surfaceVersion:2}:{}),...(Object.hasOwn(a,'elevation')?{elevation}:{}),errors:Array.isArray(a.errors)?a.errors.filter(s=>typeof s==='string').slice(0,2).map(s=>s.slice(0,100)):[]};
}
export function planData(body){
 let points=coordinates(body.coordinates),mode=body.mode==='manual'?'manual':'route',legs;
 if(body.legs!==undefined){if(!Array.isArray(body.legs)||body.legs.length<1||body.legs.length>199)throw Error('Itinéraire limité à 200 points.');let count=0;legs=body.legs.map(l=>{const path=coordinates(l.coordinates);count+=path.length;if(count>100200)throw Error('Itinéraire trop détaillé.');if(!['route','manual'].includes(l.mode))throw Error('Mode de portion invalide.');return {mode:l.mode,coordinates:path,analysis:analysisData(l.analysis,path)};});
  for(let i=1;i<legs.length;i++)if(distance(legs[i-1].coordinates.at(-1),legs[i].coordinates[0])>.5)throw Error('Les portions de l’itinéraire doivent se rejoindre.');const combined=legs.flatMap((l,i)=>i?l.coordinates.slice(1):l.coordinates);if(JSON.stringify(combined)!==JSON.stringify(points))throw Error('Les portions ne correspondent pas au tracé.');mode=legs.some(l=>l.mode==='route')?'route':'manual';
 }
 const length=routeLength(points);if(length<5)throw Error('Choisissez au moins deux points distincts.');if(length>500000)throw Error('Itinéraire limité à 500 km.');
 let routePoints;if(legs)routePoints=[legs[0].coordinates[0],...legs.map(l=>l.coordinates.at(-1))];else if(mode==='route'){routePoints=coordinates(body.routePoints??[points[0],points.at(-1)]);if(routePoints.length>50)throw Error('Itinéraire limité à 50 points de passage, départ et arrivée compris.');}
 const name=typeof body.name==='string'?body.name.trim().slice(0,160):'';if(!name)throw Error('Donnez un nom à votre itinéraire.');
 return {name,notes:typeof body.notes==='string'?body.notes.trim().slice(0,4000):'',coordinates:points,routePoints,legs,mode,snapped:mode==='route'?body.snapped===true:false,distance:length,sport:'GravelRide'};
}
const escapeXML=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function planFilename(name){const clean=String(name).replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').trim()||'Itinéraire';const ascii=clean.normalize('NFKD').replace(/[^\x20-\x7e]/g,'').replace(/["\\]/g,'_')||'Itineraire';return `attachment; filename="${ascii}.gpx"; filename*=UTF-8''${encodeURIComponent(clean+'.gpx').replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`;}
export function planGPX(data){
 const nodes=[];const model=buildElevationModel(data.legs?.length?data.legs:[{coordinates:data.coordinates}]);let globalAt=0;const parts=data.legs?.length?data.legs:[{coordinates:data.coordinates}];
 for(let n=0;n<parts.length;n++){const l=parts[n];for(let i=0;i<l.coordinates.length;i++){const p=l.coordinates[i];if(i){const meters=distance(l.coordinates[i-1],p);globalAt+=meters;}if(n&&i===0)continue;let altitude='';const height=elevationAt(model,globalAt);if(height!==null)altitude=`<ele>${height.toFixed(1)}</ele>`;nodes.push(`<trkpt lat="${p[0]}" lon="${p[1]}">${altitude}</trkpt>`);}}
 return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Sillage" xmlns="http://www.topografix.com/GPX/1/1" xmlns:sillage="https://sillage.gravelspa.be/xmlns/1"><trk><name>${escapeXML(data.name)}</name>${data.notes?`<desc>${escapeXML(data.notes)}</desc>`:''}<type>cycling</type><extensions><sillage:sport>GravelRide</sillage:sport></extensions><trkseg>${nodes.join('')}</trkseg></trk></gpx>`;
}
const provenance=row=>({sourceRideId:row.source_ride_id||null,fromStrava:row.source_strava===true});
async function insertPlan(db,user,data,isPublic,source={}){
 const id=randomUUID(),fromStrava=source.source_strava===true,visibility=!fromStrava&&isPublic===true;
 await db.query('INSERT INTO planned_routes(id,user_id,data,is_public,source_ride_id,source_strava,source_strava_activity_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,JSON.stringify(data),visibility,source.source_ride_id||null,fromStrava,source.source_strava_activity_id||null]);return {...data,id,isPublic:visibility,isMine:true,owner:user.username,...provenance(source)};
}
// Enrich converted traces independently of the browser. Never replace later edits.
export function createPlanEnrichment({db,metrics}){
 const jobs=new Map(),queue=[];let running=false;
 async function save(plan,userId,legs,state){
  await db.query("UPDATE planned_routes SET data=data || jsonb_build_object('legs',$1::jsonb,'analysisStatus',$2::text),updated_at=now() WHERE id=$3 AND user_id=$4 AND data->'legs'=$5::jsonb AND data->'coordinates'=$6::jsonb AND data->>'analysisStatus'='pending'",[JSON.stringify(legs),state,plan.id,userId,JSON.stringify(plan.legs),JSON.stringify(plan.coordinates)]);
 }
 async function run(plan,userId){
  const legs=[];for(const edge of plan.legs){let analysis;try{analysis=analysisData(await metrics({coordinates:edge.coordinates,kind:'all'}),edge.coordinates);if(!analysis)throw Error('Analyse invalide.');}catch{analysis={elevation:null,surfaces:[],surfaceRuns:[],errors:['Analyse indisponible. Utilisez « Compléter les données » pour réessayer.']};}legs.push({...edge,analysis});}
  const checked=planData({...plan,legs}).legs;await save(plan,userId,checked,checked.some(l=>l.analysis?.errors?.length)?'partial':'complete');
 }
 function drain(){if(running||!queue.length)return;running=true;const job=queue.shift();run(job.plan,job.userId).catch(()=>{}).finally(()=>{running=false;jobs.delete(job.plan.id);job.done();drain();});}
 return (value,userId)=>{
  if(jobs.has(value.id))return jobs.get(value.id);const plan=structuredClone(value);
  if(queue.length>=16)return save(plan,userId,plan.legs,'partial').catch(()=>{});
  let done;const promise=new Promise(resolve=>{done=resolve;});jobs.set(plan.id,promise);queue.push({plan,userId,done});drain();return promise;
 };
}
export async function plans({db,path,method,user,req,res,body,json,enrichPlan}){
 if(!user||!path.startsWith('/api/plans'))return false;const reply=(status,data)=>{json(res,status,data);return true;};
 const format=r=>({...r.data,id:r.id,isPublic:!r.source_strava&&r.is_public,isMine:r.is_mine,owner:r.username,createdAt:r.created_at,...provenance(r)});
 const convert=path.match(/^\/api\/plans\/from-ride\/([a-f0-9-]{36})$/);
 if(convert&&method==='POST'){
  const result=await withRideOrigins(db,user.id,async client=>{
   const q=await client.query('SELECT id,name,coordinates,source_type,strava_activity_id FROM rides WHERE id=$1 AND user_id=$2',[convert[1],user.id]),ride=q.rows[0];if(!ride)return null;
   const points=coordinates(ride.coordinates),data={...planData({name:ride.name,coordinates:points,legs:importedRideLegs(points),mode:'manual',snapped:false}),...(enrichPlan?{analysisStatus:'pending'}:{})};
   return insertPlan(client,user,data,false,{source_ride_id:ride.id,source_strava:ride.source_type==='strava',source_strava_activity_id:ride.strava_activity_id});
  });if(result&&enrichPlan)void enrichPlan(result,user.id);return reply(result?201:404,result||{error:'Sortie introuvable.'});
 }
 if(path==='/api/plans'&&method==='GET'){const q=await db.query('SELECT p.id,p.data,p.is_public,p.source_ride_id,p.source_strava,p.created_at,u.username,(p.user_id=$1) AS is_mine FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE (p.user_id=$1 OR (p.is_public=true AND p.source_strava=false AND u.active=true)) ORDER BY p.updated_at DESC',[user.id]);return reply(200,q.rows.map(format));}
 if(path==='/api/plans'&&method==='POST'){
  const b=await body(req);if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');const data=planData(b);if(data.mode==='route'&&!data.snapped)throw Error('Calculez le routage avant d’enregistrer, ou choisissez le mode manuel.');
  if(b.sourcePlanId!==undefined){if(!/^[a-f0-9-]{36}$/.test(b.sourcePlanId))throw Error('Itinéraire source invalide.');const result=await withRideOrigins(db,user.id,async client=>{
   const source=await client.query('SELECT p.id,p.source_ride_id,p.source_strava,p.source_strava_activity_id FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (p.user_id=$2 OR (p.is_public=true AND p.source_strava=false AND u.active=true))',[b.sourcePlanId,user.id]);if(!source.rows[0])return null;const row=source.rows[0];return insertPlan(client,user,data,b.isPublic,row.source_strava?row:{});
  });return reply(result?201:404,result||{error:'Itinéraire source introuvable.'});}
  return reply(201,await insertPlan(db,user,data,b.isPublic));
 }
 const item=path.match(/^\/api\/plans\/([a-f0-9-]{36})(\/gpx)?$/);if(!item)return false;
 if(method==='GET'){
  const q=await db.query('SELECT p.id,p.data,p.is_public,p.source_ride_id,p.source_strava,p.created_at,u.username,(p.user_id=$2) AS is_mine FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (p.user_id=$2 OR (p.is_public=true AND p.source_strava=false AND u.active=true))',[item[1],user.id]),row=q.rows[0];if(!row)return reply(404,{error:'Itinéraire introuvable.'});
  if(row.is_mine&&row.data.analysisStatus==='pending'&&enrichPlan)void enrichPlan(format(row),user.id);
  if(item[2]){res.writeHead(200,{'Content-Type':'application/gpx+xml; charset=utf-8','Content-Disposition':planFilename(row.data.name),'Cache-Control':'no-store'});res.end(planGPX(row.data));return true;}return reply(200,format(row));
 }
 if(item[2])return false;
 if(method==='DELETE'){const q=await db.query('DELETE FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Itinéraire introuvable.'});}
 if(method==='PATCH'){
  const old=await db.query('SELECT data,is_public,source_ride_id,source_strava FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);if(!old.rows[0])return reply(404,{error:'Itinéraire introuvable.'});const row=old.rows[0],b=await body(req);if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');if(row.source_strava&&b.isPublic===true)return reply(404,{error:'Itinéraire introuvable.'});const edits={};for(const key of ['name','notes','coordinates','routePoints','mode','snapped','legs'])if(b[key]!==undefined)edits[key]=b[key];
  const data=planData({...row.data,...edits}),isPublic=!row.source_strava&&(b.isPublic??row.is_public);if(data.mode==='route'&&!data.snapped)throw Error('Calculez le routage avant d’enregistrer.');
  const q=await db.query('UPDATE planned_routes SET data=$1,is_public=$2,updated_at=now() WHERE id=$3 AND user_id=$4 AND (source_strava=false OR $2=false) RETURNING id',[JSON.stringify(data),isPublic,item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{...data,id:item[1],isPublic,isMine:true,owner:user.username,...provenance(row)}:{error:'Itinéraire introuvable.'});
 }
 return false;
}
