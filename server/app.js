import { createOSMService } from './osm.js';
import { features } from './features.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { coordinates, portion, routeLength, verifyPassword, tokenHash, hashPassword } from './model.js';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
export function createApp(db,{origin,secure=true,osmService=createOSMService()}={}){
  if(!origin)throw Error('APP_ORIGIN doit être renseigné.');
  const sessionCookie='sillage_session';
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const cookie=(value,age)=>`${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
  let dummy;
  async function body(req,limit=12*1024*1024){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Fichier trop volumineux.'),{status:413});parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error('JSON invalide.'),{status:400});}}
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    try{
      const path=new URL(req.url,'http://local').pathname,method=req.method;
      if(path==='/healthz'&&method==='GET'){await db.query('SELECT 1');return json(res,200,{ok:true});}
      if(!['GET','HEAD'].includes(method)&&req.headers.origin!==origin)return json(res,403,{error:'Origine non autorisée.'});
      if(path==='/api/login'&&method==='POST'){
        const b=await body(req);if(typeof b.username!=='string'||typeof b.password!=='string'||b.password.length>256)return json(res,400,{error:'Identifiants invalides.'});
        const username=b.username.trim().toLowerCase().slice(0,80);
        // Caddy overwrites this header. The app has no published port.
        const ip=req.headers['x-real-ip']||req.socket.remoteAddress;
        const keys=[tokenHash(`ip:${ip}`),tokenHash(`user:${username}`)];
        await db.query('DELETE FROM login_limits WHERE expires_at<now()');
        for(const key of keys){const q=await db.query(`INSERT INTO login_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=login_limits.attempts+1 RETURNING attempts`,[key]);if(q.rows[0].attempts>20)return json(res,429,{error:'Trop de tentatives. Réessayez dans 15 minutes.'});}
        const q=await db.query('SELECT id,username,password_hash FROM users WHERE username=$1 AND active=true',[username]);const user=q.rows[0];dummy??=await hashPassword(randomBytes(24).toString('hex'));
        if(!await verifyPassword(b.password,user?.password_hash||dummy)||!user)return json(res,401,{error:'Identifiant ou mot de passe incorrect.'});
        const token=randomBytes(32).toString('hex');await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')`,[tokenHash(token),user.id]);res.setHeader('Set-Cookie',cookie(token,604800));return json(res,200,{username:user.username});
      }
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
      let user;if(token&&/^[a-f0-9]{64}$/.test(token)){const q=await db.query('SELECT u.id,u.username,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true',[tokenHash(token)]);user=q.rows[0];}
      if(['/login.html','/login.js','/style.css','/invite.html','/invite.js'].includes(path)){const file=path.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(await readFile(root+file));}
      if(await features({db,req,res,path,method,user,body,json,origin,sessionToken:token?tokenHash(token):null}))return;
      if(!user){if(path.startsWith('/api/'))return json(res,401,{error:'Connectez-vous pour continuer.'});res.writeHead(303,{Location:'/login.html','Cache-Control':'no-store'});return res.end();}
      if(path==='/api/me'&&method==='GET')return json(res,200,{id:user.id,username:user.username,isAdmin:user.is_admin===true});
      if(path==='/api/logout'&&method==='POST'){await db.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)]);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
      if(path==='/api/rides'&&method==='GET'){const q=await db.query('SELECT id,name,distance,created_at,(gpx_xml IS NOT NULL) AS gpx_available FROM rides WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[user.id]);return json(res,200,q.rows);}
      if(path==='/api/rides'&&method==='POST'){const b=await body(req,72*1024*1024),points=coordinates(b.coordinates),id=randomUUID(),name=typeof b.name==='string'?b.name.trim().slice(0,200)||'Sortie GPX':'Sortie GPX';if(b.gpx!==undefined&&(typeof b.gpx!=='string'||Buffer.byteLength(b.gpx,'utf8')>25*1024*1024))throw Error('GPX limité à 25 Mo.');const fileName=typeof b.fileName==='string'?b.fileName.slice(0,200):null;await db.query('INSERT INTO rides(id,user_id,name,coordinates,distance,gpx_xml,file_name) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,name,JSON.stringify(points),routeLength(points),b.gpx??null,fileName]);return json(res,201,{id,name});}
      const download=path.match(/^\/api\/rides\/([a-f0-9-]{36})\/gpx$/);
      if(download&&method==='GET'){
        const q=await db.query('SELECT name,coordinates,gpx_xml FROM rides WHERE id=$1 AND user_id=$2',[download[1],user.id]);const ride=q.rows[0];if(!ride)return json(res,404,{error:'Sortie introuvable.'});
        const xmlEscape=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
        const gpx=ride.gpx_xml??`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Sillage" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${xmlEscape(ride.name)}</name><trkseg>${ride.coordinates.map(p=>`<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join('')}</trkseg></trk></gpx>`;
        res.writeHead(200,{'Content-Type':'application/gpx+xml; charset=utf-8','Content-Disposition':`attachment; filename="sillage-${download[1]}.gpx"`,'Cache-Control':'no-store'});return res.end(gpx);
      }
      const ride=path.match(/^\/api\/rides\/([a-f0-9-]{36})$/);
      if(ride&&method==='GET'){const q=await db.query('SELECT id,name,coordinates,distance FROM rides WHERE id=$1 AND user_id=$2',[ride[1],user.id]);return q.rows.length?json(res,200,q.rows[0]):json(res,404,{error:'Sortie introuvable.'});}
      if(path==='/api/portions'&&method==='GET'){const q=await db.query('SELECT id,data,created_at,is_public FROM portions WHERE user_id=$1 ORDER BY created_at DESC',[user.id]);return json(res,200,q.rows.map(r=>({...r.data,id:r.id,createdAt:r.created_at,isPublic:r.is_public})));}
      if(path==='/api/portions'&&method==='POST'){const b=await body(req),p=portion(b),id=randomUUID();if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');const isPublic=b.isPublic!==false;await db.query('INSERT INTO portions(id,user_id,data,is_public) VALUES($1,$2,$3,$4)',[id,user.id,JSON.stringify(p),isPublic]);return json(res,201,{...p,id,isPublic});}
      if(path==='/api/import-legacy'&&method==='POST'){
        const b=await body(req);if(!Array.isArray(b)||b.length>500)throw Error('Import limité à 500 portions par lot.');
        const validated=b.map(r=>({data:portion(r),key:tokenHash(String(r.id||JSON.stringify(r)))}));
        const client=await db.connect();let imported=0;try{await client.query('BEGIN');for(const r of validated){const q=await client.query('INSERT INTO portions(id,user_id,data,legacy_id,is_public) VALUES($1,$2,$3,$4,false) ON CONFLICT(user_id,legacy_id) DO NOTHING',[randomUUID(),user.id,JSON.stringify(r.data),r.key]);imported+=q.rowCount;}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return json(res,200,{imported});
      }
      const item=path.match(/^\/api\/portions\/([a-f0-9-]{36})$/);if(item&&method==='DELETE'){const q=await db.query('DELETE FROM portions WHERE id=$1 AND user_id=$2',[item[1],user.id]);return json(res,q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Portion introuvable.'});}
      if(path==='/api/osm'&&method==='POST'){const b=await body(req);return json(res,200,await osmService(b.bbox));}
      if(method==='GET'&&['/','/index.html','/app.js','/geo.js','/catalog.js','/account.html','/account.js','/admin.html','/admin.js','/common.js'].includes(path)){if((path==='/admin.html'||path==='/admin.js')&&!user.is_admin)return json(res,403,{error:'Accès réservé à l’administrateur.'});const file=path==='/'?'index.html':path.slice(1);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');return res.end(await readFile(root+file));}
      return json(res,404,{error:'Ressource introuvable.'});
    }catch(e){if(e.code||e.name==='TypeError'&&e.message==='fetch failed'){console.error('Request failed:',e.code||e.name);return json(res,503,{error:'Service temporairement indisponible.'});}return json(res,e.status||400,{error:e.name==='TimeoutError'?'OSM est trop lent. Utilisez le mode manuel.':e.message||'Requête invalide.'});}
  });
}
