// A consistent, owner-only snapshot. Authentication material is never selected.
export async function accountExport(db,userId){
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const account=await client.query('SELECT id,username,is_admin,active,created_at FROM users WHERE id=$1',[userId]);
  if(!account.rows[0])throw Error('Compte introuvable.');
  const rides=await client.query('SELECT id,name,coordinates,distance,gpx_xml,file_name,source_type,strava_activity_id,created_at FROM rides WHERE user_id=$1 ORDER BY created_at,id',[userId]);
  const portions=await client.query('SELECT id,data,is_public,source_ride_id,source_strava,legacy_id,created_at FROM portions WHERE user_id=$1 ORDER BY created_at,id',[userId]);
  const plans=await client.query('SELECT id,data,is_public,created_at,updated_at FROM planned_routes WHERE user_id=$1 ORDER BY created_at,id',[userId]);
  const layers=await client.query('SELECT id,config,created_at FROM wms_layers WHERE user_id=$1 ORDER BY created_at,id',[userId]);
  const strava=await client.query('SELECT athlete_id FROM strava_connections WHERE user_id=$1',[userId]);
  const profile=account.rows[0];
  const data={format:'sillage-account-export',version:1,exportedAt:new Date().toISOString(),coordinateOrder:{rides:'latitude,longitude',itineraries:'latitude,longitude',segments:'longitude,latitude (GeoJSON)'},account:{id:profile.id,username:profile.username,isAdmin:profile.is_admin,active:profile.active,createdAt:profile.created_at},rides:rides.rows.map(r=>({id:r.id,name:r.name,coordinates:r.coordinates,distance:r.distance,gpx:r.gpx_xml,fileName:r.file_name,sourceType:r.source_type,stravaActivityId:r.strava_activity_id,createdAt:r.created_at})),segments:{type:'FeatureCollection',features:portions.rows.map(r=>{const {coordinates,...attributes}=r.data;return {type:'Feature',id:r.id,geometry:{type:'LineString',coordinates:coordinates.map(p=>[p[1],p[0]])},properties:{...attributes,id:r.id,isPublic:r.is_public,sourceRideId:r.source_ride_id,fromStrava:r.source_strava,legacyId:r.legacy_id,createdAt:r.created_at}};})},itineraries:plans.rows.map(p=>({...p.data,id:p.id,isPublic:p.is_public,createdAt:p.created_at,updatedAt:p.updated_at})),wmsLayers:layers.rows.map(w=>({...w.config,id:w.id,createdAt:w.created_at})),stravaConnection:strava.rows[0]?{athleteId:strava.rows[0].athlete_id}:null};
  await client.query('COMMIT');return data;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
