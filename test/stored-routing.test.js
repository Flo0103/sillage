import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {parseRoutingWay,importRoutingWays} from '../server/routing-import.js';
import {createStoredOSM} from '../server/stored-osm.js';
import {createLocalRouting,routeOnOSM} from '../server/local-routing.js';
import {createRoutingService} from '../server/routing.js';
import {createRuntimeRouting} from '../server/routing-runtime.js';
const fixture=JSON.parse(await readFile(new URL('fixtures/spa-jeu-de-paume.json',import.meta.url),'utf8'));
const bounds=[50.45,5.8,50.55,5.95],revision='00000000-0000-0000-0000-000000000001';
function stored(elements=fixture.elements){
 const db={networks:[{revision,dataset:'belgium',source:'Geofabrik',bounds,way_count:elements.length,imported_at:'2026-10-26'}],elements,calls:[],async query(sql,args=[]){const text=typeof sql==='string'?sql:sql.text,values=typeof sql==='string'?args:sql.values;this.calls.push({text,values});
  if(text.startsWith('SELECT revision'))return {rows:structuredClone(this.networks)};
  if(text.startsWith('SELECT count')){const points=JSON.parse(values[1]);return {rows:[{found:points.filter(p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3]).length}]};}
  if(text.startsWith('SELECT DISTINCT'))return {rows:this.elements.map(data=>({data}))};throw Error('Unexpected SQL '+text);
 }};return db;
}
const encode=s=>String(s).replace(/[%,=\s@]/g,c=>'%'+c.codePointAt(0).toString(16)+'%');
const opl=w=>`w${w.id} T${Object.entries(w.tags).map(([k,v])=>encode(k)+'='+encode(v)).join(',')} N${w.nodes.map((n,i)=>`n${n}x${w.geometry[i].lon}y${w.geometry[i].lat}`).join(',')}\n`;
test('OPL avec coordonnées : graphe réel de Spa conservé, identifiants, restrictions et revêtements exacts',()=>{
 const parsed=fixture.elements.map(w=>parseRoutingWay(opl(w)));assert.deepEqual(parsed,fixture.elements);
 const original=routeOnOSM(fixture.endpoints,fixture.elements),imported=routeOnOSM(fixture.endpoints,parsed);assert.deepEqual(imported.coordinates,original.coordinates);assert.deepEqual(imported.analysis,original.analysis);
 const escaped=parseRoutingWay('w1 Thighway=track,name=Bois%20%de%20%Spa%2c%%20%A%3d%B,surface=gravel Nn1x5y50,n2x5.01y50');assert.equal(escaped.tags.name,'Bois de Spa, A=B');
 for(const s of ['n1 T x5 y50','w1 dD Thighway=track Nn1x5y50,n2x6y51','w1 Thighway=motorway Nn1x5y50,n2x6y51'])assert.equal(parseRoutingWay(s),null);
 for(const s of ['w1 Thighway=track Nn1,n2','w1 Thighway=track Nn1x5y999,n2x6y51','w99999999999999999 Thighway=track Nn1x5y50,n2x6y51'])assert.throws(()=>parseRoutingWay(s));
});
test('réseau installé : calcul de 6 km sans OSRM, Overpass ni requête Internet, puis cache partagé',async()=>{
 const points=[[50.46,5.83],[50.48,5.87],[50.50,5.90]],elements=[{type:'way',id:1,nodes:[1,2,3],geometry:points.map(([lat,lon])=>({lat,lon})),tags:{highway:'track',surface:'gravel'}}],db=stored(elements);let external=0;
 const remote=async()=>{external++;throw Error('Internet interdit dans ce test');},osm=createStoredOSM({db,remote}),routing=createRoutingService({localRouting:createLocalRouting({osmService:osm}),fetcher:remote});
 const r=await routing({points:[points[0],points.at(-1)],purpose:'itinerary',accessMode:'explicit'});assert.match(r.osmSource,/PostGIS/);assert.equal(r.timings.offline,true);assert.ok(r.timings.computeMs>=0);assert.equal(external,0);assert.deepEqual(r.coordinates,points);
 const queries=db.calls.length;assert.equal((await routing({points:[points[0],points.at(-1)],purpose:'itinerary',accessMode:'explicit'})).cached,true);assert.equal(db.calls.length,queries);assert.equal(external,0);
 assert.equal((await routing.status()).mode,'stored');assert.equal((await routing.status()).networks[0].dataset,'belgium');
});
test('accrochage initial depuis PostGIS, sans attente du fournisseur',async()=>{
 const db=stored(),remote=async()=>{throw Error('Ne pas appeler Overpass');},routing=createRoutingService({localRouting:createLocalRouting({osmService:createStoredOSM({db,remote})}),fetcher:remote});
 const r=await routing.nearest({point:fixture.endpoints[0],accessMode:'explicit'});assert.deepEqual(r.point,fixture.endpoints[0]);assert.ok(db.calls.some(c=>c.text.startsWith('SELECT DISTINCT')));
});
test('assemblage de production : même source locale pour l’accrochage et le calcul',async()=>{
 const db=stored();let external=0;const {routingService}=createRuntimeRouting(db,{fetcher:async()=>{external++;throw Error('Ne pas appeler un service externe');}});
 await routingService.nearest({point:fixture.endpoints[0],accessMode:'explicit'});const result=await routingService({points:fixture.endpoints,accessMode:'explicit',purpose:'itinerary'});assert.equal(result.timings.offline,true);assert.equal((await routingService.status()).mode,'stored');assert.equal(external,0);
});
test('stockage indisponible : erreur temporaire 503, pas une erreur géométrique et pas de secours public',async()=>{
 let external=0;const {routingService}=createRuntimeRouting({query:async()=>{throw Error('connexion perdue');}},{fetcher:async()=>{external++;throw Error('inattendu');}});
 await assert.rejects(routingService({points:fixture.endpoints,accessMode:'explicit'}),e=>e.status===503);assert.equal(external,0);
});
test('réseau installé : bicycle=no, sens unique et accès privés gardent la même politique',async()=>{
 const a=[50.49,5.85],b=[50.51,5.89],c=[50.52,5.85],way=(id,nodes,coordinates,tags)=>({type:'way',id,nodes,geometry:coordinates.map(([lat,lon])=>({lat,lon})),tags:{highway:'track',...tags}});
 for(const tag of [{access:'private'},{bicycle:'no'},{oneway:'-1'}]){
  const db=stored([way(1,[1,2],[a,b],tag),way(2,[1,3,2],[a,c,b],{})]),remote=async()=>{throw Error('Pas de secours non vérifié');},routing=createRoutingService({localRouting:createLocalRouting({osmService:createStoredOSM({db,remote})}),fetcher:remote});
  const r=await routing({points:[a,b],purpose:'itinerary',accessMode:'explicit'});assert.equal(r.analysis.accessRuns.length,0);assert.deepEqual(r.coordinates,[a,c,b]);
 }
});
test('hors région et avant import : secours existant conservé, y compris sa mosaïque et son cache',async()=>{
 const db=stored();db.networks=[];let direct=0,tiled=0;const remote=async()=>{direct++;return {elements:fixture.elements};};remote.forRouting=async()=>{tiled++;return {elements:fixture.elements};};remote.peek=()=>({elements:fixture.elements,cached:true});
 const osm=createStoredOSM({db,remote});assert.equal(await osm.covers(fixture.endpoints),false);await osm([50.49,5.86,50.50,5.88]);await osm.forRouting([50.49,5.86,50.50,5.88]);assert.equal(direct,1);assert.equal(tiled,1);assert.equal(osm.peek([50.49,5.86,50.50,5.88]).cached,true);assert.equal((await osm.status()).mode,'public');
});
test('révision remplacée : cache préparé invalidé après publication du nouvel import',async()=>{
 let clock=0;const db=stored(),osm=createStoredOSM({db,now:()=>clock});const box=[50.49,5.86,50.50,5.88],first=await osm(box);assert.equal((await osm(box)).cached,true);
 db.networks[0].revision='00000000-0000-0000-0000-000000000002';clock=2001;assert.equal(osm.peek(box),null);const next=await osm(box);assert.notEqual(next.revision,first.revision);assert.equal(next.cached,false);
});
test('ancienne lecture en vol après activation : son résultat tardif ne réintroduit pas un cache périmé',async()=>{
 let clock=0,release;const db=stored(),query=db.query.bind(db);db.query=async(sql,args)=>typeof sql==='object'&&sql.text.startsWith('SELECT DISTINCT')?new Promise(r=>release=()=>r({rows:fixture.elements.map(data=>({data}))})):query(sql,args);
 const osm=createStoredOSM({db,now:()=>clock}),box=[50.49,5.86,50.50,5.88],old=osm(box);await new Promise(r=>setImmediate(r));db.networks[0].revision='00000000-0000-0000-0000-000000000002';clock=2001;await osm.covers(fixture.endpoints);release();await old;assert.equal(osm.peek(box),null);
});
function importDB(){
 const old={revision,dataset:'belgium',active:true},db={networks:[old],ways:[],calls:[],backup:null,async query(sql,args=[]){this.calls.push({sql,args});
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.startsWith('INSERT INTO routing_networks'))this.networks.push({revision:args[0],dataset:args[1],active:false});
  else if(sql.startsWith('INSERT INTO routing_ways'))this.ways.push(...JSON.parse(args[1]).map(data=>({revision:args[0],data})));
  else if(sql.startsWith('SELECT ARRAY'))return {rows:[{bounds}]};
  else if(sql==='BEGIN')this.backup=structuredClone(this.networks);
  else if(sql==='ROLLBACK')this.networks=this.backup;
  else if(sql.startsWith('UPDATE routing_networks SET active=false')){for(const n of this.networks)if(n.dataset===args[0])n.active=false;}
  else if(sql.startsWith('UPDATE routing_networks SET active=true')){this.networks.find(n=>n.revision===args[2]).active=true;}
  else if(sql.startsWith('DELETE FROM routing_networks WHERE revision=')){this.networks=this.networks.filter(n=>n.revision!==args[0]);this.ways=this.ways.filter(w=>w.revision!==args[0]);}
  return {rows:[]};
 }};return db;
}
test('import : traitement par petits lots puis activation atomique, pas de modification des parcours membres',async()=>{
 const db=importDB(),result=await importRoutingWays({client:db,stream:Readable.from(fixture.elements.map(opl)),dataset:'belgium',source:'Geofabrik',validate:async()=>{assert.equal(db.networks.find(n=>n.revision===revision).active,true);assert.equal(db.networks.filter(n=>n.active).length,1);}});
 assert.equal(result.ways,fixture.elements.length);assert.equal(db.networks.find(n=>n.revision===revision).active,false);assert.equal(db.networks.find(n=>n.revision===result.revision).active,true);assert.ok(db.calls.some(c=>c.sql==='COMMIT'));assert.ok(db.calls.every(c=>!c.sql.includes('planned_routes')&&!c.sql.includes('portions')&&!c.sql.includes('rides')));
});
test('import incomplet ou échec de lecture Osmium : ancienne révision conservée et données partielles retirées',async()=>{
 for(const stream of [Readable.from([]),Readable.from([opl(fixture.elements[0]),'w1 Thighway=track Nn1,n2'])]){const db=importDB();await assert.rejects(importRoutingWays({client:db,stream,dataset:'belgium',source:'x'}));assert.deepEqual(db.networks,[{revision,dataset:'belgium',active:true}]);assert.equal(db.ways.length,0);assert.ok(!db.calls.some(c=>c.sql==='COMMIT'));}
 const db=importDB();await assert.rejects(importRoutingWays({client:db,stream:Readable.from(fixture.elements.map(opl)),dataset:'belgium',source:'x',validate:async()=>{throw Error('Osmium a échoué');}}),/Osmium/);assert.equal(db.networks[0].active,true);assert.equal(db.networks.length,1);
});
test('import concurrent d’une même région refusé sans toucher au réseau actif',async()=>{
 const db=importDB(),query=db.query.bind(db);db.query=async(sql,args)=>sql.includes('pg_try_advisory_lock')?{rows:[{locked:false}]}:query(sql,args);await assert.rejects(importRoutingWays({client:db,stream:Readable.from([]),dataset:'belgium',source:'x'}),/déjà en cours/);assert.equal(db.networks.length,1);
});
test('publication échouée : rollback et conservation du réseau précédemment actif',async()=>{
 const db=importDB(),query=db.query.bind(db);db.query=async(sql,args)=>{if(sql.startsWith('UPDATE routing_networks SET active=true'))throw Error('publication impossible');return query(sql,args);};
 await assert.rejects(importRoutingWays({client:db,stream:Readable.from(fixture.elements.map(opl)),dataset:'belgium',source:'x'}),/publication/);assert.deepEqual(db.networks,[{revision,dataset:'belgium',active:true}]);assert.equal(db.ways.length,0);assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
});
test('gros import : petits lots bornés et statistiques avant activation',async()=>{
 const db=importDB(),lines=Array.from({length:650},(_,i)=>opl({...fixture.elements[0],id:i+1}));await importRoutingWays({client:db,stream:Readable.from(lines),dataset:'belgium',source:'x'});
 const inserts=db.calls.filter(c=>c.sql.startsWith('INSERT INTO routing_ways'));assert.deepEqual(inserts.map(c=>JSON.parse(c.args[1]).length),[300,300,50]);assert.ok(db.calls.findIndex(c=>c.sql==='ANALYZE routing_ways')<db.calls.findIndex(c=>c.sql==='BEGIN'));
});
test('erreur du flux : révision partielle retirée sans activer des données incomplètes',async()=>{
 const db=importDB(),stream=new Readable({read(){this.destroy(Error('flux interrompu'));}});await assert.rejects(importRoutingWays({client:db,stream,dataset:'belgium',source:'x'}),/flux interrompu/);assert.equal(db.networks.length,1);assert.equal(db.networks[0].active,true);
});

