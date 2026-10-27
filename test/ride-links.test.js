import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrateRideLinks,withRideOrigins} from '../server/ride-links.js';
function fixture(rows=[],fail=false){const calls=[];let released=false;return {calls,get released(){return released;},async connect(){return {async query(sql,args){calls.push({sql,args});if(fail&&sql.startsWith('ALTER TABLE portions ADD CONSTRAINT'))throw Error('DDL refused');return {rows:sql.startsWith('SELECT c.conname')?rows:[]};},release(){released=true;}};}};}
test('migration des liens : remplace une ancienne cascade par SET NULL, conserve les données et complète la provenance',async()=>{
 const db=fixture([{conname:'ancien"lien',confdeltype:'c'}]);await migrateRideLinks(db);assert.equal(db.calls[0].sql,'BEGIN');assert.equal(db.calls.at(-1).sql,'COMMIT');assert.equal(db.released,true);assert.ok(db.calls.some(c=>c.sql==='ALTER TABLE portions DROP CONSTRAINT "ancien""lien"'));assert.ok(db.calls.some(c=>c.sql.includes('FOREIGN KEY(source_ride_id) REFERENCES rides(id) ON DELETE SET NULL')));assert.ok(db.calls.some(c=>c.sql.includes('UPDATE portions p SET source_strava_activity_id=r.strava_activity_id')));assert.ok(!db.calls.some(c=>/DELETE FROM|DROP TABLE|TRUNCATE/.test(c.sql)));
});
test('migration réexécutable : conserve un lien SET NULL déjà correct',async()=>{const db=fixture([{conname:'portions_source_ride_id_fkey',confdeltype:'n'}]);await migrateRideLinks(db);assert.ok(!db.calls.some(c=>/DROP CONSTRAINT|ADD CONSTRAINT/.test(c.sql)));assert.equal(db.calls.at(-1).sql,'COMMIT');});
test('échec de migration : transaction annulée et connexion rendue',async()=>{const db=fixture([{conname:'old',confdeltype:'c'}],true);await assert.rejects(migrateRideLinks(db),/DDL refused/);assert.equal(db.calls.at(-1).sql,'ROLLBACK');assert.equal(db.released,true);});
test('création dérivée : verrou par compte avant le travail, rollback sur erreur',async()=>{
 const db=fixture();await assert.rejects(withRideOrigins(db,'alice',async c=>{assert.match(db.calls.at(-1).sql,/pg_advisory_xact_lock/);assert.deepEqual(db.calls.at(-1).args,['alice']);await c.query('test');throw Error('failed');}),/failed/);assert.equal(db.calls.at(-1).sql,'ROLLBACK');assert.equal(db.released,true);
});
