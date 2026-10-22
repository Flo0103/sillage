import {test} from 'node:test';
import assert from 'node:assert/strict';
import {features,wmsConfig} from '../server/features.js';
import {hashPassword,verifyPassword,tokenHash} from '../server/model.js';
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