// Aachen lies inside the rectangle of a Belgian extract, but not in its roads.
// Coordinates are in Aachen; the small test ways below are synthetic.
const aachen=[[50.7785,6.0806],[50.7790,6.0820],[50.7795,6.0834]],belgiumBounds=[49.4,2.5,51.6,6.5];
const testWay=(id,nodes,points,tags={})=>({type:'way',id,nodes,geometry:points.map(([lat,lon])=>({lat,lon})),tags:{highway:'track',surface:'gravel',...tags}});
test('Aachen : accrochage et routage en ligne malgré le rectangle de l’extrait Belgique',async()=>{
 const db=stored();db.networks[0].bounds=belgiumBounds;let calls=0;const elements=[testWay(901,[901,902,903],aachen)],{routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async url=>{calls++;assert.match(String(url),/overpass/);return Response.json({elements});}});
 const nearest=await routingService.nearest({point:aachen[0],accessMode:'explicit'});assert.deepEqual(nearest.point,aachen[0]);assert.equal(nearest.timings.offline,false);assert.match(nearest.osmSource,/Overpass/);
 const result=await routingService({points:[aachen[0],aachen.at(-1)],purpose:'itinerary',accessMode:'explicit'});assert.deepEqual(result.coordinates,aachen);assert.equal(result.timings.offline,false);assert.equal(result.accessPolicy,'explicit');assert.ok(result.analysis.surfaceRuns.every(r=>r.unpaved));assert.ok(calls>0);assert.equal(db.calls.filter(c=>c.text.startsWith('SELECT DISTINCT')).length,0,'ne pas lire de chemins belges pour un clic non couvert');
 const before=calls;assert.equal((await routingService({points:[aachen[0],aachen.at(-1)],purpose:'itinerary',accessMode:'explicit'})).cached,true);assert.equal(calls,before);assert.deepEqual((await routingService.status()).networks[0].bounds,belgiumBounds);
});
test('hors de toute emprise installée : le même secours fonctionne sans import supplémentaire',async()=>{
 const db=stored(),points=[[52.09,5.12],[52.091,5.121]],elements=[testWay(902,[1,2],points)];let external=0;const {routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async()=>{external++;return Response.json({elements});}});
 await routingService.nearest({point:points[0],allowRestricted:true});const result=await routingService({points,purpose:'itinerary',allowRestricted:true});assert.deepEqual(result.coordinates,points);assert.equal(result.timings.offline,false);assert.ok(external>0);
});
test('Flandre : des chemins installés restent entièrement locaux, sans préférence pour la Wallonie',async()=>{
 const points=[[51.05,3.72],[51.051,3.721]],db=stored([testWay(903,[1,2],points)]),base=db.query.bind(db);db.networks[0].bounds=belgiumBounds;db.query=async(sql,args)=>typeof sql==='object'&&sql.text.startsWith('SELECT count')?{rows:[{found:JSON.parse(sql.values[1]).length}]}:base(sql,args);
 const {routingService}=createRuntimeRouting(db,{fetcher:async()=>{assert.fail('Le routage local ne doit pas consulter Internet');}});assert.equal((await routingService.nearest({point:points[0],accessMode:'explicit'})).timings.offline,true);const result=await routingService({points,purpose:'itinerary',accessMode:'explicit'});assert.deepEqual(result.coordinates,points);assert.equal(result.timings.offline,true);
});
test('liaison manquante au bord de l’extrait : deux points locaux peuvent retrouver un passage OSM en ligne',async()=>{
 const a=[50.49,5.85],x=[50.49,5.852],y=[50.49,5.855],b=[50.49,5.857],local=[testWay(1,[1,2],[a,x]),testWay(3,[3,4],[y,b])],all=[...local,testWay(2,[2,3],[x,y])],db=stored(local);let external=0;
 const {routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async()=>{external++;return Response.json({elements:all});}});const result=await routingService({points:[a,b],purpose:'itinerary',accessMode:'explicit'});assert.deepEqual(result.coordinates,[a,x,y,b]);assert.equal(result.timings.offline,false);assert.ok(external>0);
});
test('trajet guidé : points locaux mais nœud hors extrait, les chemins du guide viennent d’OSM en ligne',async()=>{
 const a=[50.49,5.85],x=[50.49,5.852],m=[50.491,5.8535],y=[50.49,5.855],b=[50.49,5.857],local=[testWay(1,[1,2],[a,x]),testWay(3,[3,4],[y,b])],all=[...local,testWay(2,[2,5,3],[x,m,y])],db=stored(local);let external=0;const remote=async()=>{assert.fail('attend la lecture des chemins du guide');};remote.forRoute=async guide=>{external++;assert.deepEqual(guide.nodes,[1,2,5,3,4]);return {elements:all,source:'Overpass · chemins du trajet'};};const osm=createStoredOSM({db,remote});
 const data=await osm.forRoute({nodes:[1,2,5,3,4],points:[a,b],coordinates:[a,x,m,y,b]});assert.equal(data.source,'Overpass · chemins du trajet');assert.equal(external,1);assert.deepEqual(routeOnOSM([a,b],data.elements).coordinates,[a,x,m,y,b]);
});
test('trajet guidé entièrement présent : aucune requête en ligne supplémentaire',async()=>{
 const a=[50.49,5.85],b=[50.49,5.857],db=stored([testWay(1,[1,2],[a,b])]),remote=async()=>{assert.fail('Tous les nœuds sont présents');};remote.forRoute=remote;const data=await createStoredOSM({db,remote}).forRoute({nodes:[1,2],points:[a,b],coordinates:[a,b]});assert.equal(data.offline,true);assert.match(data.source,/PostGIS/);
});
test('fenêtre vide dans l’emprise belge : données OSM distantes aussi disponibles aux autres consommateurs',async()=>{
 const db=stored([]);db.networks[0].bounds=belgiumBounds;let direct=0,tiled=0;const elements=[testWay(1,[1,2],aachen.slice(0,2))],remote=async()=>{direct++;return {elements,source:'Overpass'};};remote.forRouting=async()=>{tiled++;return {elements,source:'Overpass'};};const osm=createStoredOSM({db,remote}),box=[50.778,6.080,50.780,6.084];assert.equal((await osm(box)).source,'Overpass');assert.equal((await osm.forRouting(box)).source,'Overpass');assert.equal(direct,1);assert.equal(tiled,1);
});
test('secours à Aachen : interdiction vélo, raccourci privé et sens unique restent appliqués',async()=>{
 const a=[50.7785,6.0806],b=[50.7785,6.0816],c=[50.7795,6.0811];for(const tags of [{bicycle:'no'},{access:'private'},{oneway:'-1'}]){
  const db=stored(),all=[testWay(1,[1,2],[a,b],tags),testWay(2,[1,3,2],[a,c,b])];db.networks[0].bounds=belgiumBounds;const {routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async()=>Response.json({elements:all})});const result=await routingService({points:[a,b],purpose:'itinerary',accessMode:'explicit'});assert.deepEqual(result.coordinates,[a,c,b]);assert.equal(result.analysis.accessRuns.length,0);
 }
 const db=stored();db.networks[0].bounds=belgiumBounds;const {routingService}=createRuntimeRouting(db,{fetcher:async()=>Response.json({elements:[testWay(1,[1,2],[a,b],{access:'private'})]})});const restricted=await routingService({points:[a,b],purpose:'itinerary',accessMode:'explicit'});assert.equal(restricted.analysis.accessRuns.length,1,'accès privé autorisé seulement par le point explicite');
});
test('interdiction vélo locale explicite : aucun secours ne déplace le point pour la contourner',async()=>{
 const points=[[50.49,5.85],[50.491,5.851]],db=stored([testWay(1,[1,2],points,{bicycle:'no'})]),{routingService}=createRuntimeRouting(db,{fetcher:async()=>{assert.fail('Ne pas contourner bicycle=no');}});
 await assert.rejects(routingService.nearest({point:points[0],accessMode:'explicit'}),e=>e.bicycleForbidden&&e.status===422);await assert.rejects(routingService({points,accessMode:'explicit'}),e=>e.bicycleForbidden&&e.status===422);
});
test('direction impossible, même avec le secours : aucun résultat OSRM non vérifié',async()=>{
 const a=[50.49,5.85],b=[50.491,5.851],all=[testWay(1,[1,2],[a,b],{oneway:'yes'})],db=stored(all);let online=0;const {routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async url=>{online++;assert.match(String(url),/overpass/);return Response.json({elements:all});}});await assert.rejects(routingService({points:[b,a],accessMode:'explicit'}),e=>e.localNoPath&&e.status===422);assert.ok(online>0);
});

