import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp} from '../server/app.js';
import {tokenHash,hashPassword} from '../server/model.js';
const tokens={alice:'a'.repeat(64),bob:'b'.repeat(64)};
// In-memory SQL adapter: exercises HTTP routing and owner-scoped queries without a database daemon.
function database(){const saved=[],rides=[];return {saved,rides,queries:[],async query(sql,args=[]){this.queries.push({sql,args});
 if(sql.includes('FROM sessions s')){const name=Object.keys(tokens).find(k=>tokenHash(tokens[k])===args[0]);return {rows:name?[{id:name,username:name}]:[]};}
 if(sql.startsWith('INSERT INTO portions')){saved.push({id:args[0],user:args[1],data:JSON.parse(args[2]),is_public:args[3],source_strava:args[5]});return {rowCount:1,rows:[]};}
 if(sql.includes('FROM portions p JOIN users'))return {rows:saved.filter(r=>r.user===args[0]||r.is_public&&!r.source_strava).map(r=>({id:r.id,data:r.data,is_public:r.is_public,source_strava:r.source_strava,username:r.user,is_mine:r.user===args[0],created_at:new Date()}))};
 if(sql.startsWith('SELECT data,is_public,source_strava FROM portions'))return {rows:saved.filter(r=>r.id===args[0]&&r.user===args[1])};
 if(sql.startsWith('UPDATE portions SET data=')){const r=saved.find(r=>r.id===args[2]&&r.user===args[3]);if(!r||r.source_strava&&args[1])return {rowCount:0};r.data=JSON.parse(args[0]);r.is_public=args[1];return {rowCount:1,rows:[{id:r.id}]};}
 if(sql.startsWith('SELECT id,data'))return {rows:saved.filter(r=>r.user===args[0]).map(r=>({id:r.id,data:r.data,is_public:r.is_public,created_at:new Date()}))};
 if(sql.startsWith('DELETE FROM portions')){const i=saved.findIndex(r=>r.id===args[0]&&r.user===args[1]);if(i<0)return {rowCount:0};saved.splice(i,1);return {rowCount:1};}
 if(sql.startsWith('SELECT id,source_type FROM rides'))return {rows:rides.filter(r=>r.id===args[0]&&r.user_id===args[1])};
 if(sql.startsWith('INSERT INTO rides')){rides.push({id:args[0],user_id:args[1],name:args[2],coordinates:JSON.parse(args[3]),distance:args[4],gpx_xml:args[5],file_name:args[6]});return {rowCount:1,rows:[]};}
 if(sql.startsWith('SELECT id,name,distance'))return {rows:rides.filter(r=>r.user_id===args[0]).map(r=>({...r,gpx_available:r.gpx_xml!==null}))};
 if(sql.startsWith('SELECT id,name,coordinates')||sql.startsWith('SELECT name,coordinates,gpx_xml'))return {rows:rides.filter(r=>r.id===args[0]&&r.user_id===args[1])};
 if(sql.includes('RETURNING attempts'))return {rows:[{attempts:1}]};
 if(sql.startsWith('SELECT id,username,password_hash'))return {rows:[]};
 return {rows:[],rowCount:0};}};}
