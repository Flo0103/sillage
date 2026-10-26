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
 const points=[fixture.endpoints[0],fixture.via,fixture.endpoints[1]],r=await route({points,allowRestricted:true,purpose:'itinerary'});assert.equal(r.osmSource,'OSM API');assert.equal(r.accessPolicy,'explicit');assert.equal(r.warning,undefined);assert.ok(r.analysis.surfaceRuns.some(s=>s.unpaved));assert.ok(r.analysis.accessRuns.length);assert.equal(calls.length,2);
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

test('étapes rapprochées : réutilisation du cache avec la marge nécessaire plutôt que téléchargement de chaque grand cadre',async()=>{
 let calls=0,clock=0;const osm=createOSMService({ttl:1000,now:()=>clock,fetcher:async()=>{calls++;return Response.json({elements:fixture.elements});}}),route=createLocalRouting({osmService:osm});
 await route({points:fixture.endpoints,tolerance:150});assert.equal(calls,1);await route({points:[fixture.endpoints[0],fixture.via,fixture.endpoints[1]],tolerance:150});assert.equal(calls,1);assert.ok(osm.peek([50.492,5.867,50.496,5.872]));clock=1001;assert.equal(osm.peek([50.492,5.867,50.496,5.872]),null);await route({points:fixture.endpoints,tolerance:150});assert.equal(calls,2);
});
test('un accrochage en cours chauffe la zone pour une étape voisine sans requête concurrente supplémentaire',async()=>{
 let calls=0,release;const osm=createOSMService({fetcher:()=>{calls++;return new Promise(r=>release=()=>r(Response.json({elements:fixture.elements})));}}),local=createLocalRouting({osmService:osm});const start=local.nearest({point:fixture.endpoints[0],tolerance:150});await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 const pending=local({points:[fixture.endpoints[0],[50.4921965,5.8699391]],tolerance:150});await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();const [nearest,result]=await Promise.all([start,pending]);assert.equal(nearest.point[0],fixture.endpoints[0][0]);assert.ok(result.coordinates.length>2);assert.equal(calls,1);
});

test('échecs Overpass espacés progressivement sans repousser la reprise à chaque utilisation du secours',async()=>{
 let clock=0,attempts=0;const service=createOSMService({mapFallback:true,now:()=>clock,wait:async()=>{},fetcher:async url=>{if(String(url).includes('overpass')){attempts++;if(attempts!==3)throw Error('occupied');return Response.json({elements:fixture.elements});}return Response.json(apiData());}});
 const box=n=>[50+n*.02,5,50.005+n*.02,5.005];await service(box(0));assert.equal(attempts,1);clock=30000;await service(box(1));assert.equal(attempts,1);clock=61000;await service(box(2));assert.equal(attempts,2);clock=130000;await service(box(3));assert.equal(attempts,2);clock=182000;await service(box(4));assert.equal(attempts,3);clock=183000;await service(box(5));assert.equal(attempts,4);clock=244000;await service(box(6));assert.equal(attempts,5);
});

test('longue étape restreinte : mosaïque OSM bornée plutôt que détour du fournisseur de secours',async()=>{
 const points=[[50.5,6.05],[50.51,6.07],[50.52,6.09],[50.53,6.11]],ways=points.slice(1).map((p,i)=>({type:'way',id:100+i,nodes:[i+1,i+2],geometry:[{lat:points[i][0],lon:points[i][1]},{lat:p[0],lon:p[1]}],tags:{highway:'track',surface:'gravel',...(i===1?{access:'private'}:{})}}));let now=0,overpass=0,external=0;const requests=[];
 const osm=createOSMService({mapFallback:true,now:()=>now,wait:async ms=>{now+=ms;},fetcher:async url=>{
  if(String(url).includes('overpass')){overpass++;throw Error('Overpass indisponible');}
  const [w,s,e,n]=new URL(url).searchParams.get('bbox').split(',').map(Number);requests.push([w,s,e,n]);assert.ok((e-w)*(n-s)<=.001);
  const picked=ways.filter(way=>Math.max(...way.geometry.map(p=>p.lat))>=s&&Math.min(...way.geometry.map(p=>p.lat))<=n&&Math.max(...way.geometry.map(p=>p.lon))>=w&&Math.min(...way.geometry.map(p=>p.lon))<=e),nodes=new Map();for(const way of picked)way.nodes.forEach((id,i)=>nodes.set(id,{type:'node',id,...way.geometry[i]}));return Response.json({elements:[...nodes.values(),...picked.map(({geometry,...way})=>way)]});
 }}),route=createRoutingService({localRouting:createLocalRouting({osmService:osm}),fetcher:async()=>{external++;throw Error('Ne pas contourner les accès');}});
 const via=[50.515,6.08],result=await route({points:[points[0],via,points.at(-1)],allowRestricted:true,purpose:'itinerary'});assert.equal(result.accessPolicy,'explicit');assert.equal(result.osmSource,'OSM API');assert.equal(external,1);assert.equal(overpass,1);assert.ok(requests.length>1&&requests.length<=9);assert.ok(result.analysis.accessRuns.some(r=>/privé/.test(r.label)));assert.deepEqual(result.coordinates,[points[0],points[1],via,points[2],points[3]]);
 const count=requests.length;await route({points:[points.at(-1),via,points[0]],allowRestricted:true,purpose:'itinerary'});assert.equal(requests.length,count);assert.equal(external,1);
});
test('mosaïque : cases sans chemin valides, nombre de zones borné et téléchargement dédupliqué',async()=>{
 let overpass=0,maps=0,clock=0;const osm=createOSMService({mapFallback:true,now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async url=>{if(String(url).includes('overpass')){overpass++;throw Error('offline');}maps++;return Response.json({elements:[]});}}),box=[50.501,6.051,50.539,6.089];const result=await Promise.all([osm.forRouting(box),osm.forRouting(box)]);assert.deepEqual(result[0].elements,[]);assert.equal(maps,4);assert.equal(overpass,1);await osm.forRouting(box);assert.equal(maps,4);await assert.rejects(osm.forRouting([50.4,6,50.5,6.1]));assert.equal(maps,4);
});
