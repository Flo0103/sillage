import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp} from '../server/app.js';
import {tokenHash,hashPassword} from '../server/model.js';
const tokens={alice:'a'.repeat(64),bob:'b'.repeat(64)};
// In-memory SQL adapter: exercises HTTP routing and owner-scoped queries without a database daemon.
function database(){const saved=[],rides=[],planned=[];return {saved,rides,planned,queries:[],async query(sql,args=[]){this.queries.push({sql,args});
 if(sql.includes('FROM sessions s')){const name=Object.keys(tokens).find(k=>tokenHash(tokens[k])===args[0]);return {rows:name?[{id:name,username:name}]:[]};}
 if(sql.startsWith('INSERT INTO planned_routes')){planned.push({id:args[0],user:args[1],data:JSON.parse(args[2]),is_public:args[3]});return {rowCount:1,rows:[]};}
 if(sql.includes('FROM planned_routes p JOIN users')){const owner=args.length===2?args[1]:args[0];return {rows:planned.filter(p=>(args.length===1||p.id===args[0])&&(p.user===owner||p.is_public)).map(p=>({...p,username:p.user,is_mine:p.user===owner}))};}
 if(sql.startsWith('SELECT data,is_public FROM planned_routes'))return {rows:planned.filter(p=>p.id===args[0]&&p.user===args[1])};
 if(sql.startsWith('UPDATE planned_routes SET data=')){const p=planned.find(p=>p.id===args[2]&&p.user===args[3]);if(!p)return {rowCount:0};p.data=JSON.parse(args[0]);p.is_public=args[1];return {rowCount:1,rows:[{id:p.id}]};}
 if(sql.startsWith('DELETE FROM planned_routes')){const i=planned.findIndex(p=>p.id===args[0]&&p.user===args[1]);if(i<0)return {rowCount:0};planned.splice(i,1);return {rowCount:1};}
 if(sql.startsWith('SELECT id,name,source_type,ST_AsGeoJSON'))return {rows:rides.filter(r=>r.user_id===args[0]).map(r=>({...r,geometry:{type:'LineString',coordinates:r.coordinates.map(p=>[p[1],p[0]])}}))};
 if(sql.startsWith('INSERT INTO portions')){saved.push({id:args[0],user:args[1],data:JSON.parse(args[2]),is_public:args[3],source_strava:args[5]});return {rowCount:1,rows:[]};}
 if(sql.includes('FROM portions p JOIN users'))return {rows:saved.filter(r=>r.user===args[0]||r.is_public&&!r.source_strava).map(r=>({id:r.id,data:r.data,is_public:r.is_public,source_strava:r.source_strava,username:r.user,is_mine:r.user===args[0],created_at:new Date()}))};
 if(sql.startsWith('SELECT data,is_public,source_strava FROM portions'))return {rows:saved.filter(r=>r.id===args[0]&&r.user===args[1])};
 if(sql.startsWith('UPDATE portions SET data=')){const r=saved.find(r=>r.id===args[2]&&r.user===args[3]);if(!r||r.source_strava&&args[1])return {rowCount:0};r.data=JSON.parse(args[0]);r.is_public=args[1];return {rowCount:1,rows:[{id:r.id}]};}
 if(sql.startsWith('SELECT id,data'))return {rows:saved.filter(r=>r.user===args[0]).map(r=>({id:r.id,data:r.data,is_public:r.is_public,created_at:new Date()}))};
 if(sql.startsWith('DELETE FROM portions')){const i=saved.findIndex(r=>r.id===args[0]&&r.user===args[1]);if(i<0)return {rowCount:0};saved.splice(i,1);return {rowCount:1};}
 if(sql.startsWith('DELETE FROM rides')){const i=rides.findIndex(r=>r.id===args[0]&&r.user_id===args[1]);if(i<0)return {rowCount:0};rides.splice(i,1);return {rowCount:1};}
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

test('routage authentifié et suppression de sortie réservée à son propriétaire',async()=>{
 const db=database();let calls=0;const points=[[50,5],[50.001,5]],app=createApp(db,{origin:'https://sillage.test',routingService:async b=>{calls++;assert.deepEqual(b.points,points);return {coordinates:points,engine:'OSRM vélo / FOSSGIS'};}});
 assert.equal((await request(app,{url:'/api/route',method:'POST',body:{points}})).status,401);assert.equal(calls,0);
 const routed=await request(app,{url:'/api/route',method:'POST',user:'alice',body:{points}});assert.equal(routed.status,200);assert.equal(calls,1);
 const id='00000000-0000-0000-0000-000000000321';db.rides.push({id,user_id:'alice'});assert.equal((await request(app,{url:'/api/rides/'+id,method:'DELETE',user:'bob'})).status,404);assert.equal(db.rides.length,1);assert.equal((await request(app,{url:'/api/rides/'+id,method:'DELETE',user:'alice'})).status,200);assert.equal(db.rides.length,0);
});

test('nouveau dessin OSM indépendant public sans données de la sortie privée de référence',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),body={coordinates:[[50,5],[50.001,5]],rating:4,surface:'Sable',difficulty:'Facile',mode:'manual',independentOsm:true,source:'Nom Strava à ne pas copier',isPublic:true};
 const r=await request(app,{url:'/api/portions',method:'POST',user:'alice',body});assert.equal(r.status,201);const p=JSON.parse(r.body);assert.equal(p.isPublic,true);assert.equal(p.fromStrava,false);assert.equal(p.source,'Dessin OSM indépendant');assert.equal(db.saved[0].source_strava,false);
 const pub=JSON.parse((await request(app,{url:'/api/catalog',user:'bob'})).body);assert.equal(pub.length,1);assert.ok(!JSON.stringify(pub).includes('Nom Strava'));
 for(const b of [{...body,mode:'snap'},{...body,rideId:'00000000-0000-0000-0000-000000000111'}])assert.equal((await request(app,{url:'/api/portions',method:'POST',user:'alice',body:b})).status,400);
});

test('points de routage persistés dans le catalogue et modifiables au rechargement',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),routePoints=[[50,5],[50.001,5.001],[50.002,5]],body={coordinates:routePoints,routePoints,mode:'route',snapped:true,rating:4,surface:'Gravier fin',difficulty:'Facile'};
 const r=await request(app,{url:'/api/portions',method:'POST',user:'alice',body});assert.equal(r.status,201);const id=JSON.parse(r.body).id;
 const loaded=JSON.parse((await request(app,{url:'/api/catalog',user:'alice'})).body)[0];assert.deepEqual(loaded.routePoints,routePoints);
 const next=[[50,4.999],[50.001,5.002],[50.002,5]];assert.equal((await request(app,{url:'/api/portions/'+id,method:'PATCH',user:'alice',body:{coordinates:next,routePoints:next}})).status,200);assert.deepEqual(db.saved[0].data.routePoints,next);
});

