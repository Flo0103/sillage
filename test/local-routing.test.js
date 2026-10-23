import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeOnOSM,createLocalRouting} from '../server/local-routing.js';
import {createRoutingService} from '../server/routing.js';
import {surfaceInfo,bicycleDirections,bicycleAccess} from '../dist/osm-tags.js';
import {surfaceProfile,createPlanMetrics} from '../server/plan-metrics.js';
import {planData} from '../server/plans.js';
import {ItineraryDraft} from '../dist/planner.js';
import {routeRenderRuns,buildElevationModel} from '../dist/elevation.js';
const a=[50,5],b=[50.001,5],c=[50.002,5];
const way=(nodes,points,tags={})=>({id:nodes.join('-'),nodes,geometry:points.map(([lat,lon])=>({lat,lon})),tags:{highway:'residential',...tags}});
test('rue découpée au changement de surface : raccord au nœud commun, revêtement et pointillés exacts',()=>{
 const elements=[way([1,2],[a,b],{surface:'asphalt'}),way([2,3,4],[b,[50.0010001,5],c],{surface:'gravel'})],r=routeOnOSM([a,c],elements);
 assert.deepEqual(r.coordinates,[a,b,[50.0010001,5],c]);assert.deepEqual(r.analysis.surfaces.map(s=>s.type),['Asphalte / bitume','Gravier']);
 const draft=new ItineraryDraft();draft.append(a);draft.append(c);draft.resolve(draft.legs[0].id,r);const runs=routeRenderRuns(draft.legs,'simple',buildElevationModel(draft.legs));assert.equal(runs[0].dashArray,null);assert.equal(runs[1].dashArray,'7 7');assert.equal(draft.legs[0].analysis.accessRuns.length,0);
 const data=planData({name:'Rue au changement de surface',coordinates:draft.coordinates(),legs:draft.serialise(),snapped:true});assert.equal(data.legs[0].analysis.surfaceVersion,2);assert.equal(Object.hasOwn(data.legs[0].analysis,'elevation'),false);assert.equal(data.legs[0].analysis.surfaceRuns[1].unpaved,true);
});
test('projection sur une arête longue : deux clics proches restent distincts entre les nœuds',()=>{
 const points=[[50.0001,5.00001],[50.00011,5.00001]],r=routeOnOSM(points,[way([1,2],[a,b])]);assert.equal(r.coordinates.length,2);assert.ok(r.coordinates[0][0]<r.coordinates[1][0]);assert.ok(r.coordinates.every(p=>p[1]===5));assert.ok(r.stats.maxOffset<2);
 const via=routeOnOSM([[50.0001,5],[50.00011,5],[50.00012,5]],[way([1,2],[a,b])]);assert.equal(via.legFractions.length,3);assert.ok(Math.abs(via.legFractions[1]-.5)<.001);
});
test('sens uniques, sens inverse, rond-point et exceptions vélo sont appliqués au graphe dirigé',()=>{
 for(const tags of [{oneway:'yes'},{junction:'roundabout'},{'oneway:bicycle':'yes'}]){assert.ok(routeOnOSM([a,b],[way([1,2],[a,b],tags)]));assert.throws(()=>routeOnOSM([b,a],[way([1,2],[a,b],tags)]),e=>e.localNoPath===true);}
 assert.throws(()=>routeOnOSM([a,b],[way([1,2],[a,b],{oneway:'-1'})]),e=>e.localNoPath===true);assert.ok(routeOnOSM([b,a],[way([1,2],[a,b],{oneway:'-1'})]));
 for(const tags of [{oneway:'yes','oneway:bicycle':'no'},{oneway:'yes',cycleway:'opposite_lane'},{oneway:'yes','cycleway:left:oneway':'-1'}])assert.ok(routeOnOSM([b,a],[way([1,2],[a,b],tags)]));
 assert.deepEqual(bicycleDirections({oneway:'-1','cycleway:left:oneway':'-1'}),{forward:false,backward:true});assert.deepEqual(bicycleDirections({oneway:'-1','cycleway:left:oneway':'yes'}),{forward:true,backward:true});
 assert.deepEqual(bicycleDirections({oneway:'yes','oneway:bicycle':'yes',cycleway:'opposite_lane'}),{forward:true,backward:false});
});
test('sens unique évité par un détour légal ; traversées et nœuds simplement proches ne sont jamais fusionnés',()=>{
 const x=[50.001,5.001],elements=[way([1,2],[a,b],{oneway:'yes'}),way([2,3,1],[b,x,a])];assert.deepEqual(routeOnOSM([b,a],elements).coordinates,[b,x,a]);
 assert.throws(()=>routeOnOSM([a,c],[way([1,2],[a,b]),way([20,3],[[50.00100001,5],c])]),e=>e.localNoPath===true);
 assert.throws(()=>routeOnOSM([[49.999,5.001],[50,5.002]],[way([1,2],[[49.999,5.001],[50.001,5.001]]),way([3,4],[a,[50,5.002]])]),e=>e.localNoPath===true);
});
test('accès limités routables et signalés uniquement sur la portion concernée, accès vélo prioritaire',()=>{
 const elements=[way([1,2],[a,b],{surface:'asphalt'}),way([2,3],[b,c],{surface:'gravel',access:'private'})],r=routeOnOSM([a,c],elements);assert.equal(r.analysis.accessRuns.length,1);assert.deepEqual(r.analysis.accessRuns[0].coordinates,[b,c]);assert.match(r.analysis.accessRuns[0].label,/privé/);
 assert.equal(bicycleAccess({access:'private',bicycle:'yes'}),null);assert.equal(bicycleAccess({bicycle:'yes','access:conditional':'no @ (winter)'}),null);assert.equal(bicycleAccess({highway:'path'}),null);assert.match(bicycleAccess({'access:conditional':'no @ (winter)'}).label,/winter/);assert.equal(bicycleAccess({'access:forward':'no'},'backward'),null);
 const draft=new ItineraryDraft();draft.append(a);draft.append(c);draft.resolve(draft.legs[0].id,r);const data=planData({name:'Accès',coordinates:draft.coordinates(),legs:draft.serialise(),snapped:true});assert.deepEqual(data.legs[0].analysis.accessRuns,r.analysis.accessRuns);assert.throws(()=>planData({...data,legs:data.legs.map(l=>({...l,analysis:{...l.analysis,accessRuns:[{label:'x'.repeat(201),coordinates:[a,b]}]}}))}),/Accès/);
});
test('revêtements : variantes OSM, tracktype non revêtu et inconnus conservés sans supposition',()=>{
 for(const value of ['ASPHALT','bitumen','concrete:lanes','concrete:plates'])assert.equal(surfaceInfo({surface:value}).unpaved,false);
 for(const value of ['gravel','unpaved','woodchips','paving_stones','earth','gravel;ground'])assert.equal(surfaceInfo({surface:value}).unpaved,true);
 assert.equal(surfaceInfo({surface:'asphalt;gravel'}).unpaved,null);assert.equal(surfaceInfo({tracktype:'grade3'}).type,'Non revêtu (tracktype)');assert.equal(surfaceInfo({highway:'track'}).unpaved,null);assert.equal(surfaceInfo({tracktype:'grade1'}).type,'Inconnu');
 const r=surfaceProfile([a,b,c],[way([1,2],[a,b],{surface:'asphalt'}),way([2,3],[b,c],{tracktype:'grade2',access:'no'})]);assert.equal(r.surfaceRuns[1].unpaved,true);assert.equal(r.accessRuns.length,1);assert.ok(r.accessRuns[0].coordinates[0][0]>=b[0]-.0001);
});
test('analyse de surface récupère géométrie et tags ; réponse sans géométrie ne devient pas un succès inconnu',async()=>{
 let query;const service=createPlanMetrics({wait:async()=>{},fetcher:async(u,o)=>{query=o.body.get('data');return Response.json({elements:[way([1,2],[a,b],{surface:'gravel'})]});}}),r=await service({coordinates:[a,b],kind:'surface'});assert.match(query,/out body geom/);assert.equal(r.surfaceRuns[0].unpaved,true);assert.equal(r.surfaceVersion,2);
 const bad=createPlanMetrics({wait:async()=>{},fetcher:async()=>Response.json({elements:[{tags:{highway:'track',surface:'gravel'}}]})});assert.match((await bad({coordinates:[a,b],kind:'surface'})).errors[0],/indisponibles/);
});
test('service local élargit la zone si aucun passage et accroche précisément un départ',async()=>{
 let calls=0;const elements=[way([1,2],[a,b])],service=createLocalRouting({osmService:async()=>{calls++;return {elements,cached:true};}});assert.equal((await service({points:[a,b],tolerance:150})).engine,'OSM local · sens vélo');assert.equal((await service.nearest({point:[50.0005,5.0001],tolerance:150})).point[1],5);assert.equal(calls,2);
 const missing=createLocalRouting({osmService:async()=>{calls++;return {elements:[way([1,2],[a,b],{oneway:'yes'})]};}});await assert.rejects(missing({points:[b,a],tolerance:150}),e=>e.localNoPath);assert.equal(calls,4);
});
test('calcul local prioritaire : aucun secours qui contourne un sens unique ; panne locale annoncée en secours',async()=>{
 let external=0;const result=routeOnOSM([a,b],[way([1,2],[a,b])]),local=async()=>result;local.nearest=async()=>({point:a});
 const service=createRoutingService({wait:async()=>{},localRouting:local,fetcher:async()=>{external++;return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[5,50],[5,50.001]]}}]});}});assert.equal((await service({points:[a,b],allowRestricted:true})).accessPolicy,'warn');assert.deepEqual((await service.nearest({point:a,allowRestricted:true})).point,a);assert.equal(external,0);
 const noRoute=createRoutingService({localRouting:async()=>{throw Object.assign(Error('sens interdit'),{localNoPath:true});},fetcher:async()=>{external++;}});await assert.rejects(noRoute({points:[b,a],allowRestricted:true}),/sens interdit/);assert.equal(external,0);
 const fallback=createRoutingService({wait:async()=>{},localRouting:async()=>{throw Error('OSM indisponible');},fetcher:async()=>{external++;return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[5,50],[5,50.001]]}}]});}});const response=await fallback({points:[a,b],allowRestricted:true});assert.match(response.warning,/secours/);assert.equal(response.accessPolicy,'provider');assert.equal(external,1);
});