test('étape longue ou transfrontalière vers Aachen : guide public, puis accès et sens vérifiés sur OSM en ligne',async()=>{
 const points=[fixture.endpoints[0],[50.64,5.99],aachen[0]],all=[testWay(907,[701,702,703],points)],db=stored(),calls=[];db.networks[0].bounds=belgiumBounds;
 const {routingService}=createRuntimeRouting(db,{wait:async()=>{},fetcher:async(url,options)=>{calls.push({url:String(url),query:options?.body?.get('data')});if(String(url).includes('/routed-bike/'))return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:points.map(p=>[p[1],p[0]])},legs:[{annotation:{nodes:[701,702,703]},steps:[{mode:'cycling'}]}]}],waypoints:[points[0],points.at(-1)].map(p=>({location:[p[1],p[0]]}))});return Response.json({elements:all});}});
 const result=await routingService({points:[points[0],points.at(-1)],purpose:'itinerary',accessMode:'explicit'});assert.deepEqual(result.coordinates,points);assert.equal(result.timings.offline,false);assert.equal(result.accessPolicy,'explicit');assert.equal(calls.length,2);assert.match(calls[0].url,/annotations=nodes/);assert.match(calls[1].query,/node\(id:701,702,703\)/);assert.equal(db.calls.some(c=>c.text.startsWith('SELECT DISTINCT')),false);
});
test('fenêtres voisines dédupliquées : le secours couvre toute l’emprise commune',async()=>{
 const db=stored([]),query=db.query.bind(db);db.networks[0].bounds=belgiumBounds;let release;db.query=(sql,args)=>typeof sql==='object'&&sql.text.startsWith('SELECT DISTINCT')?new Promise(resolve=>release=()=>resolve({rows:[]})):query(sql,args);const remote=async box=>({elements:[],bbox:box,source:'Overpass'}),osm=createStoredOSM({db,remote}),one=[50.778,6.080,50.779,6.081],two=[50.782,6.085,50.783,6.086],a=osm(one),b=osm(two);await new Promise(r=>setImmediate(r));release();const results=await Promise.all([a,b]);for(const result of results)for(const box of [one,two])assert.ok(result.bbox[0]<=box[0]&&result.bbox[1]<=box[1]&&result.bbox[2]>=box[2]&&result.bbox[3]>=box[3]);
});