test('itinéraires privés par défaut, partage, édition réservée au propriétaire, GPX protégé',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),body={name:'Bois & rivière <gravel>',notes:'Pause <café> & eau',mode:'route',snapped:true,coordinates:[[50,5],[50.02,5.01]],routePoints:[[50,5],[50.02,5.01]]};
 assert.equal((await request(app,{url:'/api/plans'})).status,401);const added=await request(app,{url:'/api/plans',method:'POST',user:'alice',body});assert.equal(added.status,201);const plan=JSON.parse(added.body);assert.equal(plan.isPublic,false);assert.equal(db.planned.length,1);
 assert.equal((await request(app,{url:'/api/plans/'+plan.id,user:'bob'})).status,404);assert.equal((await request(app,{url:'/api/plans/'+plan.id+'/gpx',user:'bob'})).status,404);
 assert.equal((await request(app,{url:'/api/plans/'+plan.id,method:'PATCH',user:'bob',body:{isPublic:true}})).status,404);
 const published=await request(app,{url:'/api/plans/'+plan.id,method:'PATCH',user:'alice',body:{isPublic:true}});assert.equal(published.status,200);
 const list=JSON.parse((await request(app,{url:'/api/plans',user:'bob'})).body);assert.equal(list.length,1);assert.equal(list[0].isMine,false);assert.equal(list[0].owner,'alice');
 const gpx=await request(app,{url:'/api/plans/'+plan.id+'/gpx',user:'bob'});assert.equal(gpx.status,200);assert.match(gpx.headers['Content-Type'],/gpx/);assert.match(gpx.body,/Bois &amp; rivière &lt;gravel&gt;/);assert.match(gpx.body,/<trkpt lat="50.02" lon="5.01">/);assert.match(gpx.body,/Pause &lt;café&gt; &amp; eau/);
 assert.equal((await request(app,{url:'/api/plans/'+plan.id,method:'DELETE',user:'bob'})).status,404);
 const fresh=createApp(db,{origin:'https://sillage.test'});assert.deepEqual(JSON.parse((await request(fresh,{url:'/api/plans/'+plan.id,user:'alice'})).body).coordinates,body.coordinates);
 assert.equal((await request(app,{url:'/api/plans/'+plan.id,method:'PATCH',user:'alice',body:{isPublic:false}})).status,200);assert.deepEqual(JSON.parse((await request(app,{url:'/api/plans',user:'bob'})).body),[]);
 assert.equal((await request(app,{url:'/api/plans/'+plan.id,method:'DELETE',user:'alice'})).status,200);assert.equal(db.planned.length,0);
});
test('itinéraires : validation du tracé, du partage et de la géométrie avant écriture',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),body={name:'Tour test',coordinates:[[50,5],[50.01,5]],mode:'route',snapped:true};
 for(const edits of [{snapped:false},{isPublic:'oui'},{coordinates:[[500,5],[50,5]]},{routePoints:Array.from({length:51},(_,i)=>[50+i*.001,5])}])assert.equal((await request(app,{url:'/api/plans',method:'POST',user:'alice',body:{...body,...edits}})).status,400);
 assert.equal(db.planned.length,0);assert.equal((await request(app,{url:'/api/plans',method:'POST',user:'alice',body:{...body,mode:'manual',snapped:false}})).status,201);
});
test('superposition des sorties : toutes ses traces y compris Strava, aucune trace d’un autre compte',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'});for(let i=0;i<101;i++)db.rides.push({id:String(i),name:'Sortie '+i,user_id:'alice',source_type:i?'gpx':'strava',coordinates:[[50,5],[50.001,5]]});db.rides.push({id:'secret',name:'Privé Bob',user_id:'bob',coordinates:[[51,6],[51.001,6]]});
 assert.equal((await request(app,{url:'/api/rides/overlay'})).status,401);const own=JSON.parse((await request(app,{url:'/api/rides/overlay',user:'alice'})).body);assert.equal(own.length,101);assert.equal(own[0].source_type,'strava');assert.ok(!JSON.stringify(own).includes('Privé Bob'));assert.deepEqual(own[0].coordinates,[[50,5],[50.001,5]]);assert.match(db.queries.find(q=>q.sql.includes('ST_AsGeoJSON')).sql,/ST_Simplify/);
});
test('accrochage ponctuel exige une session et ne transmet que le point choisi',async()=>{
 const db=database();let calls=0;const routingService=async()=>{};routingService.nearest=async b=>{calls++;assert.deepEqual(b.point,[50,5]);return {point:[50.0001,5],offset:11};};const app=createApp(db,{origin:'https://sillage.test',routingService});
 assert.equal((await request(app,{url:'/api/route/nearest',method:'POST',body:{point:[50,5]}})).status,401);assert.equal(calls,0);const r=await request(app,{url:'/api/route/nearest',method:'POST',body:{point:[50,5]},user:'alice'});assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body).point,[50.0001,5]);assert.equal(calls,1);
});

