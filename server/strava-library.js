import {randomUUID} from 'node:crypto';
import {transaction} from './features.js';
import {lockRideOrigins} from './ride-links.js';
import {spatialBounds} from './spatial.js';

export const stravaLibrarySQL=`
CREATE TABLE IF NOT EXISTS strava_library_state(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,athlete_id bigint NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS strava_library_activities(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,activity_id bigint NOT NULL,started_at timestamptz,cycling boolean NOT NULL,data jsonb NOT NULL,search_text text NOT NULL,PRIMARY KEY(user_id,activity_id));
CREATE INDEX IF NOT EXISTS strava_library_dates ON strava_library_activities(user_id,started_at DESC,activity_id DESC);
`;
const normalise=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('fr');
const cycling=new Set(['GravelRide','Ride','MountainBikeRide','EBikeRide','EMountainBikeRide']);
const position=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=90&&Math.abs(value[1])<=180?value:null;
export function activityMetadata(activity,decode){
 const id=String(activity?.id||'');if(!/^\d{1,19}$/.test(id))throw Error('Réponse Strava invalide.');
 const type=String(activity.sport_type||activity.type||''),isCycling=cycling.has(type),date=new Date(activity.start_date),startDate=Number.isNaN(date.getTime())?null:date.toISOString();
 const path=isCycling?decode(activity.map?.summary_polyline):[],preview=path.length>250?Array.from({length:250},(_,i)=>path[Math.round(i*(path.length-1)/249)]):path;
 const data={id,name:isCycling?String(activity.name||'Sortie Strava').slice(0,200):'',distance:isCycling&&Number.isFinite(activity.distance)?Math.max(0,activity.distance):0,ascent:isCycling&&Number.isFinite(activity.total_elevation_gain)?Math.max(0,activity.total_elevation_gain):null,startDate,sportType:type,preview,start_point:isCycling?position(activity.start_latlng):null,end_point:isCycling?position(activity.end_latlng):null};
 return {activity_id:id,started_at:startDate,cycling:isCycling,data,search_text:normalise(data.name)};
}

export function libraryQuery(userId,query){
 const params=[userId],where=['a.user_id=$1','a.cycling=true'],bind=value=>{params.push(value);return '$'+params.length;};
 if(query.get('kind')!=='cycling')where.push("a.data->>'sportType'='GravelRide'");
 const search=normalise(query.get('q')||'').trim();if(search.length>200)throw Error('Recherche limitée à 200 caractères.');for(const word of search.split(/\s+/).filter(Boolean))where.push('strpos(a.search_text,'+bind(word)+')>0');
 for(const [key,field,factor,operator]of [['distanceMin','distance',1000,'>='],['distanceMax','distance',1000,'<='],['ascentMin','ascent',1,'>='],['ascentMax','ascent',1,'<=']])if(query.has(key)&&query.get(key)!==''){
  const value=Number(query.get(key));if(!Number.isFinite(value)||value<0)throw Error('Filtre numérique invalide.');where.push(`(a.data->>'${field}')::double precision ${operator} `+bind(value*factor));
 }
 const mode=query.get('mapFilter')||'all';if(!['all','start','end','both'].includes(mode))throw Error('Zone invalide.');if(mode!=='all'){
  const box=spatialBounds(query.get('bbox'));if(!box)throw Error('Emprise requise.');const [west,south,east,north]=box.map(bind),inside=field=>`((a.data->'${field}'->>0)::double precision BETWEEN ${south} AND ${north} AND (a.data->'${field}'->>1)::double precision BETWEEN ${west} AND ${east})`;
  where.push(mode==='both'?`(${inside('start_point')} AND ${inside('end_point')})`:inside(mode==='start'?'start_point':'end_point'));
 }
 const offset=Number(query.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>10000000)throw Error('Page invalide.');return {params,where:where.join(' AND '),offset,limit:20};
}

