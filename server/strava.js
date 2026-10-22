import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {tokenHash,coordinates,routeLength} from './model.js';
import {transaction} from './features.js';
export function tokenCipher(hex){
 if(!/^[a-f0-9]{64}$/i.test(hex||''))throw Error('Clé de chiffrement Strava invalide.');const key=Buffer.from(hex,'hex');
 return {seal(data,userId){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(userId));const content=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),content]).toString('base64');},open(text,userId){const b=Buffer.from(text,'base64'),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAAD(Buffer.from(userId));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));}};
}
export const isCycling=a=>['GravelRide','Ride','MountainBikeRide','EBikeRide','EMountainBikeRide'].includes(a.sport_type||a.type);
export function createStrava({clientId=process.env.STRAVA_CLIENT_ID,clientSecret=process.env.STRAVA_CLIENT_SECRET,key=process.env.STRAVA_TOKEN_KEY,webhookSecret=process.env.STRAVA_WEBHOOK_SECRET,fetcher=(...args)=>fetch(...args),now=Date.now}={}){
 const configured=/^\d+$/.test(clientId||'')&&!!clientSecret&&/^[a-f0-9]{64}$/i.test(key||''),cipher=configured?tokenCipher(key):null;
 async function request(url,options={}){let r;try{r=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Strava ne répond pas. Réessayez dans quelques instants.'),{status:504});}if(!r.ok){const error=Object.assign(Error(r.status===429?'Quota Strava atteint. Réessayez plus tard.':r.status===401?'Connexion Strava expirée ou révoquée. Reconnectez votre compte.':'Strava ne peut pas répondre à cette demande.'),{status:r.status===429?429:502,stravaUnauthorized:r.status===401});throw error;}return r.json();}
 const exchange=fields=>request('https://www.strava.com/oauth/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,...fields})});
 async function removeData(db,userId){await transaction(db,async c=>{await c.query('DELETE FROM portions WHERE user_id=$1 AND source_strava=true',[userId]);await c.query("DELETE FROM rides WHERE user_id=$1 AND source_type='strava'",[userId]);await c.query('DELETE FROM strava_connections WHERE user_id=$1',[userId]);await c.query('DELETE FROM strava_oauth_states WHERE user_id=$1',[userId]);});}
 async function connection(db,userId){
  try{return await transaction(db,async c=>{const q=await c.query('SELECT athlete_id,tokens FROM strava_connections WHERE user_id=$1 FOR UPDATE',[userId]),row=q.rows[0];if(!row)throw Error('Connectez votre compte Strava.');let data=cipher.open(row.tokens,userId);
   if(data.expires_at*1000<now()+60000){const next=await exchange({grant_type:'refresh_token',refresh_token:data.refresh_token});if(!next.access_token||!next.refresh_token||!Number.isFinite(next.expires_at))throw Error('Réponse Strava invalide.');data={...data,...next};await c.query('UPDATE strava_connections SET tokens=$1 WHERE user_id=$2',[cipher.seal(data,userId),userId]);}
   return {...data,athlete_id:String(row.athlete_id)};
  });}catch(e){if(e.stravaUnauthorized)await removeData(db,userId);throw e;}
 }
 const api=(path,token,options={})=>request('https://www.strava.com/api/v3'+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
 function callbackPage(res,ok){const message=ok?'Votre compte Strava est connecté.':'La connexion Strava a échoué ou a été refusée. Réessayez depuis Sillage.';res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strava — Sillage</title><p>${message}</p><p><a href="/?source=strava">Revenir à Sillage</a></p>${ok?'<script>location.replace("/?source=strava")</script>':''}</html>`);}
 const webhookPath=/^[a-f0-9]{64}$/.test(webhookSecret||'')?'/api/strava/webhook/'+webhookSecret:null;
 const handle=async function({db,req,res,path,query,method,user,sessionToken,origin,secure,body,json}){
  const reply=(status,data)=>{json(res,status,data);return true;};
  if(webhookPath&&path===webhookPath){
   if(method==='GET'&&query.get('hub.mode')==='subscribe'&&query.get('hub.verify_token')===webhookSecret&&query.get('hub.challenge')?.length<=300)return reply(200,{'hub.challenge':query.get('hub.challenge')});
   if(method==='POST'){
    const event=await body(req),athlete=String(event.owner_id||'');if(!/^\d{1,20}$/.test(athlete))return reply(400,{error:'Événement invalide.'});const q=await db.query('SELECT user_id FROM strava_connections WHERE athlete_id=$1',[athlete]);
    if(q.rows[0]&&event.object_type==='athlete'&&event.aspect_type==='update'&&event.updates?.authorized==='false')await removeData(db,q.rows[0].user_id);
    else if(q.rows[0]&&event.object_type==='activity'&&event.aspect_type==='delete'&&/^\d{1,20}$/.test(String(event.object_id)))await db.query("DELETE FROM rides WHERE user_id=$1 AND source_type='strava' AND strava_activity_id=$2",[q.rows[0].user_id,String(event.object_id)]);
    return reply(200,{ok:true});
   }
   return reply(403,{error:'Vérification refusée.'});
  }
  if(path==='/api/strava/callback'&&method==='GET'){
   const nonce=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sillage_strava_nonce='))?.slice(21);
   res.setHeader('Set-Cookie',`sillage_strava_nonce=; Path=/api/strava/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`);
   try{if(!configured||!/^[a-f0-9]{64}$/.test(query.get('state')||'')||!/^[a-f0-9]{64}$/.test(nonce||''))throw Error('State invalide.');
    const q=await db.query('DELETE FROM strava_oauth_states WHERE state_hash=$1 AND nonce_hash=$2 AND expires_at>now() RETURNING user_id,session_hash',[tokenHash(query.get('state')),tokenHash(nonce)]),state=q.rows[0];if(!state)throw Error('State expiré.');
    const session=await db.query('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>now() AND u.active=true',[state.session_hash,state.user_id]);if(!session.rows.length||query.get('error')||!query.get('code')||!(query.get('scope')||'').split(/[ ,]+/).includes('activity:read_all'))throw Error('Autorisation incomplète.');
    const tokens=await exchange({grant_type:'authorization_code',code:query.get('code')});if(!tokens.athlete?.id||!tokens.access_token||!tokens.refresh_token||!Number.isFinite(tokens.expires_at))throw Error('Réponse invalide.');
    await db.query('INSERT INTO strava_connections(user_id,athlete_id,tokens) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET athlete_id=EXCLUDED.athlete_id,tokens=EXCLUDED.tokens',[state.user_id,String(tokens.athlete.id),cipher.seal({access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:tokens.expires_at},state.user_id)]);callbackPage(res,true);
   }catch{callbackPage(res,false);}return true;
  }
  if(!user||!path.startsWith('/api/strava/'))return false;
  if(path==='/api/strava/status'&&method==='GET'){const q=await db.query('SELECT athlete_id FROM strava_connections WHERE user_id=$1',[user.id]);return reply(200,{configured,connected:!!q.rows.length});}
  if(!configured&&path==='/api/strava/disconnect'&&method==='POST'){await removeData(db,user.id);return reply(200,{ok:true,remoteRevoked:false});}
  if(!configured)return reply(503,{error:'La connexion Strava n’est pas encore activée sur ce serveur.'});
  if(path==='/api/strava/connect'&&method==='GET'){
   const state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex');await db.query('DELETE FROM strava_oauth_states WHERE user_id=$1 OR expires_at<now()',[user.id]);await db.query("INSERT INTO strava_oauth_states(state_hash,nonce_hash,user_id,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[tokenHash(state),tokenHash(nonce),user.id,sessionToken]);
   const url=new URL('https://www.strava.com/oauth/authorize');url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:origin+'/api/strava/callback',approval_prompt:'auto',scope:'activity:read_all',state});res.writeHead(303,{Location:url.toString(),'Set-Cookie':`sillage_strava_nonce=${nonce}; Path=/api/strava/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure?'; Secure':''}`,'Cache-Control':'no-store'});res.end();return true;
  }
  if(path==='/api/strava/disconnect'&&method==='POST'){
   let remoteRevoked=false;try{const c=await connection(db,user.id);await request('https://www.strava.com/oauth/deauthorize',{method:'POST',body:new URLSearchParams({access_token:c.access_token})});remoteRevoked=true;}catch{}
   await removeData(db,user.id);return reply(200,{ok:true,remoteRevoked});
  }
  try{
   if(path==='/api/strava/activities'&&method==='GET'){
    const c=await connection(db,user.id),page=Number(query.get('page')||1);if(!Number.isInteger(page)||page<1||page>200)throw Error('Page invalide.');const all=await api(`/athlete/activities?page=${page}&per_page=50`,c.access_token);if(!Array.isArray(all))throw Error('Réponse Strava invalide.');const onlyGravel=query.get('kind')!=='cycling';const activities=all.filter(a=>onlyGravel?a.sport_type==='GravelRide':isCycling(a)).map(a=>({id:String(a.id),name:a.name,distance:a.distance,startDate:a.start_date,sportType:a.sport_type||a.type,preview:decodePolyline(a.map?.summary_polyline)}));return reply(200,{activities,hasMore:all.length===50,page});
   }
   if(path==='/api/strava/import'&&method==='POST'){
    const b=await body(req),id=String(b.activityId||'');if(!/^\d{1,20}$/.test(id))throw Error('Activité invalide.');const existing=await db.query('SELECT id FROM rides WHERE user_id=$1 AND strava_activity_id=$2',[user.id,id]);if(existing.rows.length)return reply(200,{id:existing.rows[0].id});
    const c=await connection(db,user.id),activity=await api(`/activities/${id}`,c.access_token);if(String(activity.athlete?.id)!==c.athlete_id||!isCycling(activity))return reply(403,{error:'Choisissez votre propre sortie vélo.'});
    const streams=await api(`/activities/${id}/streams?keys=latlng&key_by_type=true`,c.access_token),points=coordinates(streams.latlng?.data),rideId=randomUUID(),name=String(activity.name||'Sortie Strava').slice(0,200);const q=await db.query("INSERT INTO rides(id,user_id,name,coordinates,distance,source_type,strava_activity_id) VALUES($1,$2,$3,$4,$5,'strava',$6) ON CONFLICT(user_id,strava_activity_id) WHERE strava_activity_id IS NOT NULL DO NOTHING RETURNING id",[rideId,user.id,name,JSON.stringify(points),routeLength(points),id]);const saved=q.rows[0]||((await db.query('SELECT id FROM rides WHERE user_id=$1 AND strava_activity_id=$2',[user.id,id])).rows[0]);return reply(201,{id:saved.id});
   }
  }catch(e){if(e.stravaUnauthorized)await removeData(db,user.id);throw e;}
  return false;
 };
 handle.isWebhook=path=>!!webhookPath&&path===webhookPath;return handle;
}

// Bounded decoder for Strava's summary polylines (precision 1e5, lat/lon).
export function decodePolyline(text){
 if(typeof text!=='string'||text.length>200000)return [];
 let i=0,lat=0,lon=0;const points=[];
 function delta(){let n=0,shift=0,b;do{if(i>=text.length||shift>30)throw Error('Polyline invalide');b=text.charCodeAt(i++)-63;if(b<0||b>63)throw Error('Polyline invalide');n|=(b&31)<<shift;shift+=5;}while(b>=32);return n&1?~(n>>>1):n>>>1;}
 try{while(i<text.length){lat+=delta();lon+=delta();const p=[lat/1e5,lon/1e5];if(Math.abs(p[0])>90||Math.abs(p[1])>180)return [];points.push(p);if(points.length>30000)return [];}}
 catch{return [];}
 if(points.length<=400)return points;
 return Array.from({length:400},(_,j)=>points[Math.round(j*(points.length-1)/399)]);
}