test('analyse d’itinéraire authentifiée et module du planificateur protégé',async()=>{
 let calls=0;const app=createApp(database(),{origin:'https://sillage.test',planMetrics:async body=>{calls++;assert.deepEqual(body.coordinates,[[50,5],[50.01,5]]);return {elevation:null,surfaces:[],surfaceRuns:[],errors:['Indisponible']};}}),body={coordinates:[[50,5],[50.01,5]]};
 assert.equal((await request(app,{url:'/api/plan-metrics',method:'POST',body})).status,401);assert.equal(calls,0);assert.equal((await request(app,{url:'/api/plan-metrics',method:'POST',body,user:'alice',origin:'https://other.test'})).status,403);assert.equal(calls,0);assert.equal((await request(app,{url:'/api/plan-metrics',method:'POST',body,user:'alice'})).status,200);assert.equal(calls,1);assert.equal((await request(app,{url:'/planner.js'})).status,303);assert.equal((await request(app,{url:'/planner.js',user:'alice'})).status,200);assert.equal((await request(app,{url:'/plan-library.js'})).status,303);assert.equal((await request(app,{url:'/plan-library.js',user:'alice'})).status,200);assert.equal((await request(app,{url:'/elevation.js'})).status,303);assert.equal((await request(app,{url:'/elevation.js',user:'alice'})).status,200);
});
test('enregistrement des portions mixtes, altitudes et nom GPX avec caractères accentués, nom vide refusé',async()=>{
 const db=database(),app=createApp(db,{origin:'https://sillage.test'}),points=[[50,5],[50.01,5],[50.02,5]],body={name:'Boucle de la rivière',mode:'route',snapped:true,coordinates:points,legs:[{mode:'route',coordinates:points.slice(0,2),analysis:{surfaces:[],surfaceRuns:[],errors:[],elevation:{ascent:20,descent:0,profile:[{at:0,altitude:100},{at:1112,altitude:120}],spacing:60}}},{mode:'manual',coordinates:points.slice(1)}]};
 assert.equal((await request(app,{url:'/api/plans',method:'POST',body:{...body,name:' '},user:'alice'})).status,400);const response=await request(app,{url:'/api/plans',method:'POST',body,user:'alice'});assert.equal(response.status,201);const p=JSON.parse(response.body);assert.equal(p.legs[1].mode,'manual');const gpx=await request(app,{url:'/api/plans/'+p.id+'/gpx',user:'alice'});assert.match(gpx.headers['Content-Disposition'],/filename\*=UTF-8''Boucle%20de%20la%20rivi%C3%A8re.gpx/);assert.match(gpx.body,/<type>cycling<\/type>/);assert.match(gpx.body,/<ele>100.0<\/ele>/);assert.equal((await request(app,{url:'/api/plans/'+p.id,method:'PATCH',body:{name:''},user:'alice'})).status,400);
});