export function createStravaLibrary({decode,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const flights=new Map();let active=0,lastStart=0,pacing=Promise.resolve();
 async function paced(fn){const slot=pacing.then(async()=>{const delay=Math.max(0,lastStart+1000-now());if(delay)await wait(delay);lastStart=now();});pacing=slot.catch(()=>{});await slot;return fn();}
 async function ensure(db,userId,athleteId){return transaction(db,async client=>{
  await lockRideOrigins(client,userId);const connected=await client.query('SELECT athlete_id FROM strava_connections WHERE user_id=$1',[userId]);if(String(connected.rows[0]?.athlete_id)!==String(athleteId))throw Object.assign(Error('Reconnectez votre compte Strava.'),{status:409});
  const q=await client.query('SELECT athlete_id,data FROM strava_library_state WHERE user_id=$1',[userId]),row=q.rows[0];if(row&&String(row.athlete_id)===String(athleteId))return row.data;
  if(row)await client.query('DELETE FROM strava_library_activities WHERE user_id=$1',[userId]);
  const data={revision:randomUUID(),before:Math.floor(now()/1000)+1,page:1,complete:false,refreshedAt:null,head:null};await client.query('INSERT INTO strava_library_state(user_id,athlete_id,data) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET athlete_id=EXCLUDED.athlete_id,data=EXCLUDED.data',[userId,athleteId,JSON.stringify(data)]);return data;
 });}
 async function status(db,userId){
  const [state,counts]=await Promise.all([db.query('SELECT athlete_id,data FROM strava_library_state WHERE user_id=$1',[userId]),db.query('SELECT count(*)::int AS checked,count(*) FILTER (WHERE cycling)::int AS indexed,min(started_at) AS oldest FROM strava_library_activities WHERE user_id=$1',[userId])]);
  const data=state.rows[0]?.data,count=counts.rows[0]||{};return {cursor:data?[data.revision,data.page,data.head?.id||'',data.head?.page||0].join(':'):null,complete:data?.complete===true,headPending:!!data?.head&&!data.head.done,indexed:count.indexed||0,checked:count.checked||0,oldest:count.oldest||null,refreshedAt:data?.refreshedAt||null,needsRefresh:!data?.refreshedAt||now()-Date.parse(data.refreshedAt)>15*60000};
 }
 async function read(db,userId,athleteId,query){
  if(query.get('view')==='map'){
   await ensure(db,userId,athleteId);const filter=libraryQuery(userId,query);
   const rows=await db.query('SELECT a.data,r.id AS ride_id FROM strava_library_activities a LEFT JOIN rides r ON r.user_id=a.user_id AND r.strava_activity_id=a.activity_id WHERE '+filter.where+' ORDER BY a.started_at DESC NULLS LAST,a.activity_id DESC',filter.params);
   return {connected:true,items:rows.rows.map(row=>({id:row.data.id,name:row.data.name,preview:row.data.preview||[],rideId:row.ride_id||null})),total:rows.rows.length,status:await status(db,userId)};
  }
  await ensure(db,userId,athleteId);const filter=libraryQuery(userId,query),count=await db.query('SELECT count(*)::int AS total FROM strava_library_activities a WHERE '+filter.where,filter.params),params=[...filter.params,filter.limit,filter.offset];
  filter.offset=Math.min(filter.offset,Math.max(0,Math.ceil((count.rows[0]?.total||0)/filter.limit)-1)*filter.limit);params[params.length-1]=filter.offset;
  const rows=await db.query('SELECT a.data,r.id AS ride_id FROM strava_library_activities a LEFT JOIN rides r ON r.user_id=a.user_id AND r.strava_activity_id=a.activity_id WHERE '+filter.where+` ORDER BY a.started_at DESC NULLS LAST,a.activity_id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
  return {connected:true,items:rows.rows.map(row=>({...row.data,rideId:row.ride_id||null,isMine:true})),total:count.rows[0]?.total||0,offset:filter.offset,limit:filter.limit,status:await status(db,userId)};
 }
 function sync(db,userId,athleteId,fetchPage,{refresh=false}={}){
  if(flights.has(userId))return flights.get(userId);if(active>=2)return Promise.reject(Object.assign(Error('Deux synchronisations Strava sont en cours. Réessayez dans quelques instants.'),{status:429}));active++;
  const job=(async()=>{
   let state=await ensure(db,userId,athleteId);
   if((refresh||state.complete&&(!state.head||state.head.done)&&(!state.refreshedAt||now()-Date.parse(state.refreshedAt)>15*60000))&&(!state.head||state.head.done)){
    await transaction(db,async client=>{await lockRideOrigins(client,userId);const connection=await client.query('SELECT athlete_id FROM strava_connections WHERE user_id=$1',[userId]);if(String(connection.rows[0]?.athlete_id)!==String(athleteId))throw Object.assign(Error('Reconnectez votre compte Strava.'),{status:409});const current=await client.query('SELECT athlete_id,data FROM strava_library_state WHERE user_id=$1 FOR UPDATE',[userId]);if(String(current.rows[0]?.athlete_id)!==String(athleteId))throw Object.assign(Error('Reconnectez votre compte Strava.'),{status:409});state=current.rows[0].data;if(!state.head||state.head.done){state={...state,head:{id:randomUUID(),before:Math.floor(now()/1000)+1,page:1,done:false}};await client.query('UPDATE strava_library_state SET data=$1 WHERE user_id=$2 AND athlete_id=$3',[JSON.stringify(state),userId,athleteId]);}});
   }
   if(!state)throw Object.assign(Error('Reconnectez votre compte Strava.'),{status:409});
   const head=state.head&&!state.head.done,task=head?state.head:state;if(!head&&state.complete)return status(db,userId);
   const all=await paced(()=>fetchPage({page:task.page,before:task.before,perPage:200}));if(!Array.isArray(all)||all.length>200)throw Error('Réponse Strava invalide.');const rows=all.map(a=>activityMetadata(a,decode));
   await transaction(db,async client=>{
    await lockRideOrigins(client,userId);const connection=await client.query('SELECT athlete_id FROM strava_connections WHERE user_id=$1',[userId]);if(String(connection.rows[0]?.athlete_id)!==String(athleteId))throw Object.assign(Error('Reconnectez votre compte Strava.'),{status:409});
    const current=await client.query('SELECT athlete_id,data FROM strava_library_state WHERE user_id=$1 FOR UPDATE',[userId]),latest=current.rows[0]?.data;if(!latest||String(current.rows[0].athlete_id)!==String(athleteId)||latest.revision!==state.revision)return;
    const currentTask=head?latest.head:latest;if(!currentTask||currentTask.page!==task.page||currentTask.before!==task.before||head&&currentTask.id!==task.id)return;
    let overlap=false;if(head&&rows.length){const known=await client.query('SELECT activity_id FROM strava_library_activities WHERE user_id=$1 AND activity_id=ANY($2::bigint[])',[userId,rows.map(r=>r.activity_id)]);overlap=new Set(known.rows.map(r=>String(r.activity_id))).size===new Set(rows.map(r=>r.activity_id)).size;}
    if(rows.length)await client.query(`INSERT INTO strava_library_activities(user_id,activity_id,started_at,cycling,data,search_text) SELECT $1,x.activity_id,x.started_at,x.cycling,x.data,x.search_text FROM jsonb_to_recordset($2::jsonb) AS x(activity_id bigint,started_at timestamptz,cycling boolean,data jsonb,search_text text) ON CONFLICT(user_id,activity_id) DO UPDATE SET started_at=EXCLUDED.started_at,cycling=EXCLUDED.cycling,data=EXCLUDED.data,search_text=EXCLUDED.search_text`,[userId,JSON.stringify(rows)]);
    const done=all.length<200||head&&overlap,next={...latest};if(head){next.head={...latest.head,page:task.page+1,done};if(all.length<200)next.complete=true;}else{next.page=task.page+1;next.complete=done;}if(done&&(head||next.complete))next.refreshedAt=new Date(now()).toISOString();
    await client.query('UPDATE strava_library_state SET data=$1 WHERE user_id=$2 AND athlete_id=$3',[JSON.stringify(next),userId,athleteId]);
   });return status(db,userId);
  })().finally(()=>{active--;if(flights.get(userId)===job)flights.delete(userId);});flights.set(userId,job);return job;
 }
 return {read,sync,status};
}