function request(app,{url='/',method='GET',user,body,origin='https://sillage.test'}={}){return new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{origin,...(user?{cookie:`sillage_session=${tokens[user]}`}:{})},socket:{remoteAddress:'127.0.0.1'}});const headers={};const res={statusCode:200,setHeader(k,v){headers[k]=v;},writeHead(code,values={}){this.statusCode=code;Object.assign(headers,values);},end(value=''){resolve({status:this.statusCode,headers,body:value.toString()});}};try{app.emit('request',req,res);}catch(e){reject(e);}});}
test('site et API protégés sans session',async()=>{const app=createApp(database(),{origin:'https://sillage.test'});const page=await request(app);assert.equal(page.status,303);assert.equal(page.headers.Location,'/login.html');assert.equal((await request(app,{url:'/api/portions'})).status,401);assert.equal((await request(app,{url:'/app.js'})).status,303);});
test('refuse une écriture provenant d’un autre site',async()=>{const db=database(),app=createApp(db,{origin:'https://sillage.test'});assert.equal((await request(app,{url:'/api/portions',method:'POST',user:'alice',origin:'https://other.test',body:{}})).status,403);assert.equal(db.saved.length,0);});
test('portions isolées par utilisateur, y compris suppression',async()=>{const db=database(),app=createApp(db,{origin:'https://sillage.test'});const body={coordinates:[[50,5],[50.001,5]],rating:5,surface:'Gravier fin',difficulty:'Facile',winter:'yes'};
 const added=await request(app,{url:'/api/portions',method:'POST',body,user:'alice'});assert.equal(added.status,201);const id=JSON.parse(added.body).id;
 const alice=await request(app,{url:'/api/portions',user:'alice'}),bob=await request(app,{url:'/api/portions',user:'bob'});assert.equal(JSON.parse(alice.body).length,1);assert.deepEqual(JSON.parse(bob.body),[]);
 assert.equal((await request(app,{url:`/api/portions/${id}`,method:'DELETE',user:'bob'})).status,404);assert.equal(db.saved.length,1);
 assert.equal((await request(app,{url:`/api/portions/${id}`,method:'DELETE',user:'alice'})).status,200);assert.equal(db.saved.length,0);
});
test('session expirée et sortie appartenant à un autre compte',async()=>{const app=createApp(database(),{origin:'https://sillage.test'});assert.equal((await request(app,{url:'/api/rides/00000000-0000-0000-0000-000000000001',user:'bob'})).status,404);});
test('login ne révèle pas les utilisateurs et rejette les identifiants invalides',async()=>{const app=createApp(database(),{origin:'https://sillage.test'});assert.equal((await request(app,{url:'/api/login',method:'POST',body:{username:'personne',password:'incorrect'}})).status,401);assert.equal((await request(app,{url:'/api/login',method:'POST',body:{username:'personne'}})).status,400);});
test('connexion réussie : cookie sécurisé et session persistée hachée',async()=>{const db=database(),base=db.query.bind(db),hash=await hashPassword('Un mot de passe long');db.query=async(sql,args)=>sql.startsWith('SELECT id,username,password_hash')?{rows:[{id:'alice',username:'alice',password_hash:hash}]}:base(sql,args);const app=createApp(db,{origin:'https://sillage.test'});const res=await request(app,{url:'/api/login',method:'POST',body:{username:'Alice',password:'Un mot de passe long'}});assert.equal(res.status,200);assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);const raw=res.headers['Set-Cookie'].split(';')[0].split('=')[1];const insert=db.queries.find(q=>q.sql.startsWith('INSERT INTO sessions'));assert.equal(insert.args[0],tokenHash(raw));assert.notEqual(insert.args[0],raw);assert.equal(insert.args[1],'alice');});
test('déconnexion révoque la session côté serveur et le cookie',async()=>{const db=database(),app=createApp(db,{origin:'https://sillage.test'});const res=await request(app,{url:'/api/logout',method:'POST',user:'alice',body:{}});assert.equal(res.status,200);assert.match(res.headers['Set-Cookie'],/Max-Age=0/);assert.ok(db.queries.some(q=>q.sql.startsWith('DELETE FROM sessions')&&q.args[0]===tokenHash(tokens.alice)));});

