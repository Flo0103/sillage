import { createStrava } from './strava.js';
import {contentSecurityPolicy,createAdmissionController} from './security.js';
import {withRideOrigins} from './ride-links.js';
import { createRoutingService } from './routing.js';
import { createOSMService } from './osm.js';
import { plans } from './plans.js';
import { createPlanMetrics } from './plan-metrics.js';
import { features } from './features.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { coordinates, portion, routeLength, verifyPassword, tokenHash, hashPassword } from './model.js';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
export function createApp(db,{origin,secure=true,osmService=createOSMService(),routingService=createRoutingService(),planMetrics=createPlanMetrics(),stravaService=createStrava(),admission=createAdmissionController()}={}){
  if(!origin)throw Error('APP_ORIGIN doit être renseigné.');
  const sessionCookie='sillage_session';
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const cookie=(value,age)=>`${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
  let dummy;
  async function body(req,limit=["/api/invitation-info","/api/accept-invitation","/api/account/password","/api/admin/invitations"].includes(req.url?.split("?")[0])?16*1024:12*1024*1024){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Fichier trop volumineux.'),{status:413});parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error('JSON invalide.'),{status:400});}}
  return createServer({headersTimeout:15000,requestTimeout:60000},async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',contentSecurityPolicy);
    let release=()=>{};
    try{
      const url=new URL(req.url,'http://local'),path=url.pathname,query=url.searchParams,method=req.method;
      if(path==='/healthz'&&method==='GET'){await db.query('SELECT 1');return json(res,200,{ok:true});}
      if(!['GET','HEAD'].includes(method)&&req.headers.origin!==origin&&!stravaService.isWebhook?.(path))return json(res,403,{error:'Origine non autorisée.'});
      // Caddy replaces X-Real-IP; app:3000 must remain unpublished.
      const ip=String(req.headers['x-real-ip']||req.socket.remoteAddress);
      release=admission.enter(path,method,ip);
      if(path==='/api/login'&&method==='POST'){
        const b=await body(req,16*1024);if(typeof b?.username!=='string'||typeof b?.password!=='string'||b.password.length>256)return json(res,400,{error:'Identifiants invalides.'});
        const username=b.username.trim().toLowerCase().slice(0,80);
        // Guessing an identifier must not lock its owner out on another IP.
        const keys=[tokenHash(`ip:${ip}`)];
        await db.query('DELETE FROM login_limits WHERE expires_at<now()');
        for(const key of keys){const q=await db.query(`INSERT INTO login_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.expires_at<now() THEN 1 ELSE login_limits.attempts+1 END,expires_at=CASE WHEN login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE login_limits.expires_at END RETURNING attempts`,[key]);if(q.rows[0].attempts>20){res.setHeader('Retry-After','900');return json(res,429,{error:'Trop de tentatives. Réessayez dans 15 minutes.'});}}
        const q=await db.query('SELECT id,username,password_hash FROM users WHERE username=$1 AND active=true',[username]);const user=q.rows[0];dummy??=await hashPassword(randomBytes(24).toString('hex'));
        if(!await verifyPassword(b.password,user?.password_hash||dummy)||!user)return json(res,401,{error:'Identifiant ou mot de passe incorrect.'});
        const token=randomBytes(32).toString('hex');await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')`,[tokenHash(token),user.id]);res.setHeader('Set-Cookie',cookie(token,604800));return json(res,200,{username:user.username});
      }
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
      let user;if(token&&/^[a-f0-9]{64}$/.test(token)){const q=await db.query('SELECT u.id,u.username,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true',[tokenHash(token)]);user=q.rows[0];}
      if(path==='/strava-callback.js'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(root+'strava-callback.js'));}
      const vendorAssets={'/vendor/leaflet-1.9.4/leaflet.js':'text/javascript; charset=utf-8','/vendor/leaflet-1.9.4/leaflet.css':'text/css; charset=utf-8',...Object.fromEntries(['layers.png','layers-2x.png','marker-icon.png','marker-icon-2x.png','marker-shadow.png'].map(name=>['/vendor/leaflet-1.9.4/images/'+name,'image/png']))};
      if(method==='GET'&&Object.hasOwn(vendorAssets,path)&&user){res.writeHead(200,{'Content-Type':vendorAssets[path],'Cache-Control':'private, max-age=86400'});return res.end(await readFile(root+path.slice(1)));}
      const identityAssets={
        '/fonts/hanken-v1-latin.woff2':'font/woff2',
        '/fonts/bricolage-v1-latin.woff2':'font/woff2',
        '/fonts/plex-mono-v1-latin.woff2':'font/woff2',
        '/sillage-mark-v1.svg':'image/svg+xml',
        '/sillage-wordmark-v1.svg':'image/svg+xml',
        '/sillage-terrain-v1.svg':'image/svg+xml',
        '/sillage-terrain-v2.svg':'image/svg+xml',
        '/sillage-header-v1.svg':'image/svg+xml',
        '/sillage-mark-v1.png':'image/png',
        '/sillage-mark-v2.svg':'image/svg+xml',
        '/sillage-mark-v2.png':'image/png',
        '/sillage-logo-v2.svg':'image/svg+xml',
        '/sillage-logo-v3.svg':'image/svg+xml',
        '/sillage-logo-mono-v3.svg':'image/svg+xml',
        '/sillage-mark-v3.svg':'image/svg+xml',
        '/sillage-mark-v3.png':'image/png',
        '/sillage-logo-mono-v2.svg':'image/svg+xml',
        '/sillage-sector-v1.svg':'image/svg+xml',
        '/sillage-itinerary-v1.svg':'image/svg+xml'
      };
      if(method==='GET'&&Object.hasOwn(identityAssets,path)){res.writeHead(200,{'Content-Type':identityAssets[path],'Cache-Control':'public, max-age=31536000, immutable'});return res.end(await readFile(root+path.slice(1)));}
      if(path==='/app-icon.png'&&method==='GET'){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});return res.end(await readFile(root+'app-icon.png'));}
      if(['/login.html','/login.js','/style.css','/invite.html','/invite.js'].includes(path)){const file=path.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(await readFile(root+file));}
      if(await stravaService({db,req,res,path,query,method,user,body,json,origin,secure,sessionToken:token?tokenHash(token):null}))return;
      if(await features({db,req,res,path,query,method,user,body,json,origin,sessionToken:token?tokenHash(token):null}))return;
      if(!user){if(path.startsWith('/api/'))return json(res,401,{error:'Connectez-vous pour continuer.'});res.writeHead(303,{Location:'/login.html','Cache-Control':'no-store'});return res.end();}
      if(await plans({db,path,method,user,req,res,body,json}))return;
      if(path==='/api/rides/overlay'&&method==='GET'){const q=await db.query('SELECT id,name,source_type,ST_AsGeoJSON(ST_Simplify(geom,0.00005))::jsonb AS geometry FROM rides WHERE user_id=$1 ORDER BY created_at DESC',[user.id]);return json(res,200,q.rows.map(r=>{const coords=r.geometry?.coordinates;if(!Array.isArray(coords)||coords.length<2)return null;const points=coords.length>2000?Array.from({length:2000},(_,i)=>coords[Math.round(i*(coords.length-1)/1999)]):coords;return {id:r.id,name:r.name,source_type:r.source_type,coordinates:points.map(p=>[p[1],p[0]])};}).filter(Boolean));}
      if(path==='/api/me'&&method==='GET')return json(res,200,{id:user.id,username:user.username,isAdmin:user.is_admin===true});
      if(path==='/api/logout'&&method==='POST'){await db.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)]);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
      if(path==='/api/rides'&&method==='GET'){const q=await db.query('SELECT id,name,distance,created_at,source_type,(gpx_xml IS NOT NULL) AS gpx_available,CASE WHEN geom IS NULL THEN NULL ELSE jsonb_build_array(ST_Y(ST_StartPoint(geom)),ST_X(ST_StartPoint(geom))) END AS start_point,CASE WHEN geom IS NULL THEN NULL ELSE jsonb_build_array(ST_Y(ST_EndPoint(geom)),ST_X(ST_EndPoint(geom))) END AS end_point FROM rides WHERE user_id=$1 ORDER BY created_at DESC',[user.id]);return json(res,200,q.rows);}
      if(path==='/api/rides'&&method==='POST'){const b=await body(req,72*1024*1024),points=coordinates(b.coordinates),id=randomUUID(),name=typeof b.name==='string'?b.name.trim().slice(0,200)||'Sortie GPX':'Sortie GPX';if(b.gpx!==undefined&&(typeof b.gpx!=='string'||Buffer.byteLength(b.gpx,'utf8')>25*1024*1024))throw Error('GPX limité à 25 Mo.');const fileName=typeof b.fileName==='string'?b.fileName.slice(0,200):null;await db.query('INSERT INTO rides(id,user_id,name,coordinates,distance,gpx_xml,file_name) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,name,JSON.stringify(points),routeLength(points),b.gpx??null,fileName]);return json(res,201,{id,name});}
      const ridePreview=path.match(/^\/api\/rides\/([a-f0-9-]{36})\/preview$/);
      if(ridePreview&&method==='GET'){const q=await db.query('SELECT id,name,ST_AsGeoJSON(ST_Simplify(geom,0.0001))::jsonb AS geometry FROM rides WHERE id=$1 AND user_id=$2',[ridePreview[1],user.id]),row=q.rows[0];if(!row)return json(res,404,{error:'Sortie introuvable.'});const points=row.geometry?.coordinates||[],sample=points.length>500?Array.from({length:500},(_,i)=>points[Math.round(i*(points.length-1)/499)]):points;return json(res,200,{id:row.id,name:row.name,coordinates:sample.map(p=>[p[1],p[0]])});}
      const download=path.match(/^\/api\/rides\/([a-f0-9-]{36})\/gpx$/);
      if(download&&method==='GET'){
        const q=await db.query('SELECT name,coordinates,gpx_xml FROM rides WHERE id=$1 AND user_id=$2',[download[1],user.id]);const ride=q.rows[0];if(!ride)return json(res,404,{error:'Sortie introuvable.'});
        const xmlEscape=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
        const gpx=ride.gpx_xml??`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Sillage" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${xmlEscape(ride.name)}</name><trkseg>${ride.coordinates.map(p=>`<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join('')}</trkseg></trk></gpx>`;
        res.writeHead(200,{'Content-Type':'application/gpx+xml; charset=utf-8','Content-Disposition':`attachment; filename="sillage-${download[1]}.gpx"`,'Cache-Control':'no-store'});return res.end(gpx);
      }
      const ride=path.match(/^\/api\/rides\/([a-f0-9-]{36})$/);
      if(ride&&method==='DELETE'){const q=await db.query('DELETE FROM rides WHERE id=$1 AND user_id=$2',[ride[1],user.id]);return json(res,q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Sortie introuvable.'});}
      if(ride&&method==='GET'){const q=await db.query('SELECT id,name,coordinates,distance,source_type FROM rides WHERE id=$1 AND user_id=$2',[ride[1],user.id]);return q.rows.length?json(res,200,q.rows[0]):json(res,404,{error:'Sortie introuvable.'});}
      if(path==='/api/portions'&&method==='GET'){const q=await db.query('SELECT id,data,created_at,is_public,source_strava FROM portions WHERE user_id=$1 ORDER BY created_at DESC',[user.id]);return json(res,200,q.rows.map(r=>({...r.data,id:r.id,createdAt:r.created_at,isPublic:r.is_public,fromStrava:r.source_strava})));}
      if(path==='/api/portions'&&method==='POST'){
        const b=await body(req);if(b.independentOsm===true&&(b.rideId||!['route','manual'].includes(b.mode)))throw Error('Un dessin OSM indépendant ne peut pas reprendre une sortie ou suivre le GPX.');const p=portion(b.independentOsm===true?{...b,source:'Dessin OSM indépendant'}:b),id=randomUUID();if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');
        const save=async client=>{let sourceRide=null,fromStrava=false;if(b.rideId){const q=await client.query('SELECT id,source_type,strava_activity_id FROM rides WHERE id=$1 AND user_id=$2',[b.rideId,user.id]);sourceRide=q.rows[0];if(!sourceRide)throw Error('Sortie source introuvable.');fromStrava=sourceRide.source_type==='strava';}const isPublic=!fromStrava&&b.isPublic!==false;await client.query('INSERT INTO portions(id,user_id,data,is_public,source_ride_id,source_strava,source_strava_activity_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,JSON.stringify(p),isPublic,sourceRide?.id||null,fromStrava,fromStrava?sourceRide.strava_activity_id||null:null]);return {...p,id,isPublic,fromStrava};};
        return json(res,201,b.rideId?await withRideOrigins(db,user.id,save):await save(db));
      }
      if(path==='/api/import-legacy'&&method==='POST'){
        const b=await body(req);if(!Array.isArray(b)||b.length>500)throw Error('Import limité à 500 portions par lot.');
        const validated=b.map(r=>({data:portion(r),key:tokenHash(String(r.id||JSON.stringify(r)))}));
        const client=await db.connect();let imported=0;try{await client.query('BEGIN');for(const r of validated){const q=await client.query('INSERT INTO portions(id,user_id,data,legacy_id,is_public) VALUES($1,$2,$3,$4,false) ON CONFLICT(user_id,legacy_id) DO NOTHING',[randomUUID(),user.id,JSON.stringify(r.data),r.key]);imported+=q.rowCount;}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return json(res,200,{imported});
      }
      const item=path.match(/^\/api\/portions\/([a-f0-9-]{36})$/);if(item&&method==='DELETE'){const q=await db.query('DELETE FROM portions WHERE id=$1 AND user_id=$2',[item[1],user.id]);return json(res,q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Portion introuvable.'});}
      if(path==='/api/plan-elevations'&&method==='POST'){if(!planMetrics.elevations)throw Error('Analyse des altitudes indisponible.');return json(res,200,await planMetrics.elevations(await body(req)));}
      if(path==='/api/plan-metrics'&&method==='POST')return json(res,200,await planMetrics(await body(req)));
      if(path==='/api/route/nearest'&&method==='POST'){if(!routingService.nearest)throw Error('Accrochage des points indisponible.');return json(res,200,await routingService.nearest(await body(req)));}
      if(path==='/api/routing/status'&&method==='GET')return json(res,200,routingService.status?await routingService.status():{mode:'public',networks:[]});
      if(path==='/api/route'&&method==='POST'){const began=performance.now(),result=await routingService(await body(req)),duration=Math.round((performance.now()-began)*100)/100;res.setHeader('Server-Timing',`routing;dur=${duration}`);console.info(JSON.stringify({event:'routing',durationMs:duration,engine:result.engine,source:result.osmSource,cached:result.cached,...result.timings}));return json(res,200,result);}
      if(path==='/api/osm'&&method==='POST'){const b=await body(req);return json(res,200,await osmService(b.bbox));}
      if(method==='GET'&&['/','/index.html','/app.js','/geo.js','/osm-tags.js','/preview.js','/route-edit.js','/planner.js','/plan-library.js','/gps-transfer.js','/onboarding.js','/ride-browser.js','/elevation.js','/elevation-data.js','/osm-worker.js','/catalog.js','/account.html','/account.js','/admin.html','/admin.js','/common.js','/strava.html','/strava-client.js'].includes(path)){if((path==='/admin.html'||path==='/admin.js')&&!user.is_admin)return json(res,403,{error:'Accès réservé à l’administrateur.'});const file=path==='/'?'index.html':path.slice(1);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');return res.end(await readFile(root+file));}
      return json(res,404,{error:'Ressource introuvable.'});
    }catch(e){if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));if(e.code||e.name==='TypeError'&&e.message==='fetch failed'){console.error('Request failed:',e.code||e.name);return json(res,503,{error:'Service temporairement indisponible.'});}return json(res,e.status||400,{error:e.name==='TimeoutError'?'OSM est trop lent. Utilisez le mode manuel.':e.message||'Requête invalide.'});}finally{release();}
  });
}


