// Run only against a disposable database: this test exercises the legacy FK migration.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool, migrate} from '../server/db.js';
import {createStrava, tokenCipher} from '../server/strava.js';
import {createPlanEnrichment,planData} from '../server/plans.js';

test('PostGIS natif : migrations réexécutables, géométries, conservation et révocation',async t=>{
 t.after(()=>pool.end());
 await migrate();
 const userId=randomUUID(),rideId=randomUUID(),portionId=randomUUID(),planId=randomUUID();
 const points=[[50,5],[50.001,5.002]],data={name:'Contrôle CI',coordinates:points};
 await pool.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[userId,'ci-'+userId,'unused-ci-password-hash']);
 try{
  await pool.query('INSERT INTO rides(id,user_id,name,coordinates,distance) VALUES($1,$2,$3,$4,100)',[rideId,userId,data.name,JSON.stringify(points)]);
  await pool.query('INSERT INTO portions(id,user_id,data,source_ride_id) VALUES($1,$2,$3,$4)',[portionId,userId,JSON.stringify(data),rideId]);
  await pool.query('INSERT INTO planned_routes(id,user_id,data,source_ride_id) VALUES($1,$2,$3,$4)',[planId,userId,JSON.stringify(data),rideId]);
  // Recreate the historical cascade, then migrate a database containing data.
  await pool.query('ALTER TABLE portions DROP CONSTRAINT portions_source_ride_id_fkey');
  await pool.query('ALTER TABLE portions ADD CONSTRAINT portions_source_ride_id_fkey FOREIGN KEY(source_ride_id) REFERENCES rides(id) ON DELETE CASCADE');
  const key='12'.repeat(32),webhookSecret='ab'.repeat(32),athleteId='77';
  const tokens=tokenCipher(key).seal({access_token:'CI_ONLY',refresh_token:'CI_ONLY',expires_at:9999999999},userId);
  await pool.query('INSERT INTO strava_connections(user_id,athlete_id,tokens) VALUES($1,$2,$3)',[userId,athleteId,tokens]);
  const original=(await pool.query('SELECT revision FROM strava_connections WHERE user_id=$1',[userId])).rows[0].revision;
  await migrate();await migrate();
  assert.equal((await pool.query('SELECT revision FROM strava_connections WHERE user_id=$1',[userId])).rows[0].revision,original);
  for(const [table,id] of [['rides',rideId],['portions',portionId],['planned_routes',planId]]){
   const result=await pool.query('SELECT ST_SRID(geom) AS srid,ST_AsGeoJSON(geom)::json AS geometry FROM '+table+' WHERE id=$1',[id]);
   assert.equal(result.rows[0].srid,4326);assert.deepEqual(result.rows[0].geometry.coordinates,points.map(([lat,lon])=>[lon,lat]));
  }
  await pool.query('DELETE FROM rides WHERE id=$1',[rideId]);
  for(const [table,id] of [['portions',portionId],['planned_routes',planId]]){
   const result=await pool.query('SELECT data,source_ride_id FROM '+table+' WHERE id=$1',[id]);
   assert.deepEqual(result.rows[0].data,data);assert.equal(result.rows[0].source_ride_id,null);
  }
  // The background analysis must update only analyses, preserving concurrent metadata edits.
  const convertedId=randomUUID(),converted={...planData({name:'Converti',coordinates:points,legs:[{mode:'manual',coordinates:points}]}),id:convertedId,analysisStatus:'pending'};
  await pool.query('INSERT INTO planned_routes(id,user_id,data,is_public) VALUES($1,$2,$3,false)',[convertedId,userId,JSON.stringify(converted)]);
  const analysis={elevation:{ascent:10,descent:0,profile:[{at:0,altitude:100},{at:converted.distance,altitude:110}]},surfaces:[{type:'Sable',distance:converted.distance}],surfaceRuns:[{type:'Sable',unpaved:true,coordinates:points}],surfaceVersion:2,errors:[]};
  let finish;const enrich=createPlanEnrichment({db:pool,metrics:()=>new Promise(resolve=>{finish=()=>resolve(analysis);})}),analysisJob=enrich(converted,userId);
  await pool.query("UPDATE planned_routes SET data=jsonb_set(data,'{name}','\"Renommé pendant l’analyse\"'::jsonb) WHERE id=$1",[convertedId]);finish();await analysisJob;
  const enriched=(await pool.query('SELECT data,is_public,ST_AsGeoJSON(geom)::json AS geometry FROM planned_routes WHERE id=$1',[convertedId])).rows[0];assert.equal(enriched.data.analysisStatus,'complete');assert.equal(enriched.data.name,'Renommé pendant l’analyse');assert.equal(enriched.data.legs[0].analysis.elevation.ascent,10);assert.equal(enriched.data.legs[0].analysis.surfaces[0].type,'Sable');assert.equal(enriched.is_public,false);assert.deepEqual(enriched.geometry.coordinates,points.map(([lat,lon])=>[lon,lat]));
  await pool.query('UPDATE planned_routes SET data=$1 WHERE id=$2',[JSON.stringify(converted),convertedId]);const discarded=enrich(converted,userId);await pool.query('DELETE FROM planned_routes WHERE id=$1',[convertedId]);finish();await discarded;assert.equal((await pool.query('SELECT count(*)::int AS count FROM planned_routes WHERE id=$1',[convertedId])).rows[0].count,0);
  const reached=Promise.withResolvers(),resume=Promise.withResolvers();
  const service=createStrava({clientId:'123',clientSecret:'CI_ONLY',key,webhookSecret,fetcher:async url=>{
   if(url.includes('/streams')){reached.resolve();await resume.promise;return Response.json({latlng:{data:points}});}
   return Response.json({id:101,sport_type:'GravelRide',athlete:{id:77}});
  }});
  const run=(path,body)=>service({db:pool,path,method:'POST',user:{id:userId},req:{headers:{}},query:new URLSearchParams(),body:async()=>body,res:{},json(){}});
  const pending=assert.rejects(run('/api/strava/import',{activityId:'101'}),error=>error.status===409);
  await reached.promise;
  await run('/api/strava/webhook/'+webhookSecret,{owner_id:77,object_type:'activity',aspect_type:'delete',object_id:101});
  resume.resolve();await pending;
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM rides WHERE user_id=$1',[userId])).rows[0].count,0);
  assert.notEqual((await pool.query('SELECT revision FROM strava_connections WHERE user_id=$1',[userId])).rows[0].revision,original);
 }finally{
  await pool.query('DELETE FROM users WHERE id=$1',[userId]);
 }
});
