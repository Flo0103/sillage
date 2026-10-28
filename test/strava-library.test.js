import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStravaLibrary,activityMetadata,libraryQuery} from '../server/strava-library.js';
// Stateful SQL adapter: no Postgres daemon is available in this workspace.
function fixture(){
 const connections=new Map([['alice','77'],['bob','88']]),states=new Map(),activities=new Map(),calls=[];
 const query=async(sql,args=[])=>{calls.push({sql,args});const user=args[0];let rows=[];
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows};
  if(sql.startsWith('SELECT athlete_id FROM strava_connections'))rows=connections.has(user)?[{athlete_id:connections.get(user)}]:[];
  else if(sql.startsWith('SELECT athlete_id,data FROM strava_library_state'))rows=states.has(user)?[structuredClone(states.get(user))]:[];
  else if(sql.startsWith('INSERT INTO strava_library_state'))states.set(user,{athlete_id:args[1],data:JSON.parse(args[2])});
  else if(sql.startsWith('UPDATE strava_library_state SET data=')){const row=states.get(args[1]);if(row&&row.athlete_id===args[2])row.data=JSON.parse(args[0]);}
  else if(sql.startsWith('DELETE FROM strava_library_activities')){for(const [key,row]of activities)if(row.user===user)activities.delete(key);}
  else if(sql.startsWith('INSERT INTO strava_library_activities')){for(const row of JSON.parse(args[1]))activities.set(user+':'+row.activity_id,{...row,user});}
  else if(sql.startsWith('SELECT activity_id FROM strava_library_activities'))rows=[...activities.values()].filter(r=>r.user===user&&args[1].includes(r.activity_id)).map(r=>({activity_id:r.activity_id}));
  else if(sql.startsWith('SELECT count(*)::int AS checked')){const own=[...activities.values()].filter(r=>r.user===user);rows=[{checked:own.length,indexed:own.filter(r=>r.cycling).length,oldest:own.map(r=>r.started_at).sort()[0]||null}];}
  else if(sql.includes('FROM strava_library_activities a')){
   let result=[...activities.values()].filter(r=>r.user===user&&r.cycling);if(sql.includes("a.data->>'sportType'='GravelRide'"))result=result.filter(r=>r.data.sportType==='GravelRide');
   for(const match of sql.matchAll(/strpos\(a.search_text,\$(\d+)\)>0/g))result=result.filter(r=>r.search_text.includes(args[Number(match[1])-1]));
   result.sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))||Number(b.activity_id)-Number(a.activity_id));
   rows=sql.startsWith('SELECT count')?[{total:result.length}]:(sql.includes(' LIMIT ')?result.slice(args.at(-1),args.at(-1)+args.at(-2)):result).map(r=>({data:r.data,ride_id:null}));
  }else throw Error('SQL non simulé : '+sql);
  return {rows};
 };
 const db={query,connect:async()=>({query,release(){}})},clock={time:Date.UTC(2026,9,27)},library=createStravaLibrary({decode:()=>[[50,5],[50.1,5]],now:()=>clock.time,wait:async ms=>{clock.time+=ms;}});
 return {db,library,connections,states,activities,calls,clock};
}
const activity=(id,extra={})=>({id,name:'Gravel '+id,sport_type:'GravelRide',distance:15000,total_elevation_gain:200,start_date:new Date(Date.UTC(2026,9,27)-id*86400000).toISOString(),start_latlng:[50,5],end_latlng:[50.1,5],...extra});

