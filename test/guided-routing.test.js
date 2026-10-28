import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOSMService} from '../server/osm.js';
import {createLocalRouting} from '../server/local-routing.js';
import {createRoutingService} from '../server/routing.js';
import {routeLength} from '../server/model.js';
const way=(id,nodes,points,tags={})=>({type:'way',id,nodes,geometry:points.map(([lat,lon])=>({lat,lon})),tags:{highway:'track',surface:'gravel',...tags}});
function setup(points,elements,{providerNodes=elements.flatMap(w=>w.nodes),osmFetcher}={}){
 const calls=[],osm=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async(url,options)=>{
  calls.push({source:'osm',url:String(url),query:options?.body?.get('data')});
  return osmFetcher?osmFetcher(url,options):Response.json({elements});
 }}),service=createRoutingService({localRouting:createLocalRouting({osmService:osm}),wait:async()=>{},fetcher:async(url)=>{
  calls.push({source:'router',url:String(url)});return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:points.map(p=>[p[1],p[0]])},legs:[{annotation:{nodes:providerNodes},steps:[{mode:'cycling'}]}]}],waypoints:points.map(p=>({location:[p[1],p[0]]}))});
 }});
 return {service,calls,osm};
}
const request=points=>({points,purpose:'itinerary',accessMode:'explicit'});
test('étape diagonale de 25 km : un guide et une requête de chemins, sans rectangle ni limite locale de 15 km',async()=>{
 const points=[[50,5],[50.09,5.11],[50.18,5.22]],elements=[way(1,[1,2,3],points)],{service,calls,osm}=setup(points,elements),input=request([points[0],points.at(-1)]);
 const result=await service(input);assert.ok(routeLength(result.coordinates)>24000);assert.equal(result.accessPolicy,'explicit');assert.match(result.engine,/vérifiés/);assert.deepEqual(result.coordinates,points);assert.ok(result.analysis.surfaceRuns.every(run=>run.unpaved));
 assert.equal(calls.length,2);assert.match(calls[0].url,/annotations=nodes/);assert.match(calls[1].query,/node\(id:1,2,3\)/);assert.match(calls[1].query,/way\(bn.route\)/);assert.match(calls[1].query,/around:175,50,5/);assert.doesNotMatch(calls[1].query,/\(49\.99/);
 assert.equal(osm.peek([50,5,50.001,5.001]),null,'un instantané partiel ne couvre pas toute son emprise');
 const again=await service(input);assert.equal(again.cached,true);assert.equal(calls.length,2);
});
test('le guide ne donne pas permission : raccourci privé et interdiction vélo sont évités',async()=>{
 const a=[50,5],b=[50,5.04],c=[50.02,5.02],elements=[way(1,[1,2],[a,b],{access:'private'}),way(2,[1,3,2],[a,c,b])],{service}=setup([a,b],elements,{providerNodes:[1,2]});
 const result=await service(request([a,b]));assert.deepEqual(result.coordinates,[a,c,b]);assert.equal(result.analysis.accessRuns.length,0);
 const forbidden=setup([a,b],[way(1,[1,2],[a,b],{bicycle:'no'}),way(2,[1,3,2],[a,c,b])],{providerNodes:[1,2]});assert.deepEqual((await forbidden.service(request([a,b]))).coordinates,[a,c,b]);
});
test('un point réellement placé sur un accès privé autorise sa composante, avec avertissement',async()=>{
 const a=[50,5],b=[50,5.04],elements=[way(1,[1,2],[a,b],{access:'private'})],{service}=setup([a,b],elements);
 const result=await service(request([a,b]));assert.equal(result.analysis.accessRuns.length,1);assert.match(result.analysis.accessRuns[0].label,/privé/);
});
test('le sens interdit du guide est rejeté, jamais affiché comme solution de secours',async()=>{
 const a=[50,5],b=[50,5.04],{service}=setup([b,a],[way(1,[1,2],[a,b],{oneway:'yes'})]);
 await assert.rejects(service(request([b,a])),e=>e.localNoPath&&e.status===422);
});
test('source OSM principale indisponible : seconde source interrogée sur les seuls chemins du guide',async()=>{
 const points=[[50,5],[50.18,5.22]],elements=[way(1,[1,2],points)],{service,calls}=setup(points,elements,{osmFetcher:async url=>String(url).includes('overpass-api.de')?new Response('',{status:503}):Response.json({elements})});
 const result=await service(request(points));assert.equal(result.accessPolicy,'explicit');assert.equal(calls.length,3);assert.match(calls.at(-1).url,/overpass.kumi.systems/);
});
test('échec des sources : pas de trajet public non vérifié et pas de trois téléchargements de grands rectangles',async()=>{
 const points=[[50,5],[50.18,5.22]],{service,calls}=setup(points,[way(1,[1,2],points)],{osmFetcher:async()=>new Response('',{status:503})});
 await assert.rejects(service(request(points)),e=>e.status===503);assert.equal(calls.filter(c=>c.source==='router').length,1);assert.equal(calls.filter(c=>c.source==='osm').length,2);
});
test('requête guidée dédupliquée et expirée, identifiants non sûrs refusés',async()=>{
 let calls=0,time=0,release;const osm=createOSMService({now:()=>time,ttl:1000,fetcher:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return Response.json({elements:[]});}}),input={nodes:[3,1,2,2],points:[[50,5],[50.1,5.1]]};
 const first=osm.forRoute(input),second=osm.forRoute(input);assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal((await osm.forRoute({...input,points:input.points.slice().reverse()})).cached,true);assert.equal(calls,1);time=1001;await osm.forRoute(input);assert.equal(calls,2);
 for(const nodes of [[],[1,'2'],[1,NaN],[1,0],Array(25001).fill(1)])await assert.rejects(osm.forRoute({...input,nodes}));assert.equal(calls,2);
});
test('détour légal déjà calculé : réponse immédiate, pas de trois élargissements fondés sur sa longueur',async()=>{
 const a=[50,5],b=[50,5.001],points=[a,[50.01,5],[50.01,5.001],b],elements=[way(1,[1,2,3,4],points)];let calls=0;
 const local=createLocalRouting({osmService:async()=>{calls++;return {elements};}});assert.deepEqual((await local({points:[a,b]})).coordinates,points);assert.equal(calls,1);
});
test('panne de téléchargement local : un seul essai, pas de répétition avec des emprises agrandies',async()=>{
 let calls=0;const local=createLocalRouting({osmService:async()=>{calls++;throw Error('indisponible');}});
 await assert.rejects(local({points:[[50,5],[50.001,5.001]]}),/indisponible/);assert.equal(calls,1);
});
test('vérification lente : le routeur des autres utilisateurs reste disponible ; même calcul dédupliqué',async()=>{
 let time=0;const starts=[],release=[],local=async()=>{throw Error('local indisponible');};local.guided=input=>new Promise(resolve=>release.push(()=>resolve({coordinates:input.points,accessPolicy:'explicit'})));
 const service=createRoutingService({localRouting:local,now:()=>time,wait:async ms=>{time+=ms;},fetcher:async url=>{
  starts.push(time);const points=new URL(url).pathname.split('/').at(-1).split(';').map(s=>s.split(',').map(Number).reverse());
  return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:points.map(p=>p.slice().reverse())},legs:[{annotation:{nodes:[1,2]}}]}]});
 }}),input=request([[50,5],[50,5.04]]),first=service(input),same=service(input);
 await new Promise(r=>setImmediate(r));assert.equal(starts.length,1);const second=service(request([[50,5],[50,5.05]]));await new Promise(r=>setImmediate(r));assert.deepEqual(starts,[0,1000]);assert.equal(release.length,2);
 release.forEach(done=>done());await Promise.all([first,same,second]);assert.equal((await service(input)).cached,true);assert.equal(starts.length,2);
});