test('GPX enregistré en base, rechargé après nouvelle instance et téléchargement privé',async()=>{
 const db=database(),origin='https://sillage.test';let app=createApp(db,{origin});
 const gpx='<?xml version="1.0"?><gpx><trk><name>Sortie</name><trkseg><trkpt lat="50" lon="5"><ele>200</ele></trkpt><trkpt lat="50.001" lon="5"><ele>210</ele></trkpt></trkseg></trk></gpx>';
 const points=[[50,5],[50.001,5]];
 const uploaded=await request(app,{url:'/api/rides',method:'POST',user:'alice',body:{name:'Sortie test',coordinates:points,gpx,fileName:'ma-sortie.gpx'}});
 assert.equal(uploaded.status,201);const id=JSON.parse(uploaded.body).id;assert.equal(db.rides[0].gpx_xml,gpx);assert.equal(db.rides[0].file_name,'ma-sortie.gpx');
 app=createApp(db,{origin});
 const list=await request(app,{url:'/api/rides',user:'alice'});assert.equal(JSON.parse(list.body)[0].gpx_available,true);
 const loaded=await request(app,{url:`/api/rides/${id}`,user:'alice'});assert.deepEqual(JSON.parse(loaded.body).coordinates,points);
 const download=await request(app,{url:`/api/rides/${id}/gpx`,user:'alice'});assert.equal(download.status,200);assert.equal(download.body,gpx);assert.match(download.headers['Content-Disposition'],/^attachment/);
 assert.equal((await request(app,{url:`/api/rides/${id}/gpx`,user:'bob'})).status,404);
 assert.deepEqual(JSON.parse((await request(app,{url:'/api/rides',user:'bob'})).body),[]);
});
test('anciennes sorties sans original : téléchargement GPX reconstruit',async()=>{
 const db=database();db.rides.push({id:'00000000-0000-0000-0000-000000000001',user_id:'alice',name:'Bois & rivière',coordinates:[[50,5],[50.001,5]],gpx_xml:null});
 const app=createApp(db,{origin:'https://sillage.test'}),res=await request(app,{url:'/api/rides/00000000-0000-0000-0000-000000000001/gpx',user:'alice'});
 assert.equal(res.status,200);assert.match(res.body,/Bois &amp; rivière/);assert.match(res.body,/<trkpt lat="50.001" lon="5"/);
});

test('la politique de Referer identifie le site auprès des services cartographiques',async()=>{const app=createApp(database(),{origin:'https://sillage.test'});const res=await request(app,{url:'/login.html'});assert.equal(res.status,200);assert.equal(res.headers['Referrer-Policy'],'strict-origin-when-cross-origin');});

test('catalogue public, segments privés et modifications réservées au propriétaire',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),body={coordinates:[[50,5],[50.001,5]],rating:4,surface:'Gravier fin',difficulty:'Facile',winter:'yes'};
 const pub=JSON.parse((await request(app,{url:'/api/portions',method:'POST',body,user:'alice'})).body);assert.equal(pub.isPublic,true);
 const priv=JSON.parse((await request(app,{url:'/api/portions',method:'POST',body:{...body,isPublic:false},user:'alice'})).body);
 const alice=JSON.parse((await request(app,{url:'/api/catalog',user:'alice'})).body),bob=JSON.parse((await request(app,{url:'/api/catalog',user:'bob'})).body);assert.equal(alice.length,2);assert.ok(alice.every(r=>r.isMine));assert.equal(bob.length,1);assert.equal(bob[0].id,pub.id);assert.equal(bob[0].isMine,false);
 assert.equal((await request(app,{url:`/api/portions/${pub.id}`,method:'PATCH',body:{isPublic:false,winter:'no'},user:'bob'})).status,404);
 assert.equal((await request(app,{url:`/api/portions/${pub.id}`,method:'PATCH',body:{isPublic:false,winter:'no'},user:'alice'})).status,200);
 assert.deepEqual(JSON.parse((await request(app,{url:'/api/catalog',user:'bob'})).body),[]);
});
test('admin API et page protégées pour les membres',async()=>{const app=createApp(database(),{origin:'https://sillage.test'});for(const url of ['/admin.html','/admin.js','/api/admin/users','/api/admin/invitations'])assert.equal((await request(app,{url,user:'alice'})).status,403);});
test('endpoint OSM exige une session et transmet la zone au service cache',async()=>{let calls=0;const app=createApp(database(),{origin:'https://sillage.test',osmService:async bbox=>{calls++;assert.deepEqual(bbox,[50,5,50.01,5.01]);return {elements:[],bbox,cached:true};}});const body={bbox:[50,5,50.01,5.01]};assert.equal((await request(app,{url:'/api/osm',method:'POST',body})).status,401);assert.equal(calls,0);const r=await request(app,{url:'/api/osm',method:'POST',body,user:'alice'});assert.equal(r.status,200);assert.equal(JSON.parse(r.body).cached,true);assert.equal(calls,1);});