test('cas réel Spa : rue entière dans les deux sens avec ou sans passage intermédiaire',async()=>{
 const {readFile}=await import('node:fs/promises'),fixture=JSON.parse(await readFile(new URL('fixtures/spa-jeu-de-paume.json',import.meta.url),'utf8'));
 const direct=routeOnOSM(fixture.endpoints,fixture.elements),reverse=routeOnOSM(fixture.endpoints.slice().reverse(),fixture.elements),length=r=>r.analysis.surfaces.reduce((n,s)=>n+s.distance,0);
 assert.ok(Math.abs(length(direct)-822.7)<.5);assert.ok(Math.abs(length(reverse)-length(direct))<.1);
 // Le raccourci voisin en grade4 est moins adapté : le profil gravel conserve la rue en grade2.
 for(const points of [[fixture.endpoints[0],fixture.via,fixture.endpoints[1]],[fixture.endpoints[1],fixture.via,fixture.endpoints[0]]]){
  const r=routeOnOSM(points,fixture.elements);assert.ok(Math.abs(length(r)-822.7)<.5);const gravel=r.analysis.surfaces.find(s=>s.type==='Gravier');assert.ok(Math.abs(gravel.distance-389.8)<.5);assert.equal(r.analysis.surfaceRuns.find(s=>s.type==='Gravier').unpaved,true);assert.ok(r.analysis.accessRuns.some(s=>/destination/.test(s.label)));
 }
 // Le raccord du changement de revêtement est le même identifiant OSM, sans raccord fictif.
 const asphalt=fixture.elements.find(w=>w.id===330261170),gravel=fixture.elements.find(w=>w.id===1293634009);assert.equal(asphalt.nodes.at(-1),3065855837);assert.equal(gravel.nodes.at(-1),3065855837);
});

