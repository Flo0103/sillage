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
