import {test} from 'node:test';
import assert from 'node:assert/strict';
import {features,wmsConfig} from '../server/features.js';
import {hashPassword,verifyPassword,tokenHash} from '../server/model.js';
import {insertionIndex,routePosition} from '../dist/route-edit.js';
import {previewPath} from '../dist/preview.js';
import {visibleSegments,segmentColor} from '../dist/catalog.js';
const admin={id:'00000000-0000-0000-0000-000000000001',username:'flo',is_admin:true},member={id:'00000000-0000-0000-0000-000000000002',username:'marie'};
function dbWith(fn){const db={calls:[],async query(sql,args=[]){this.calls.push({sql,args});return fn(sql,args);},async connect(){return {query:this.query.bind(this),release(){}};}};return db;}
async function run(db,path,method,user,data={}){let result;await features({db,path,method,user,req:{headers:{},socket:{remoteAddress:'127.0.0.1'}},res:{},body:async()=>data,json:(r,status,body)=>result={status,body},origin:'https://sillage.test',sessionToken:'current-session-hash'});return result;}
test('filtres personnel/public/hiver et palette par revêtement ou note',()=>{const items=[{id:1,isMine:true,isPublic:false,winter:'yes',rating:5,surface:'Grosses pierres / blocs'},{id:2,isMine:false,isPublic:true,winter:'no',rating:1},{id:3,isMine:false,isPublic:false,winter:'yes'}];assert.deepEqual(visibleSegments(items).map(r=>r.id),[1,2]);assert.deepEqual(visibleSegments(items,{mine:false,others:true}).map(r=>r.id),[2]);assert.deepEqual(visibleSegments(items,{winter:'yes'}).map(r=>r.id),[1]);assert.notEqual(segmentColor(items[0],'surface'),segmentColor(items[0],'rating'));assert.notEqual(segmentColor(items[0],'rating'),segmentColor(items[1],'rating'));});
test('WMS HTTPS validé, paramètres de GetCapabilities nettoyés',()=>{const w=wmsConfig({name:'Topo',url:'https://exemple.be/service?request=GetCapabilities&SERVICE=WMS&version=1.3.0&key=ok',layers:'topo'});assert.equal(w.url,'https://exemple.be/service?key=ok');assert.equal(w.version,'1.3.0');for(const url of ['http://example.be/wms','javascript:alert(1)','https://127.0.0.1/wms','https://user:secret@example.be/wms','https://192.168.1.1/wms'])assert.throws(()=>wmsConfig({name:'a',url,layers:'b'}));});
test('changement de mot de passe exige l’ancien et révoque les autres sessions',async()=>{const hash=await hashPassword('ancien-mot-de-passe'),db=dbWith((sql,args)=>sql.includes('RETURNING attempts')?{rows:[{attempts:1}]}:sql.startsWith('SELECT password_hash')?{rows:[{password_hash:hash}]}:{rows:[],rowCount:1});await assert.rejects(run(db,'/api/account/password','POST',member,{currentPassword:'incorrect',newPassword:'nouveau-mot-de-passe'}),/incorrect/);assert.ok(!db.calls.some(c=>c.sql.startsWith('UPDATE users')));const res=await run(db,'/api/account/password','POST',member,{currentPassword:'ancien-mot-de-passe',newPassword:'nouveau-mot-de-passe'});assert.equal(res.status,200);const update=db.calls.find(c=>c.sql.startsWith('UPDATE users'));assert.equal(await verifyPassword('nouveau-mot-de-passe',update.args[0]),true);const revoke=db.calls.find(c=>c.sql.startsWith('DELETE FROM sessions'));assert.deepEqual(revoke.args,[member.id,'current-session-hash']);});
test('invitations : jeton haché, utilisation unique, aucun rôle admin accordé',async()=>{
 let invitation,used=false;const db=dbWith((sql,args)=>{
  if(sql.includes('RETURNING attempts'))return {rows:[{attempts:1}]};
  if(sql.startsWith('SELECT id FROM users'))return {rows:[]};
  if(sql.startsWith('INSERT INTO invitations')){invitation={id:args[0],hash:args[1],username:args[2],user_id:null};return {rowCount:1};}
  if(sql.startsWith('SELECT * FROM invitations'))return {rows:!used&&args[0]===invitation.hash?[invitation]:[]};
  if(sql.startsWith('UPDATE invitations SET used_at'))used=true;
  return {rows:[],rowCount:1};
 });const created=await run(db,'/api/admin/invitations','POST',admin,{username:'marie',isAdmin:true});assert.equal(created.status,201);const token=created.body.url.split('#')[1];assert.equal(invitation.hash,tokenHash(token));assert.notEqual(invitation.hash,token);
 const accepted=await run(db,'/api/accept-invitation','POST',null,{token,password:'mot-de-passe-tres-long'});assert.equal(accepted.status,200);const insert=db.calls.find(c=>c.sql.startsWith('INSERT INTO users'));assert.ok(insert);assert.ok(!insert.sql.includes('is_admin'));assert.equal(await verifyPassword('mot-de-passe-tres-long',insert.args[2]),true);await assert.rejects(run(db,'/api/accept-invitation','POST',null,{token,password:'mot-de-passe-tres-long'}),/déjà utilisée/);
});
test('membre sans privilèges ne peut pas créer une invitation',async()=>{const db=dbWith(()=>{throw Error('Ne doit pas accéder à la DB');});assert.equal((await run(db,'/api/admin/invitations','POST',member,{username:'autre'})).status,403);});
test('un administrateur ne peut pas se désactiver ni supprimer le dernier admin',async()=>{
 const db=dbWith(sql=>sql.startsWith('SELECT id,is_admin,active')?{rows:[{...admin,active:true}]}:{rows:[],rowCount:1});await assert.rejects(run(db,`/api/admin/users/${admin.id}`,'PATCH',admin,{active:false,isAdmin:true}),/propre compte/);
 const other={...member,is_admin:true,active:true},last=dbWith(sql=>sql.startsWith('SELECT id,is_admin,active')?{rows:[other]}:sql.startsWith('SELECT count')?{rows:[{count:1}]}:{rows:[],rowCount:1});await assert.rejects(run(last,`/api/admin/users/${member.id}`,'DELETE',admin),/dernier administrateur/);
});
test('fonds WMS sont enregistrés et supprimés uniquement dans le compte connecté',async()=>{
 const db=dbWith(()=>({rows:[],rowCount:0}));const created=await run(db,'/api/wms','POST',member,{name:'Topo',url:'https://carto.example.be/wms',layers:'topo'});assert.equal(created.status,201);const insert=db.calls.find(c=>c.sql.startsWith('INSERT INTO wms_layers'));assert.equal(insert.args[1],member.id);await run(db,`/api/wms/${created.body.id}`,'DELETE',member);const del=db.calls.find(c=>c.sql.startsWith('DELETE FROM wms_layers'));assert.equal(del.args[1],member.id);assert.match(del.sql,/user_id=\$2/);
});

