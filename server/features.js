import {spatialBounds} from './spatial.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {hashPassword,verifyPassword,tokenHash,portion} from './model.js';
export function validPassword(p){return typeof p==='string'&&p.length>=12&&p.length<=256;}
export function validUsername(s){return typeof s==='string'&&/^[a-z0-9_.-]{3,80}$/.test(s);}
export function wmsConfig(b){
 const name=String(b.name||'').trim().slice(0,80),layers=String(b.layers||'').trim().slice(0,500);let url;
 try{url=new URL(b.url);}catch{throw Error('URL WMS invalide.');}
 if(!name||!layers||url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||!url.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.(local|internal|localhost)$|\[/.test(url.hostname))throw Error('Indiquez un service WMS HTTPS public, un nom et des couches.');
 for(const key of [...url.searchParams.keys()])if(/^(service|request|version|layers|styles|format|transparent|bbox|width|height|crs|srs)$/i.test(key))url.searchParams.delete(key);
 return {name,url:url.toString(),layers,version:b.version==='1.1.1'?'1.1.1':'1.3.0',styles:String(b.styles||'').slice(0,300),attribution:String(b.attribution||'').trim().slice(0,300)};
}
export async function transaction(db,fn){const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function features({db,req,res,path,method,user,body,json,origin,sessionToken,query=new URLSearchParams()}){
 const reply=(status,data)=>{json(res,status,data);return true;};
 const isAdmin=user?.is_admin===true;
 if(['/api/invitation-info','/api/accept-invitation'].includes(path)&&method==='POST'){
  const key=tokenHash(`invite-ip:${req.headers['x-real-ip']||req.socket.remoteAddress}`);const q=await db.query(`INSERT INTO login_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.expires_at<now() THEN 1 ELSE login_limits.attempts+1 END,expires_at=CASE WHEN login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE login_limits.expires_at END RETURNING attempts`,[key]);if(q.rows[0].attempts>40)return reply(429,{error:'Trop de tentatives. Réessayez dans 15 minutes.'});
 }
 if(path==='/api/invitation-info'&&method==='POST'){
  const b=await body(req);if(!/^[a-f0-9]{64}$/.test(b.token||''))return reply(400,{error:'Invitation invalide.'});const q=await db.query('SELECT username,expires_at FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()',[tokenHash(b.token)]);return q.rows[0]?reply(200,q.rows[0]):reply(400,{error:'Invitation expirée ou révoquée.'});
 }
 if(path==='/api/accept-invitation'&&method==='POST'){
  const b=await body(req);if(!/^[a-f0-9]{64}$/.test(b.token||'')||!validPassword(b.password))return reply(400,{error:'Invitation invalide ou mot de passe trop court (12 caractères minimum).'});
  await transaction(db,async c=>{const q=await c.query('SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash(b.token)]);const invite=q.rows[0];if(!invite)throw Error('Invitation expirée ou déjà utilisée.');const passwordHash=await hashPassword(b.password);let id=invite.user_id;
   if(id){const q=await c.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND active=true RETURNING id',[passwordHash,id]);if(!q.rowCount)throw Error('Compte désactivé ou introuvable.');await c.query('DELETE FROM sessions WHERE user_id=$1',[id]);}
   else{id=randomUUID();await c.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[id,invite.username,passwordHash]);}
   await c.query('UPDATE invitations SET used_at=now() WHERE id=$1',[invite.id]);await c.query('UPDATE invitations SET revoked_at=now() WHERE username=$1 AND id<>$2 AND used_at IS NULL',[invite.username,invite.id]);
  });return reply(200,{ok:true});
 }
 if(!user)return false;
 if(path==='/api/account/password'&&method==='POST'){
  const b=await body(req);if(typeof b.currentPassword!=='string'||b.currentPassword.length>256||!validPassword(b.newPassword))return reply(400,{error:'Nouveau mot de passe : 12 à 256 caractères.'});
  const limit=await db.query(`INSERT INTO login_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.expires_at<now() THEN 1 ELSE login_limits.attempts+1 END,expires_at=CASE WHEN login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE login_limits.expires_at END RETURNING attempts`,[tokenHash(`password:${user.id}`)]);if(limit.rows[0].attempts>20)return reply(429,{error:'Trop de tentatives. Réessayez dans 15 minutes.'});
  await transaction(db,async c=>{const q=await c.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[user.id]);if(!q.rows[0]||!await verifyPassword(b.currentPassword,q.rows[0].password_hash))throw Error('Mot de passe actuel incorrect.');await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(b.newPassword),user.id]);await c.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[user.id,sessionToken]);});return reply(200,{ok:true});
 }
 if(path==='/api/catalog'&&method==='GET'){
  const bounds=spatialBounds(query.get('bbox')),params=[user.id,...(bounds||[])];const spatial=bounds?' AND ST_Intersects(p.geom,ST_MakeEnvelope($2,$3,$4,$5,4326))':'';
  const q=await db.query(`SELECT p.id,p.data,p.created_at,p.is_public,p.source_strava,u.username,(p.user_id=$1) AS is_mine FROM portions p JOIN users u ON u.id=p.user_id WHERE (p.user_id=$1 OR (p.is_public=true AND p.source_strava=false AND u.active=true))${spatial} ORDER BY p.created_at DESC`,params);return reply(200,q.rows.map(r=>({...r.data,id:r.id,createdAt:r.created_at,isPublic:r.is_public,fromStrava:r.source_strava,owner:r.username,isMine:r.is_mine})));
 }
 const segment=path.match(/^\/api\/portions\/([a-f0-9-]{36})$/);
 if(segment&&method==='PATCH'){
  const b=await body(req),owned=await db.query('SELECT data,is_public,source_strava FROM portions WHERE id=$1 AND user_id=$2',[segment[1],user.id]),old=owned.rows[0];
  if(!old)return reply(404,{error:'Segment introuvable.'});
  if(b.isPublic!==undefined&&typeof b.isPublic!=='boolean')throw Error('Visibilité invalide.');
  const isPublic=b.isPublic??old.is_public;if(old.source_strava&&isPublic)return reply(404,{error:'Segment introuvable.'});
  // Only editable fields are accepted. Ride attribution and Strava provenance cannot be changed.
  const edits={};for(const key of ['name','rating','surface','difficulty','winter','singleTrack','notes','coordinates','snapped','mode','routePoints'])if(b[key]!==undefined)edits[key]=b[key];
  const data=portion({...old.data,...edits,source:old.data.source});
  const q=await db.query('UPDATE portions SET data=$1,is_public=$2 WHERE id=$3 AND user_id=$4 AND (source_strava=false OR $2=false) RETURNING id',[JSON.stringify(data),isPublic,segment[1],user.id]);
  return reply(q.rowCount?200:404,q.rowCount?{...data,id:segment[1],isPublic,fromStrava:old.source_strava}:{error:'Segment introuvable.'});
 }
 if(path==='/api/wms'&&method==='GET'){const q=await db.query('SELECT id,config FROM wms_layers WHERE user_id=$1 ORDER BY created_at',[user.id]);return reply(200,q.rows.map(r=>({...r.config,id:r.id})));}
 if(path==='/api/wms'&&method==='POST'){const config=wmsConfig(await body(req)),id=randomUUID();await db.query('INSERT INTO wms_layers(id,user_id,config) VALUES($1,$2,$3)',[id,user.id,JSON.stringify(config)]);return reply(201,{...config,id});}
 const layer=path.match(/^\/api\/wms\/([a-f0-9-]{36})$/);if(layer&&method==='DELETE'){const q=await db.query('DELETE FROM wms_layers WHERE id=$1 AND user_id=$2',[layer[1],user.id]);return reply(q.rowCount?200:404,q.rowCount?{ok:true}:{error:'Fond introuvable.'});}
 if(!path.startsWith('/api/admin/'))return false;
 if(!isAdmin)return reply(403,{error:'Accès réservé à l’administrateur.'});
 if(path==='/api/admin/database'&&method==='GET'){const q=await db.query('SELECT PostGIS_Full_Version() AS version,(SELECT count(*)::int FROM rides WHERE geom IS NOT NULL) AS rides,(SELECT count(*)::int FROM portions WHERE geom IS NOT NULL) AS portions');return reply(200,q.rows[0]);}
 if(path==='/api/admin/users'&&method==='GET'){const q=await db.query('SELECT id,username,is_admin,active,created_at FROM users ORDER BY created_at');return reply(200,q.rows);}
 if(path==='/api/admin/invitations'&&method==='GET'){const q=await db.query('SELECT id,username,expires_at,used_at,revoked_at FROM invitations ORDER BY created_at DESC LIMIT 100');return reply(200,q.rows);}
 const reset=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/reset$/);
 if(path==='/api/admin/invitations'&&method==='POST'||reset&&method==='POST'){
  const b=reset?{}:await body(req),token=randomBytes(32).toString('hex'),id=randomUUID();let username;
  await transaction(db,async c=>{
   let userId=null;if(reset){const q=await c.query('SELECT id,username,active FROM users WHERE id=$1',[reset[1]]);if(!q.rows[0]?.active)throw Error('Compte introuvable ou désactivé.');username=q.rows[0].username;userId=q.rows[0].id;}
   else{username=String(b.username||'').trim().toLowerCase();if(!validUsername(username))throw Error('Identifiant : 3 à 80 caractères, lettres minuscules, chiffres, _, . ou -.');const q=await c.query('SELECT id FROM users WHERE username=$1',[username]);if(q.rows.length)throw Error('Cet identifiant possède déjà un compte.');}
   await c.query('UPDATE invitations SET revoked_at=now() WHERE username=$1 AND used_at IS NULL AND revoked_at IS NULL',[username]);await c.query(`INSERT INTO invitations(id,token_hash,username,user_id,created_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')`,[id,tokenHash(token),username,userId,user.id]);
  });return reply(201,{id,username,url:`${origin}/invite.html#${token}`});
 }
 const invite=path.match(/^\/api\/admin\/invitations\/([a-f0-9-]{36})$/);if(invite&&method==='DELETE'){await db.query('UPDATE invitations SET revoked_at=now() WHERE id=$1 AND used_at IS NULL',[invite[1]]);return reply(200,{ok:true});}
 const target=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/);
 if(target&&['PATCH','DELETE'].includes(method)){
  const b=method==='PATCH'?await body(req):null;if(b&&(typeof b.active!=='boolean'||typeof b.isAdmin!=='boolean'))throw Error('Paramètres invalides.');
  await transaction(db,async c=>{
   await c.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');const q=await c.query('SELECT id,is_admin,active FROM users WHERE id=$1',[target[1]]),t=q.rows[0];if(!t)throw Error('Compte introuvable.');
   if(t.id===user.id&&(method==='DELETE'||!b.active||!b.isAdmin))throw Error('Vous ne pouvez pas supprimer, désactiver ou rétrograder votre propre compte.');
   if(t.is_admin&&t.active&&(method==='DELETE'||!b.active||!b.isAdmin)){const n=await c.query('SELECT count(*)::int AS count FROM users WHERE is_admin=true AND active=true');if(n.rows[0].count<=1)throw Error('Le dernier administrateur doit rester actif.');}
   if(method==='DELETE')await c.query('DELETE FROM users WHERE id=$1',[t.id]);else await c.query('UPDATE users SET active=$1,is_admin=$2 WHERE id=$3',[b.active,b.isAdmin,t.id]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[t.id]);await c.query('UPDATE invitations SET revoked_at=now() WHERE username=(SELECT username FROM users WHERE id=$1) AND used_at IS NULL',[t.id]);
  });return reply(200,{ok:true});
 }
 return false;
}