test('graphe et résultats réutilisés sans modifier le réseau ni mélanger les contrôles entre requêtes',async()=>{
 const {prepareOSM}=await import('../server/local-routing.js'),elements=[way([1,2,3],[a,b,c],{oneway:'yes',surface:'gravel'})],prepared=prepareOSM(elements),first=routeOnOSM([[50.0001,5],[50.0019,5]],elements);
 assert.equal(first.cached,false);assert.equal(routeOnOSM([[50.0001,5],[50.0019,5]],elements).cached,true);assert.equal(prepareOSM(elements),prepared);const other=routeOnOSM([[50.0002,5],[50.0018,5]],elements);assert.equal(other.coordinates[0][0],50.0002);assert.equal(prepared.nodes.size,3);assert.ok([...prepared.graph.values()].flat().every(edge=>!edge.to.startsWith('control:')));
 assert.throws(()=>routeOnOSM([[50.0018,5],[50.0002,5]],elements),e=>e.localNoPath);const fresh=structuredClone(elements);fresh[0].tags.oneway='no';assert.ok(routeOnOSM([[50.0018,5],[50.0002,5]],fresh).coordinates.length);assert.notEqual(prepareOSM(fresh),prepared);
});
test('index spatial trouve aussi le milieu des longues arêtes et refuse les projections confondues',()=>{
 const elements=[way([1,2],[[50,5],[50,5.8]])],r=routeOnOSM([[50.0001,5.5],[50.0001,5.5001]],elements,{tolerance:75});assert.ok(r.coordinates.every(p=>p[0]===50));assert.ok(r.stats.maxOffset<12);assert.ok(r.coordinates[0][1]<r.coordinates.at(-1)[1]);assert.throws(()=>routeOnOSM([[50.0001,5.5],[50.0002,5.5]],elements),e=>e.localNoPath);
});
test('un raccord absent ou un grand détour dans un cache partiel entraîne une recherche plus large',async()=>{
 const partial=[way([1,4,5,2],[a,[50.01,5],[50.01,5.001],[50,5.001]])],full=[...partial,way([1,2],[a,[50,5.001]])];let calls=0;const osm=async()=>{calls++;return {elements:full};};osm.peek=()=>({elements:partial,cached:true});const local=createLocalRouting({osmService:osm}),r=await local({points:[a,[50,5.001]],tolerance:150});assert.equal(calls,1);assert.equal(r.coordinates.length,2);
});