// Synthetic river crossing at Maastricht: points < 2 km apart, bridge > 2 km
// north of the first point, outside all three rectangular search windows.
const riverA=[50.825,5.685],riverWest=[50.845,5.685],riverEast=[50.845,5.711],riverB=[50.823,5.711];
function riverSetup(){const points=[riverA,riverWest,riverEast,riverB],elements=[way(701,[1,2],[riverA,riverWest]),way(702,[2,3],[riverWest,riverEast]),way(703,[3,4],[riverEast,riverB])];return setup(points,elements,{osmFetcher:async(url,options)=>Response.json({elements:options.body.get('data').includes('node(id:')?elements:[elements[0],elements[2]]})});}
test('Maastricht : un pont hors cadre est trouvé entre deux points proches, sans imposer les passages intermédiaires',async()=>{
 const {service,calls}=riverSetup(),via=await service(request([riverA,riverWest,riverEast,riverB]));assert.ok(routeLength([riverA,riverB])<2000);assert.ok(routeLength(via.coordinates)>5000);
 const direct=await service(request([riverA,riverB]));assert.deepEqual(direct.coordinates,via.coordinates);assert.match(direct.engine,/vérifiés/);assert.equal(direct.accessPolicy,'explicit');assert.equal(direct.analysis.accessRuns.length,0);assert.equal(calls.filter(c=>c.source==='router').length,2);
 const count=calls.length,again=await service(request([riverA,riverB]));assert.equal(again.cached,true);assert.equal(calls.length,count);
});