test('les portions issues de Strava restent privées et ne peuvent pas être publiées',async()=>{const db=database(),app=createApp(db,{origin:'https://sillage.test'}),rideId='00000000-0000-0000-0000-000000000111';db.rides.push({id:rideId,user_id:'alice',source_type:'strava'});const body={coordinates:[[50,5],[50.001,5]],rating:4,surface:'Gravier fin',difficulty:'Facile',winter:'yes',rideId,isPublic:true};const r=await request(app,{url:'/api/portions',method:'POST',body,user:'alice'});assert.equal(r.status,201);const p=JSON.parse(r.body);assert.equal(p.isPublic,false);assert.equal(p.fromStrava,true);assert.deepEqual(JSON.parse((await request(app,{url:'/api/catalog',user:'bob'})).body),[]);assert.equal((await request(app,{url:`/api/portions/${p.id}`,method:'PATCH',body:{isPublic:true,winter:'yes'},user:'alice'})).status,404);assert.equal((await request(app,{url:'/api/portions',method:'POST',body,user:'bob'})).status,400);});

test('édition complète conserve la provenance et recalcule longueur, propriétaire seul',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),initial={name:'Avant',coordinates:[[50,5],[50.001,5]],rating:2,surface:'Gravier fin',difficulty:'Facile',source:'Sortie originale'};
 const created=JSON.parse((await request(app,{url:'/api/portions',method:'POST',body:initial,user:'alice'})).body),url=`/api/portions/${created.id}`;
 const edits={name:'Après',coordinates:[[50,5],[50.002,5]],rating:5,surface:'Chemin de terre',difficulty:'Technique',singleTrack:'yes',winter:'conditions',isPublic:false,notes:'Racines',source:'Fausse provenance',fromStrava:false,mode:'manual',distance:0};
 assert.equal((await request(app,{url,method:'PATCH',body:edits,user:'bob'})).status,404);assert.equal(db.saved[0].data.name,'Avant');
 const result=await request(app,{url,method:'PATCH',body:edits,user:'alice'});assert.equal(result.status,200);const saved=JSON.parse(result.body);
 assert.equal(saved.name,'Après');assert.equal(saved.singleTrack,'yes');assert.equal(saved.winter,'conditions');assert.equal(saved.rating,5);assert.equal(saved.source,'Sortie originale');assert.equal(saved.mode,'manual');assert.ok(saved.distance>220&&saved.distance<225);assert.equal(saved.isPublic,false);
 assert.deepEqual(saved.coordinates,edits.coordinates);
 assert.equal((await request(app,{url,method:'PATCH',body:{singleTrack:'maybe'},user:'alice'})).status,400);assert.equal(db.saved[0].data.singleTrack,'yes');
 assert.equal((await request(app,{url,method:'PATCH',body:{coordinates:[[500,5],[50,5]]},user:'alice'})).status,400);
});
test('single track absent reste inconnu et worker OSM est protégé',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),body={coordinates:[[50,5],[50.001,5]],rating:3,surface:'Sable',difficulty:'Facile'};
 const created=await request(app,{url:'/api/portions',method:'POST',body,user:'alice'});assert.equal(JSON.parse(created.body).singleTrack,'unknown');
 assert.equal((await request(app,{url:'/osm-worker.js'})).status,303);const worker=await request(app,{url:'/osm-worker.js',user:'alice'});assert.equal(worker.status,200);assert.match(worker.headers['Content-Type'],/javascript/);
});

test('édition d’un segment Strava ne retire pas sa provenance ni sa confidentialité',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),rideId='00000000-0000-0000-0000-000000000222';db.rides.push({id:rideId,user_id:'alice',source_type:'strava'});
 const created=JSON.parse((await request(app,{url:'/api/portions',method:'POST',user:'alice',body:{coordinates:[[50,5],[50.001,5]],rating:4,surface:'Sable',difficulty:'Facile',rideId}})).body);
 const r=await request(app,{url:'/api/portions/'+created.id,method:'PATCH',user:'alice',body:{name:'Sentier privé',singleTrack:'yes',isPublic:false,fromStrava:false,source_strava:false,rideId:null}});assert.equal(r.status,200);const updated=JSON.parse(r.body);assert.equal(updated.fromStrava,true);assert.equal(updated.isPublic,false);assert.equal(updated.singleTrack,'yes');assert.deepEqual(JSON.parse((await request(app,{url:'/api/catalog',user:'bob'})).body),[]);
});
