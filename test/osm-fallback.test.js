import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOSMService,osmMapWays} from '../server/osm.js';
import {createLocalRouting} from '../server/local-routing.js';
import {createRoutingService} from '../server/routing.js';
const fixture=JSON.parse(await readFile(new URL('fixtures/spa-jeu-de-paume.json',import.meta.url),'utf8'));
function apiData(){const nodes=new Map();for(const w of fixture.elements)w.nodes.forEach((id,i)=>nodes.set(id,{type:'node',id,...w.geometry[i]}));return {elements:[...nodes.values(),...fixture.elements.map(({geometry,...w})=>w),{type:'way',id:999,nodes:[1,2],tags:{building:'yes'}}]};}
const small=[50.490,5.866,50.499,5.874];
test('JSON OSM : reconstruction des géométries par nœud, tags conservés, bâtiments ignorés et réponse incomplète refusée',()=>{
 const ways=osmMapWays(apiData());assert.equal(ways.length,fixture.elements.length);assert.deepEqual(ways.find(w=>w.id===1293634009),fixture.elements.find(w=>w.id===1293634009));const missing=apiData();missing.elements=missing.elements.filter(e=>e.type!=='node'||e.id!==3065855837);assert.throws(()=>osmMapWays(missing),/incomplète/);assert.throws(()=>osmMapWays({elements:[]}),/Aucun chemin/);
});
test('panne Overpass : le service complet garde le routage local à Spa, les accès et les pointillés, sans OSRM',async()=>{
 const calls=[],service=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async(url,options)=>{calls.push({url:String(url),options});return String(url).includes('overpass')?new Response('',{status:503}):Response.json(apiData());}}),route=createRoutingService({localRouting:createLocalRouting({osmService:service}),fetcher:async()=>{throw Error('OSRM ne doit pas être appelé');}});
 const points=[fixture.endpoints[0],fixture.via,fixture.endpoints[1]],r=await route({points,allowRestricted:true,purpose:'itinerary'});assert.equal(r.osmSource,'OSM API');assert.equal(r.accessPolicy,'warn');assert.equal(r.warning,undefined);assert.ok(r.analysis.surfaceRuns.some(s=>s.unpaved));assert.ok(r.analysis.accessRuns.length);assert.equal(calls.length,2);
 const url=new URL(calls[1].url),[w,s,e,n]=url.searchParams.get('bbox').split(',').map(Number);assert.equal(url.hostname,'api.openstreetmap.org');assert.ok(points.every(([lat,lon])=>lat>=s&&lat<=n&&lon>=w&&lon<=e));await route({points:points.slice().reverse(),allowRestricted:true,purpose:'itinerary'});assert.equal(calls.length,2);
});
test('source directe limitée aux petites zones ; panne et réponse partielle ne déclenchent aucune boucle de requêtes',async()=>{
 const calls=[],service=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async url=>{calls.push(String(url));return new Response('',{status:503});}});
 await assert.rejects(service([50,5,50.1,5.1]));assert.equal(calls.length,1);await assert.rejects(service(small));assert.equal(calls.length,2);assert.match(calls[1],/api.openstreetmap.org/);await assert.rejects(service(small));assert.equal(calls.length,2);
 const bad=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async url=>String(url).includes('overpass')?Response.json({elements:[],remark:'timeout'}):Response.json({elements:[{type:'way',id:1,nodes:[1,2],tags:{highway:'residential'}}]})});await assert.rejects(bad(small),/incomplète/);
});
test('secours direct dédupliqué, espacé d’une seconde et conservé une heure pour limiter les téléchargements',async()=>{
 let now=0,calls=0;const starts=[],service=createOSMService({mapFallback:true,now:()=>now,wait:async ms=>{now+=ms;},fetcher:async url=>{calls++;if(String(url).includes('overpass'))throw Error('offline');starts.push(now);return Response.json(apiData());}});
 const first=await Promise.all([service(small),service(small)]);assert.equal(calls,2);assert.equal(first[0].source,'OSM API');assert.equal(first[1].cached,true);await service([50.52,5.866,50.529,5.874]);assert.deepEqual(starts,[0,1000]);now=600001;const cached=await service(small);assert.equal(cached.cached,true);assert.equal(calls,3);
});

test('une zone trop dense ne désactive pas le secours OSM pour toutes les zones plus petites',async()=>{
 let mapCalls=0;const service=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async url=>{if(String(url).includes('overpass'))throw Error('offline');mapCalls++;return mapCalls===1?new Response('Too many nodes',{status:400}):Response.json(apiData());}});
 const large=[50.48,5.85,50.505,5.8875];await assert.rejects(service(large));assert.equal(mapCalls,1);await assert.rejects(service(large));assert.equal(mapCalls,1);const r=await service(small);assert.equal(r.source,'OSM API');assert.equal(mapCalls,2);
});
test('accrochage initial puis itinéraire complet à Spa : petite emprise, aucun secours OSRM, rue entière sans passage ajouté',async()=>{
 const boxes=[],service=createOSMService({mapFallback:true,wait:async()=>{},fetcher:async url=>{if(String(url).includes('overpass'))throw Error('offline');const bbox=new URL(url).searchParams.get('bbox').split(',').map(Number);boxes.push(bbox);const[w,s,e,n]=bbox;if((e-w)*(n-s)>.0005)return new Response('Too many nodes',{status:400});return Response.json(apiData());}}),route=createRoutingService({localRouting:createLocalRouting({osmService:service}),fetcher:async()=>{throw Error('OSRM ne doit pas être appelé');}});
 const nearest=await route.nearest({point:fixture.endpoints[0],allowRestricted:true,tolerance:150});assert.deepEqual(nearest.point,fixture.endpoints[0]);const [w,s,e,n]=boxes[0];assert.ok((e-w)*(n-s)<.0003);
 for(const points of [fixture.endpoints,fixture.endpoints.slice().reverse()]){const r=await route({points,allowRestricted:true,purpose:'itinerary'});assert.equal(r.osmSource,'OSM API');assert.ok(Math.abs(r.analysis.surfaces.reduce((sum,s)=>sum+s.distance,0)-822.7)<.5);assert.ok(r.analysis.surfaceRuns.some(s=>s.type==='Gravier'&&s.unpaved));}
});
