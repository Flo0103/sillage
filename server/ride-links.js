import {transaction} from './features.js';
export const lockRideOrigins=(client,userId)=>client.query("SELECT pg_advisory_xact_lock(hashtext('sillage-ride-origins'),hashtext($1))",[userId]);
export const withRideOrigins=(db,userId,fn)=>transaction(db,async client=>{await lockRideOrigins(client,userId);return fn(client);});
// Keep derived drawings when a ride is removed, while retaining Strava origin
// independently of the ride so revocation still removes the correct data.
export async function migrateRideLinks(db){
 const client=await db.connect();try{
  await client.query('BEGIN');
  await client.query(`ALTER TABLE portions ADD COLUMN IF NOT EXISTS source_strava_activity_id bigint;
ALTER TABLE planned_routes ADD COLUMN IF NOT EXISTS source_ride_id uuid REFERENCES rides(id) ON DELETE SET NULL;
ALTER TABLE planned_routes ADD COLUMN IF NOT EXISTS source_strava boolean NOT NULL DEFAULT false;
ALTER TABLE planned_routes ADD COLUMN IF NOT EXISTS source_strava_activity_id bigint;
UPDATE portions p SET source_strava_activity_id=r.strava_activity_id FROM rides r WHERE p.source_ride_id=r.id AND p.source_strava=true AND p.source_strava_activity_id IS NULL;
CREATE INDEX IF NOT EXISTS portions_strava_origin ON portions(user_id,source_strava_activity_id) WHERE source_strava=true;
CREATE INDEX IF NOT EXISTS plans_strava_origin ON planned_routes(user_id,source_strava_activity_id) WHERE source_strava=true;`);
  const q=await client.query(`SELECT c.conname,c.confdeltype FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='source_ride_id' WHERE c.conrelid='portions'::regclass AND c.confrelid='rides'::regclass AND c.contype='f' AND c.conkey=ARRAY[a.attnum]`);
  let retained=false;for(const row of q.rows){if(row.confdeltype==='n'){retained=true;continue;}const quoted='"'+row.conname.replaceAll('"','""')+'"';await client.query('ALTER TABLE portions DROP CONSTRAINT '+quoted);}
  if(!retained)await client.query('ALTER TABLE portions ADD CONSTRAINT portions_source_ride_id_fkey FOREIGN KEY(source_ride_id) REFERENCES rides(id) ON DELETE SET NULL');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