test('altitudes groupées protégées par session et origine, sans lecture ou modification des itinéraires',async()=>{
 let calls=0;const metrics=async()=>({});metrics.elevations=async input=>{calls++;assert.equal(input.paths.length,2);return [{elevation:null,error:'Indisponible'},{elevation:null,error:'Indisponible'}];};const db=database(),app=createApp(db,{origin:'https://sillage.test',planMetrics:metrics}),body={paths:[[[50,5],[50.01,5]],[[50.01,5],[50.02,5]]]};assert.equal((await request(app,{url:'/api/plan-elevations',method:'POST',body})).status,401);assert.equal((await request(app,{url:'/api/plan-elevations',method:'POST',body,user:'alice',origin:'https://other.test'})).status,403);assert.equal(calls,0);const response=await request(app,{url:'/api/plan-elevations',method:'POST',body,user:'alice'});assert.equal(response.status,200);assert.equal(JSON.parse(response.body).length,2);assert.equal(calls,1);assert.ok(!db.queries.some(q=>/planned_routes/.test(q.sql)));assert.equal((await request(app,{url:'/elevation-data.js'})).status,303);assert.equal((await request(app,{url:'/elevation-data.js',user:'alice'})).status,200);
});

test('module de règles OSM disponible uniquement après authentification',async()=>{
 const app=createApp(database(),{origin:'https://sillage.test'});assert.equal((await request(app,{url:'/osm-tags.js'})).status,303);const r=await request(app,{url:'/osm-tags.js',user:'alice'});assert.equal(r.status,200);assert.match(r.body,/bicycleDirections/);
});
