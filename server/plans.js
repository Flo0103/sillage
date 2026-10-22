import {randomUUID} from 'node:crypto';
import {coordinates,routeLength} from './model.js';
export function planData(body){
 const points=coordinates(body.coordinates),mode=body.mode==='manual'?'manual':'route',distance=routeLength(points);if(distance<5)throw Error('Choisissez au moins deux points distincts.');if(distance>500000)throw Error('Itinéraire limité à 500 km.');
 let routePoints;if(mode==='route'){routePoints=coordinates(body.routePoints??[points[0],points.at(-1)]);if(routePoints.length>50)throw Error('Itinéraire limité à 50 points de passage, départ et arrivée compris.');}
 return {name:typeof body.name==='string'&&body.name.trim()?body.name.trim().slice(0,160):`Itinéraire de ${(distance/1000).toFixed(1).replace('.',',')} km`,notes:typeof body.notes==='string'?body.notes.trim().slice(0,4000):'',coordinates:points,routePoints,mode,snapped:mode==='route'?body.snapped===true:false,distance};
}
const escapeXML=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function planGPX(data){return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Sillage" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${escapeXML(data.name)}</name>${data.notes?`<desc>${escapeXML(data.notes)}</desc>`:''}<trkseg>${data.coordinates.map(p=>`<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join('')}</trkseg></trk></gpx>`;}
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
  if(item[2]){res.writeHead(200,{'Content-Type':'application/gpx+xml; charset=utf-8','Content-Disposition':`attachment; filename="sillage-itineraire-${item[1]}.gpx"`,'Cache-Control':'no-store'});res.end(planGPX(row.data));return true;}return reply(200,format(row));
 }
 if(item[2])return false;
 if(method==='DELETE'){const q=await db.query('DELETE FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Itinéraire introuvable.'});}
 if(method==='PATCH'){
  const old=await db.query('SELECT data,is_public FROM planned_routes WHERE id=$1 AND user_id=$2',[item[1],user.id]);if(!old.rows[0])return reply(404,{error:'Itinéraire introuvable.'});const b=await body(req);if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');const edits={};for(const key of ['name','notes','coordinates','routePoints','mode','snapped'])if(b[key]!==undefined)edits[key]=b[key];
  const data=planData({...old.rows[0].data,...edits}),isPublic=b.isPublic??old.rows[0].is_public;if(data.mode==='route'&&!data.snapped)throw Error('Calculez le routage avant d’enregistrer.');
  const q=await db.query('UPDATE planned_routes SET data=$1,is_public=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id',[JSON.stringify(data),isPublic,item[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{...data,id:item[1],isPublic,isMine:true,owner:user.username}:{error:'Itinéraire introuvable.'});
 }
 return false;
}