test('single tracks filtrés en préservant les anciens segments non renseignés',()=>{
 const items=[{id:1,isMine:true,singleTrack:'yes'},{id:2,isMine:true,singleTrack:'no'},{id:3,isMine:true}];
 assert.deepEqual(visibleSegments(items,{singleTrack:'yes'}).map(s=>s.id),[1]);assert.deepEqual(visibleSegments(items,{singleTrack:'no'}).map(s=>s.id),[2]);assert.deepEqual(visibleSegments(items,{singleTrack:'unknown'}).map(s=>s.id),[3]);
 assert.notEqual(segmentColor(items[0],'singleTrack'),segmentColor(items[1],'singleTrack'));assert.match(segmentColor(items[2],'singleTrack'),/^#/);
});

test('aperçu SVG conserve proportions et bornes avec coordonnées arrondies sûres',()=>{
 for(const points of [[[50,5],[50.01,5]],[[50,5],[50,5.01]],[[50,5],[50.01,5.01]],[[50,5],[50,5]]]){
  const path=previewPath(points);assert.match(path,/^M[0-9.,]+ L[0-9.,]+$/);const pairs=[...path.matchAll(/[ML]([0-9.]+),([0-9.]+)/g)];assert.equal(pairs.length,2);for(const p of pairs){assert.ok(Number(p[1])>=0&&Number(p[1])<=320);assert.ok(Number(p[2])>=0&&Number(p[2])<=136);}
 }
 assert.equal(previewPath([]),'');assert.equal(previewPath([[NaN,5],[50,5]]),'');assert.equal(previewPath(Array.from({length:1000},(_,i)=>[50,5+i*.0001])).split(' ').length,500);
});

test('insertion de passage respecte l’ordre sur un chemin sinueux',()=>{
 const path=[[50,5],[50.01,5],[50.01,5.01],[50,5.01]],controls=[path[0],path[2],path[3]];
 assert.equal(insertionIndex(path,controls,[50.009,5.0001]),1);assert.equal(insertionIndex(path,controls,[50.002,5.01]),2);
 assert.equal(insertionIndex(path,[path[0],path[3]],[50.01,5.005]),1);
 assert.equal(insertionIndex(path,controls,[50.002,5.01],[0,.62,1]),2);
 assert.ok(routePosition(path,[50.005,5])<routePosition(path,[50.005,5.01]));
});


test('export de compte : instantané personnel complet, GPX conservé et aucun secret sélectionné',async()=>{
 const {accountExport}=await import('../server/account-export.js'),users=[{id:'alice',username:'alice',is_admin:false,active:true,created_at:'2026-01-01'},{id:'bob',username:'bob',is_admin:true,active:true}],tables={rides:[{owner:'alice',id:'r',name:'Ma sortie',coordinates:[[50,5],[50.01,5]],gpx_xml:'<gpx>original & intact</gpx>',file_name:'été.gpx',source_type:'strava',strava_activity_id:'123'},{owner:'bob',id:'secret-ride'}],portions:[{owner:'alice',id:'s',is_public:false,source_ride_id:'r',source_strava:true,data:{name:'Sentier',rating:4,coordinates:[[50,5],[50.01,5]]}},{owner:'bob',id:'public-other',is_public:true}],planned_routes:[{owner:'alice',id:'p',is_public:true,data:{name:'Boucle',coordinates:[[50,5],[50.01,5]],legs:[{analysis:{elevation:{profile:[{at:0,altitude:100},{at:1000,altitude:200}]}}}]}}],wms_layers:[{owner:'alice',id:'w',config:{name:'Topo',url:'https://example.org/wms'}}],strava_connections:[{owner:'alice',athlete_id:'987'}]};let released=false;
 const db=dbWith((sql,args)=>{if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};assert.ok(sql.includes('WHERE id=$1')||sql.includes('WHERE user_id=$1'));assert.deepEqual(args,['alice']);assert.doesNotMatch(sql,/password_hash|token|SELECT \*/i);if(sql.includes('FROM users'))return {rows:users.filter(u=>u.id===args[0])};const table=Object.keys(tables).find(t=>sql.includes('FROM '+t+' '));assert.ok(table,sql);return {rows:tables[table].filter(r=>r.owner===args[0])};});const original=db.connect;db.connect=async()=>{const c=await original.call(db);c.release=()=>{released=true;};return c;};const data=await accountExport(db,'alice');assert.equal(data.rides.length,1);assert.equal(data.rides[0].gpx,tables.rides[0].gpx_xml);assert.equal(data.rides[0].fileName,'été.gpx');assert.equal(data.segments.features.length,1);assert.deepEqual(data.segments.features[0].geometry.coordinates,[[5,50],[5,50.01]]);assert.equal(data.segments.features[0].properties.sourceRideId,'r');assert.equal(data.itineraries[0].legs[0].analysis.elevation.profile[1].altitude,200);assert.equal(data.wmsLayers[0].name,'Topo');assert.equal(data.stravaConnection.athleteId,'987');assert.ok(!JSON.stringify(data).includes('bob'));assert.match(db.calls[0].sql,/REPEATABLE READ READ ONLY/);assert.equal(db.calls.at(-1).sql,'COMMIT');assert.equal(released,true);
});
test('export de compte : erreur de lecture annule et libère la connexion',async()=>{
 const {accountExport}=await import('../server/account-export.js');let released=false;const statements=[],db={async connect(){return {async query(sql){statements.push(sql);if(sql.includes('FROM users'))throw Error('lecture interrompue');return {rows:[]};},release(){released=true;}};}};await assert.rejects(accountExport(db,'alice'),/interrompue/);assert.equal(statements.at(-1),'ROLLBACK');assert.equal(released,true);
});