test('historique > 300 : les pages non gravel n’arrêtent pas la recherche des anciennes sorties',async()=>{
 const f=fixture(),all=Array.from({length:451},(_,i)=>activity(i+1,{sport_type:i<400?'Run':'GravelRide',name:i===450?'Fagnes d’été':'Sortie '+i})),requests=[];
 const fetchPage=async params=>{requests.push(params);return all.slice((params.page-1)*200,params.page*200);};
 await f.library.read(f.db,'alice','77',new URLSearchParams());
 for(let i=0;i<3;i++)await f.library.sync(f.db,'alice','77',fetchPage);
 const result=await f.library.read(f.db,'alice','77',new URLSearchParams({q:'fagnes ete'}));assert.equal(result.items.length,1);assert.equal(result.items[0].id,'451');assert.equal(result.status.checked,451);assert.equal(result.status.indexed,51);assert.equal(result.status.complete,true);assert.equal(new Set(requests.map(r=>r.before)).size,1);assert.ok(requests.every(r=>r.perPage===200));
 const page=await f.library.read(f.db,'alice','77',new URLSearchParams({offset:'20'}));assert.equal(page.total,51);assert.equal(page.items.length,20);assert.equal(page.offset,20);
 const clamped=await f.library.read(f.db,'alice','77',new URLSearchParams({q:'fagnes',offset:'40'}));assert.equal(clamped.offset,0);assert.equal(clamped.items.length,1);
});
test('carte Strava : tous les résultats filtrés au-delà de vingt, privés et sans appel à l’API Strava',async()=>{
 const f=fixture();let requests=0;await f.library.sync(f.db,'alice','77',async()=>{requests++;return Array.from({length:65},(_,i)=>activity(i+1,{name:i<55?'Fagnes '+i:'Autre',sport_type:i===0?'Run':'GravelRide'}));});await f.library.sync(f.db,'bob','88',async()=>{requests++;return [activity(99,{name:'Fagnes privées Bob'})];});
 const page=await f.library.read(f.db,'alice','77',new URLSearchParams({q:'fagnes'}));assert.equal(page.items.length,20);assert.equal(page.total,54);
 const result=await f.library.read(f.db,'alice','77',new URLSearchParams({q:'fagnes',view:'map',offset:'40',distanceMin:'10',ascentMax:'500',mapFilter:'both',bbox:'5,50,6,51'}));assert.equal(result.items.length,54);assert.equal(result.total,54);assert.equal(requests,2);assert.ok(result.items.every(r=>r.name.startsWith('Fagnes ')&&r.preview.length===2));assert.ok(!result.items.some(r=>r.id==='99'));assert.deepEqual(Object.keys(result.items[0]).sort(),['id','name','preview','rideId']);
 const sql=f.calls.findLast(c=>c.sql.startsWith('SELECT a.data'));assert.doesNotMatch(sql.sql,/LIMIT|OFFSET/);assert.match(sql.sql,/a.user_id=\$1/);assert.match(sql.sql,/start_point/);assert.match(sql.sql,/end_point/);assert.ok(sql.args.includes(10000));assert.ok(sql.args.includes(500));assert.equal(result.status.complete,true);
 f.connections.delete('alice');await assert.rejects(f.library.read(f.db,'alice','77',new URLSearchParams({view:'map'})),e=>e.status===409);
});
test('quota : cache et curseur conservés, reprise à la page interrompue',async()=>{
 const f=fixture(),batch=Array.from({length:200},(_,i)=>activity(i+1));await f.library.sync(f.db,'alice','77',async()=>batch);const before=structuredClone(f.states.get('alice').data);
 await assert.rejects(f.library.sync(f.db,'alice','77',async()=>{throw Object.assign(Error('Quota'),{status:429});}),e=>e.status===429);assert.deepEqual(f.states.get('alice').data,before);
 let page;await f.library.sync(f.db,'alice','77',async p=>{page=p.page;return [activity(201)];});assert.equal(page,2);assert.equal((await f.library.status(f.db,'alice')).checked,201);assert.equal((await f.library.status(f.db,'alice')).complete,true);
});
test('filtrer l’index ne consomme pas l’API et ne révèle pas les sorties d’un autre membre',async()=>{
 const f=fixture();await f.library.sync(f.db,'alice','77',async()=>[activity(1,{name:'Privé Alice'})]);await f.library.sync(f.db,'bob','88',async()=>[activity(2,{name:'Privé Bob'})]);
 const result=await f.library.read(f.db,'bob','88',new URLSearchParams({q:'alice'}));assert.equal(result.total,0);assert.deepEqual(result.items,[]);const own=await f.library.read(f.db,'bob','88',new URLSearchParams());assert.equal(own.items[0].name,'Privé Bob');assert.ok(f.calls.filter(c=>c.sql.startsWith('SELECT a.data')).every(c=>c.sql.includes('r.user_id=a.user_id')&&c.sql.includes('a.user_id=$1')));
});
test('actualisation : nouvelles sorties ajoutées, curseur historique conservé et doublons évités',async()=>{
 const f=fixture(),batch=Array.from({length:200},(_,i)=>activity(i+1));await f.library.sync(f.db,'alice','77',async()=>batch);await f.library.sync(f.db,'alice','77',async()=>[activity(201)]);const historical=f.states.get('alice').data.page;
 const first=await f.library.sync(f.db,'alice','77',async params=>{assert.equal(params.page,1);return [activity(999),...batch.slice(0,199)];},{refresh:true});assert.equal(first.headPending,true);
 const second=await f.library.sync(f.db,'alice','77',async params=>{assert.equal(params.page,2);return batch;});assert.equal(second.complete,true);assert.equal(second.headPending,false);assert.equal(second.checked,202);assert.equal(f.states.get('alice').data.page,historical);
 let fetched=false;await f.library.sync(f.db,'alice','77',async()=>{fetched=true;return [];});assert.equal(fetched,false);
});
test('un seul lot en cours par utilisateur, sans connexion SQL retenue pendant l’appel Strava',async()=>{
 const f=fixture();let release;const fetchPage=()=>new Promise(r=>release=r),one=f.library.sync(f.db,'alice','77',fetchPage),two=f.library.sync(f.db,'alice','77',fetchPage);assert.equal(one,two);await new Promise(r=>setImmediate(r));assert.equal(f.calls.at(-1).sql,'COMMIT');release([activity(1)]);await one;assert.equal(f.activities.size,1);
});
test('révocation pendant la synchronisation : aucune écriture tardive des métadonnées',async()=>{
 const f=fixture();let release;const job=f.library.sync(f.db,'alice','77',()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));f.connections.delete('alice');f.states.delete('alice');release([activity(1)]);await assert.rejects(job,e=>e.status===409);assert.equal(f.activities.size,0);
});
test('changement d’athlète ou suppression d’activité invalide un ancien lot en vol',async()=>{
 const f=fixture();let release;const job=f.library.sync(f.db,'alice','77',()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));f.states.get('alice').data.revision='new-revision';release([activity(1)]);await job;assert.equal(f.activities.size,0);assert.equal(f.states.get('alice').data.page,1);
 f.connections.set('alice','99');f.activities.set('alice:9',{user:'alice',activity_id:'9'});await f.library.read(f.db,'alice','99',new URLSearchParams());assert.equal(f.activities.size,0);assert.equal(f.states.get('alice').athlete_id,'99');
});
test('filtres SQL : accents, mots, distance, dénivelé et emprise paramétrés',()=>{
 const result=libraryQuery('alice',new URLSearchParams({q:"Été ' OR 1=1",kind:'cycling',distanceMin:'12',ascentMax:'750',mapFilter:'both',bbox:'5,50,6,51'}));assert.equal(result.params[0],'alice');assert.ok(result.params.includes('ete'));assert.ok(result.params.includes("'"));assert.ok(result.params.includes(12000));assert.ok(result.params.includes(750));assert.match(result.where,/start_point/);assert.match(result.where,/end_point/);assert.doesNotMatch(result.where,/OR 1=1/);
 for(const input of [{q:'x'.repeat(201)},{offset:'-1'},{offset:'0.5'},{distanceMin:'NaN'},{mapFilter:'both'},{bbox:'6,50,5,51',mapFilter:'start'}])assert.throws(()=>libraryQuery('alice',new URLSearchParams(input)));
});
test('métadonnées bornées : pas de nom ni de position pour les activités autres que vélo',()=>{
 const run=activityMetadata(activity(1,{sport_type:'Run',name:'Secret run'}),()=>[[50,5]]);assert.equal(run.cycling,false);assert.equal(run.data.name,'');assert.equal(run.data.start_point,null);assert.deepEqual(run.data.preview,[]);
 const ride=activityMetadata(activity(2),()=>Array.from({length:1000},(_,i)=>[50+i/1e5,5]));assert.equal(ride.data.preview.length,250);assert.equal(ride.data.ascent,200);assert.throws(()=>activityMetadata({id:'invalid'},()=>[]));
});