test('réutilisation de nombreuses paires : mêmes distances qu’un Dijkstra indépendant sur un réseau dirigé',async()=>{
 const {distance}=await import('../server/model.js'),size=4,nodes=Array.from({length:size*size},(_,i)=>[50+Math.floor(i/size)*.0005,5+i%size*.0007]),ways=[],graph=nodes.map(()=>[]);
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){const id=row*size+col;for(const next of [col+1<size?id+1:null,row+1<size?id+size:null]){if(next===null)continue;ways.push(way([id,next],[nodes[id],nodes[next]],{oneway:'yes'}));graph[id].push([next,distance(nodes[id],nodes[next])]);}}
 function expected(start,end){const ds=nodes.map(()=>Infinity),visited=new Set();ds[start]=0;for(;;){let at=-1;for(let i=0;i<ds.length;i++)if(!visited.has(i)&&Number.isFinite(ds[i])&&(at<0||ds[i]<ds[at]))at=i;if(at<0)return Infinity;if(at===end)return ds[at];visited.add(at);for(const [next,meters]of graph[at])ds[next]=Math.min(ds[next],ds[at]+meters);}}
 for(let start=0;start<nodes.length;start++)for(let end=0;end<nodes.length;end++){if(start===end)continue;const meters=expected(start,end);if(!Number.isFinite(meters))assert.throws(()=>routeOnOSM([nodes[start],nodes[end]],ways),e=>e.localNoPath);else{const result=routeOnOSM([nodes[start],nodes[end]],ways),actual=result.analysis.surfaces.reduce((n,s)=>n+s.distance,0);assert.ok(Math.abs(actual-meters)<.01);}}
});