test('petit trajet déjà routable : aucune recherche guidée supplémentaire',async()=>{
 const a=[50,5],b=[50,5.001],{service,calls}=setup([a,b],[way(1,[1,2],[a,b])]);const result=await service(request([a,b]));assert.deepEqual(result.coordinates,[a,b]);assert.equal(calls.filter(c=>c.source==='router').length,0);assert.equal(calls.length,1);
});
test('petit trajet et guide à contre-sens : la vérification refuse toujours le candidat public',async()=>{
 const a=[50,5],b=[50,5.001],{service,calls}=setup([b,a],[way(1,[1,2],[a,b],{oneway:'yes'})]);await assert.rejects(service(request([b,a])),e=>e.localNoPath&&e.status===422);assert.equal(calls.filter(c=>c.source==='router').length,1);assert.match(calls.find(c=>c.source==='router').url,/annotations=nodes/);
});
test('petit trajet avec point interdit aux vélos : aucun guide ne contourne cette interdiction',async()=>{
 const a=[50,5],b=[50,5.001],{service,calls}=setup([a,b],[way(1,[1,2],[a,b],{bicycle:'no'})]);await assert.rejects(service(request([a,b])),e=>e.bicycleForbidden&&e.status===422);assert.equal(calls.filter(c=>c.source==='router').length,0);
});
test('vérification du détour indisponible : erreur temporaire explicite, pas de faux refus pour sens interdit',async()=>{
 const elements=[way(1,[1,2],[riverA,riverWest]),way(2,[3,4],[riverEast,riverB])],{service,calls}=setup([riverA,riverWest,riverEast,riverB],elements,{osmFetcher:async(url,options)=>options.body.get('data').includes('node(id:')?new Response('',{status:503}):Response.json({elements})});
 await assert.rejects(service(request([riverA,riverB])),e=>e.status===503&&!e.localNoPath&&/temporairement indisponible/.test(e.message));assert.equal(calls.filter(c=>c.source==='router').length,1);
});

function incompleteGuide({missingStart=false,oneway=false}={}){
 const a=[50,5],near=[50.003,5],b=[50,5.04],elements=[way(1,[1,2,3],[a,near,b],oneway?{oneway:'yes'}:{})];let seen;
 const osm=async()=>({elements:missingStart?[way(1,[2,3],[near,b])]:elements});osm.forRoute=osm;
 const service=createRoutingService({localRouting:createLocalRouting({osmService:osm}),wait:async()=>{},fetcher:async url=>{
  seen=new URL(url);assert.equal(seen.searchParams.get('radiuses'),'1000;1000');
  return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[near,b].map(p=>p.slice().reverse())},legs:[{annotation:{nodes:[2,3]}}]}],waypoints:[near,b].map(p=>({location:p.slice().reverse()}))});
 }});return {a,b,near,elements,service,get seen(){return seen;}};
}
test('guide incomplet à Maastricht : départ public voisin accepté comme guide, vrais points conservés sur OSM',async()=>{
 const fixture=incompleteGuide(),result=await fixture.service(request([fixture.a,fixture.b]));assert.ok(fixture.seen);assert.deepEqual(result.snappedPoints,[fixture.a,fixture.b]);assert.deepEqual(result.coordinates,[fixture.a,fixture.near,fixture.b]);assert.equal(result.stats.tolerance,150);assert.equal(result.stats.maxOffset,0);assert.equal(result.accessPolicy,'explicit');
});
test('rayon élargi du guide : ne permet jamais de déplacer les vrais points au-delà de leur tolérance',async()=>{
 const fixture=incompleteGuide({missingStart:true});await assert.rejects(fixture.service(request([fixture.a,fixture.b])),e=>e.localNoPath&&e.status===422);assert.ok(fixture.seen);
});

