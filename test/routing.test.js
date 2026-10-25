import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoutingService,routeRequest} from '../server/routing.js';
const request={points:[[50,5],[50.001,5.001]],tolerance:150};
const geometry={type:'LineString',coordinates:[[5,50],[5.0005,50.0005],[5.001,50.001]]};
const response=(data={code:'Ok',routes:[{geometry}]})=>new Response(JSON.stringify(data));
test('routage vélo complet, coordonnées lon/lat inversées correctement, rayon et identification',async()=>{
 let seen;const service=createRoutingService({wait:async()=>{},fetcher:async(url,options)=>{seen={url:new URL(url),options};return response();}}),r=await service(request);
 assert.match(seen.url.pathname,/routed-bike\/route\/v1\/driving\/5,50;5.001,50.001$/);assert.equal(seen.url.searchParams.get('radiuses'),'150;150');assert.equal(seen.url.searchParams.get('geometries'),'geojson');assert.match(seen.options.headers['User-Agent'],/Sillage/);
 assert.deepEqual(r.coordinates,[[50,5],[50.0005,5.0005],[50.001,5.001]]);assert.equal(r.engine,'OSRM vélo / FOSSGIS');assert.equal(r.cached,false);
});
test('cache et déduplication du même calcul ne multiplient pas les requêtes publiques',async()=>{
 let calls=0,complete,time=0;const service=createRoutingService({now:()=>time,wait:async()=>{},fetcher:()=>{calls++;return new Promise(r=>complete=r);}});
 const a=service(request),b=service(request);await new Promise(r=>setImmediate(r));assert.equal(calls,1);complete(response());await Promise.all([a,b]);assert.equal((await service(request)).cached,true);assert.equal(calls,1);
 time=600001;const c=service(request);await new Promise(r=>setImmediate(r));assert.equal(calls,2);complete(response());await c;
});
test('service public limité à une requête par seconde et file bornée',async()=>{
 let time=0;const starts=[];const service=createRoutingService({now:()=>time,wait:async ms=>{time+=ms;},fetcher:async()=>{starts.push(time);return response();}});
 await service(request);await service({...request,tolerance:75});await service({...request,tolerance:250});assert.deepEqual(starts,[0,1000,2000]);
 let finish;const busy=createRoutingService({wait:async()=>{},fetcher:()=>new Promise(r=>finish=r)}),jobs=[75,150,250,75].map((t,i)=>busy({points:[[50,5],[50.001+i*.0001,5.001]],tolerance:t}));
 await assert.rejects(busy({points:[[50,5],[50.005,5.005]]}),e=>e.status===429);
 // Complete every queued request without leaving any dangling promise.
 for(let i=0;i<jobs.length;i++){await new Promise(r=>setImmediate(r));finish(response({code:'NoRoute'}));await assert.rejects(jobs[i],/Aucun itinéraire/);}
});
test('refuse coordonnées invalides, réponse automobile éloignée, itinéraire absent et erreurs amont',async()=>{
 for(const body of [{points:[[500,5],[50,5]]},{points:[[50,5],[50,5]]},{points:[[50,5],[51,6]]},{...request,tolerance:100},{points:Array.from({length:13},(_,i)=>[50+i*.001,5])}])assert.throws(()=>routeRequest(body));
 assert.throws(()=>createRoutingService({base:'http://example.org'}),/HTTPS/);
 const missing=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'NoRoute'})});await assert.rejects(missing(request),/Aucun itinéraire/);
 const bad=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[6,51],[6.001,51.001]]}}]})});await assert.rejects(bad(request),/éloigné/);
 const down=createRoutingService({wait:async()=>{},fetcher:async()=>{throw Error('network');}});await assert.rejects(down(request),e=>e.status===504);
 const limited=createRoutingService({wait:async()=>{},fetcher:async()=>new Response('',{status:429})});await assert.rejects(limited(request),e=>e.status===429);
});

test('points de passage transmis en ordre, tolérance sur chaque point et fractions des étapes',async()=>{
 let url;const points=[[50,5],[50.0005,5.0005],[50.001,5.001]];
 const service=createRoutingService({wait:async()=>{},fetcher:async u=>{url=new URL(u);return response({code:'Ok',routes:[{geometry,legs:[{distance:100},{distance:300}]}],waypoints:points.map(p=>({location:[p[1],p[0]]}))});}});
 const r=await service({points,tolerance:75});assert.match(url.pathname,/5,50;5.0005,50.0005;5.001,50.001$/);assert.equal(url.searchParams.get('radiuses'),'75;75;75');assert.equal(url.searchParams.get('continue_straight'),'false');assert.deepEqual(r.legFractions,[0,.25,1]);
 const far=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'Ok',routes:[{geometry}],waypoints:[{location:[5,50]},{location:[6,51]},{location:[5.001,50.001]}]})});await assert.rejects(far({points,tolerance:75}),/éloigné/);
});

test('accrochage d’un point au réseau avec rayon, cache et même limite de débit que le routage',async()=>{
 let time=0;const seen=[];const service=createRoutingService({now:()=>time,wait:async ms=>{time+=ms;},fetcher:async url=>{seen.push(new URL(url));return url.includes('/nearest/')?response({code:'Ok',waypoints:[{location:[5,50.0001]}]}):response();}});
 const nearest=await service.nearest({point:[50,5],tolerance:75});assert.deepEqual(nearest.point,[50.0001,5]);assert.match(seen[0].pathname,/\/nearest\/v1\/driving\/5,50$/);assert.equal(seen[0].searchParams.get('radiuses'),'75');await service(request);assert.equal(time,1000);assert.equal((await service.nearest({point:[50,5],tolerance:75})).cached,true);assert.equal(seen.length,2);
 const far=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'Ok',waypoints:[{location:[6,51]}]})});await assert.rejects(far.nearest({point:[50,5],tolerance:75}),/éloigné/);
});
test('planification longue distincte des portions : 500 km / 50 points et points réellement accrochés retournés',async()=>{
 const points=[[50,5],[50.3,5],[50.6,5]];assert.throws(()=>routeRequest({points}));assert.equal(routeRequest({points,purpose:'itinerary'}).maxDistance,500000);assert.throws(()=>routeRequest({points:Array.from({length:51},(_,i)=>[50+i*.001,5]),purpose:'itinerary'}));
 const service=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[5,50.0001],[5,50.3],[5,50.6001]]}}],waypoints:[{location:[5,50.0001]},{location:[5,50.3]},{location:[5,50.6001]}]})});const r=await service({points,purpose:'itinerary'});assert.deepEqual(r.snappedPoints,[[50.0001,5],[50.3,5],[50.6001,5]]);
});

test('le secours public refuse les portions à pied ou poussées qui peuvent remonter un sens unique',async()=>{
 for(const mode of ['pushing bike','walking','steps up','steps down']){let url;const service=createRoutingService({wait:async()=>{},fetcher:async u=>{url=new URL(u);return response({code:'Ok',routes:[{geometry,legs:[{steps:[{mode}]}]}]});}});await assert.rejects(service(request),/passage à pied/);assert.equal(url.searchParams.get('steps'),'true');}
 const service=createRoutingService({wait:async()=>{},fetcher:async()=>response({code:'Ok',routes:[{geometry,legs:[{steps:[{mode:'cycling'}]}]}]})});assert.ok((await service(request)).coordinates.length);
});
