import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {exportLayers,spatialExport} from '../server/spatial-export.js';

const snapshot={exportedAt:'2026-10-29T12:34:56.000Z',segments:{type:'FeatureCollection',features:[{type:'Feature',id:'s1',geometry:{type:'LineString',coordinates:[[5,50],[5.01,50.02]]},properties:{id:'s1',name:'Secteur été',rating:4,isPublic:false,sourceRideId:'r1',fromStrava:true,notes:'Roches & forêt'}}]},itineraries:[{id:'p1',name:'Boucle',coordinates:[[51,6],[51.01,6.02]],legs:[{analysis:{elevation:{profile:[{at:0,altitude:123}]}}}],createdAt:new Date('2026-01-01T00:00:00Z')}],rides:[{id:'r1',name:'Sortie GPX',coordinates:[[49,4],[49.1,4.2]],gpx:'<gpx>original</gpx>',sourceType:'gpx',distance:1234},{id:'r2',name:'Sortie Strava',coordinates:[[48,3],[48.1,3.2]],gpx:null,sourceType:'strava',stravaActivityId:'12345678901234567'}],account:{username:'alice'},wmsLayers:[{name:'Non spatial'}]};

function unzip(bytes){
 const entries={};let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  assert.equal(bytes.readUInt16LE(offset+8),8);const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+30,offset+30+length).toString(),start=offset+30+length+extra;
  const raw=inflateRawSync(bytes.subarray(start,start+size));assert.equal(raw.length,bytes.readUInt32LE(offset+22));entries[name]=JSON.parse(raw);offset=start+size;
 }
 assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);assert.equal(bytes.readUInt16LE(bytes.length-12),3);return entries;
}

async function openPackage(body,fn){
 const dir=await mkdtemp(join(tmpdir(),'sillage-export-test-'));let db;
 try{const path=join(dir,'test.gpkg');await writeFile(path,body);db=new DatabaseSync(path,{readOnly:true});await fn(db);}finally{try{db?.close();}finally{await rm(dir,{recursive:true,force:true});}}
}

test('ZIP : trois GeoJSON séparés, géométries lon/lat, identifiants et attributs conservés',async()=>{
 const file=await spatialExport(snapshot,'geojson');assert.equal(file.extension,'zip');assert.equal(file.contentType,'application/zip');const entries=unzip(file.body);
 assert.deepEqual(Object.keys(entries),['secteurs.geojson','itineraires.geojson','sorties.geojson']);
 for(const layer of Object.values(entries))assert.equal(layer.type,'FeatureCollection');
 assert.equal(entries['secteurs.geojson'].features[0].properties.notes,'Roches & forêt');assert.equal(entries['secteurs.geojson'].features[0].properties.fromStrava,true);
 assert.deepEqual(entries['itineraires.geojson'].features[0].geometry.coordinates,[[6,51],[6.02,51.01]]);assert.deepEqual(entries['sorties.geojson'].features[0].geometry.coordinates,[[4,49],[4.2,49.1]]);
 assert.equal(entries['sorties.geojson'].features.length,2);assert.equal(entries['sorties.geojson'].features[0].properties.gpx,snapshot.rides[0].gpx);assert.equal(entries['sorties.geojson'].features[1].properties.stravaActivityId,snapshot.rides[1].stravaActivityId);
 assert.equal(entries['itineraires.geojson'].features[0].properties.legs[0].analysis.elevation.profile[0].altitude,123);assert.equal(entries['itineraires.geojson'].features[0].properties.coordinates,undefined);
});

test('GPKG : trois couches SIG valides, même contenu, WKB, emprises et types des attributs',async()=>{
 const file=await spatialExport(snapshot,'gpkg');assert.equal(file.contentType,'application/geopackage+sqlite3');assert.equal(file.extension,'gpkg');assert.equal(file.body.subarray(0,16).toString(),'SQLite format 3\0');
 await openPackage(file.body,db=>{
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('PRAGMA application_id').get().application_id,0x47504b47);assert.equal(db.prepare('PRAGMA user_version').get().user_version,10300);
  const contents=db.prepare('SELECT * FROM gpkg_contents ORDER BY table_name').all();assert.deepEqual(contents.map(r=>r.table_name),['itineraires','secteurs','sorties']);
  assert.deepEqual(db.prepare('SELECT srs_id FROM gpkg_spatial_ref_sys ORDER BY srs_id').all().map(r=>r.srs_id),[-1,0,4326]);
  for(const row of db.prepare('SELECT * FROM gpkg_geometry_columns').all()){assert.equal(row.geometry_type_name,'LINESTRING');assert.equal(row.srs_id,4326);assert.equal(row.z,0);assert.equal(row.m,0);}
  for(const [name,layer] of Object.entries(exportLayers(snapshot))){
   const rows=db.prepare(`SELECT * FROM ${name} ORDER BY fid`).all();assert.equal(rows.length,layer.features.length);
   for(let i=0;i<rows.length;i++){
    const row=rows[i],feature=layer.features[i],blob=Buffer.from(row.geom);assert.equal(row.id,feature.id);assert.equal(row.name,feature.properties.name);assert.equal(blob.subarray(0,2).toString(),'GP');assert.equal(blob[2],0);assert.equal(blob[3],3);assert.equal(blob.readInt32LE(4),4326);assert.equal(blob[40],1);assert.equal(blob.readUInt32LE(41),2);assert.equal(blob.readUInt32LE(45),feature.geometry.coordinates.length);
    assert.deepEqual(feature.geometry.coordinates.map((_,j)=>[blob.readDoubleLE(49+j*16),blob.readDoubleLE(57+j*16)]),feature.geometry.coordinates);
   }
  }
  const sector=db.prepare('SELECT * FROM secteurs').get();assert.equal(sector.rating,4);assert.equal(sector.isPublic,0);assert.equal(sector.fromStrava,1);assert.equal(sector.sourceRideId,'r1');
  const plan=db.prepare('SELECT * FROM itineraires').get();assert.deepEqual(JSON.parse(plan.legs),snapshot.itineraries[0].legs);assert.equal(plan.createdAt,'2026-01-01T00:00:00.000Z');
  const rides=contents.find(r=>r.table_name==='sorties');assert.deepEqual([rides.min_x,rides.min_y,rides.max_x,rides.max_y],[3,48,4.2,49.1]);assert.equal(rides.last_change,snapshot.exportedAt);
  assert.equal(db.prepare('SELECT stravaActivityId FROM sorties WHERE id=?').get('r2').stravaActivityId,'12345678901234567');
 });
});

test('compte vide : les trois fichiers et tables sont présents et vides',async()=>{
 const empty={exportedAt:snapshot.exportedAt,segments:{type:'FeatureCollection',features:[]},itineraries:[],rides:[]};
 for(const layer of Object.values(unzip((await spatialExport(empty,'geojson')).body)))assert.deepEqual(layer.features,[]);
 await openPackage((await spatialExport(empty,'gpkg')).body,db=>{
  assert.equal(db.prepare('SELECT count(*) AS n FROM gpkg_contents').get().n,3);
  for(const name of ['secteurs','itineraires','sorties']){assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n,0);assert.equal(db.prepare('SELECT min_x FROM gpkg_contents WHERE table_name=?').get(name).min_x,null);}
 });
 await assert.rejects(spatialExport(empty,'csv'),/invalide/);
});
