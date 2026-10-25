import {elevationData} from './profile-data.js';
import {buildElevationModel,elevationAt} from '../dist/elevation.js';
import {randomUUID} from 'node:crypto';
import {coordinates,routeLength,distance} from './model.js';
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
export async function plans({db,path,method,user,req,res,body,json}){
 if(!user||!path.startsWith('/api/plans'))return false;const reply=(status,data)=>{json(res,status,data);return true;};
 const format=r=>({...r.data,id:r.id,isPublic:r.is_public,isMine:r.is_mine,owner:r.username,createdAt:r.created_at});
 if(path==='/api/plans'&&method==='GET'){const q=await db.query('SELECT p.id,p.data,p.is_public,p.created_at,u.username,(p.user_id=$1) AS is_mine FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE (p.user_id=$1 OR (p.is_public=true AND u.active=true)) ORDER BY p.updated_at DESC',[user.id]);return reply(200,q.rows.map(format));}
 if(path==='/api/plans'&&method==='POST'){
  const b=await body(req);if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');const data=planData(b),id=randomUUID(),isPublic=b.isPublic===true;if(data.mode==='route'&&!data.snapped)throw Error('Calculez le routage avant d’enregistrer, ou choisissez le mode manuel.');
  await db.query('INSERT INTO planned_routes(id,user_id,data,is_public) VALUES($1,$2,$3,$4)',[id,user.id,JSON.stringify(data),isPublic]);return reply(201,{...data,id,isPublic,isMine:true,owner:user.username});
 }
 const item=path.match(/^\/api\/plans\/([a-f0-9-]{36})(\/gpx)?$/);if(!item)return false;
 if(method==='GET'){
  const q=await db.query('SELECT p.id,p.data,p.is_public,p.created_at,u.username,(p.user_id=$2) AS is_mine FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (p.user_id=$2 OR (p.is_public=true AND u.active=true))',[item[1],user.id]),row=q.rows[0];if(!row)return reply(404,{error:'Itinéraire introuvable.'});
  if(item[2]){res.writeHead(200,{'Content-Type':'application/gpx+xml; charset=utf-8','Content-Disposition':planFilename(row.data.name),'Cache-Control':'no-store'});res.end(planGPX(row.data));return true;}return reply(200,format(row));
 }
 if(item[2])return false;
 if(method==='DELETE'){const q=await db.query('DELETE FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Itinéraire introuvable.'});}
 if(method==='PATCH'){
  const old=await db.query('SELECT data,is_public FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);if(!old.rows[0])return reply(404,{error:'Itinéraire introuvable.'});const b=await body(req);if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');const edits={};for(const key of ['name','notes','coordinates','routePoints','mode','snapped','legs'])if(b[key]!==undefined)edits[key]=b[key];
  const data=planData({...old.rows[0].data,...edits}),isPublic=b.isPublic??old.rows[0].is_public;if(data.mode==='route'&&!data.snapped)throw Error('Calculez le routage avant d’enregistrer.');
  const q=await db.query('UPDATE planned_routes SET data=$1,is_public=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id',[JSON.stringify(data),isPublic,item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{...data,id:item[1],isPublic,isMine:true,owner:user.username}:{error:'Itinéraire introuvable.'});
 }
 return false;
}