function corridorFixture(tags={}){
 const points=[riverA,riverWest,riverEast,riverB],elements=[way(701,[1,2],[riverA,riverWest],tags),way(702,[2,3],[riverWest,riverEast]),way(703,[3,4],[riverEast,riverB])],calls=[],starts=[];let clock=0;
 const osm=createOSMService({mapFallback:true,now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async url=>{
  calls.push(String(url));if(String(url).includes('overpass'))return new Response('',{status:503});
  starts.push(clock);const [w,s,e,n]=new URL(url).searchParams.get('bbox').split(',').map(Number);assert.ok((e-w)*(n-s)<.0002);
  const picked=elements.filter(way=>Math.max(...way.geometry.map(p=>p.lat))>=s&&Math.min(...way.geometry.map(p=>p.lat))<=n&&Math.max(...way.geometry.map(p=>p.lon))>=w&&Math.min(...way.geometry.map(p=>p.lon))<=e),nodes=new Map();for(const way of picked)way.nodes.forEach((id,i)=>nodes.set(id,{type:'node',id,...way.geometry[i]}));
  return Response.json({elements:[...nodes.values(),...picked.map(({geometry,...way})=>way)]});
 }});return {osm,calls,starts,points};
}
test('Maastricht pendant une panne Overpass : vérifier le détour avec un corridor OSM direct borné, espacé et réutilisé',async()=>{
 const {osm,calls,starts,points}=corridorFixture(),local=createLocalRouting({osmService:osm}),guide={osmNodes:[1,2,3,4],coordinates:points},input={points:[riverA,riverB],tolerance:150,maxDistance:500000,accessMode:'explicit'};
 const result=await local.guided(input,guide);assert.deepEqual(result.coordinates,points);assert.deepEqual(result.snappedPoints,[riverA,riverB]);assert.equal(result.accessPolicy,'explicit');assert.match(result.osmSource,/OSM API/);assert.ok(starts.length>1&&starts.length<=24);assert.ok(starts.slice(1).every((at,i)=>at-starts[i]>=1000));
 const before=calls.length;assert.deepEqual((await local.guided({...input,points:[riverB,riverA]},guide)).coordinates,points.slice().reverse());assert.equal(calls.length,before);assert.equal(osm.peek([50.82,5.68,50.85,5.72]),null,'un couloir partiel ne couvre pas son rectangle');
});
test('corridor de secours : mêmes règles de sens unique et interdictions vélo que les sources principales',async()=>{
 for(const tags of [{oneway:'-1'},{bicycle:'no'}]){const {osm,points}=corridorFixture(tags),local=createLocalRouting({osmService:osm});await assert.rejects(local.guided({points:[riverA,riverB],tolerance:150,maxDistance:500000,accessMode:'explicit'},{osmNodes:[1,2,3,4],coordinates:points}),e=>e.localNoPath);}
});
test('corridor trop long : budget refusé avant tout téléchargement OSM direct',async()=>{
 let maps=0;const osm=createOSMService({mapFallback:true,fetcher:async url=>{if(!String(url).includes('overpass'))maps++;return new Response('',{status:503});}});
 await assert.rejects(osm.forRoute({nodes:[1,2],points:[[50,5],[50.2,5.4]],coordinates:[[50,5],[50.2,5.4]]}),e=>e.status===503);assert.equal(maps,0);
});
