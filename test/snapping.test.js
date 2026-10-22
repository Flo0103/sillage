import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeOSM,matchOSMDetailed,shortest,selectionBounds} from '../dist/geo.js';
import {createOSMService,validateBox} from '../server/osm.js';
const line=[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.02}]}];
function response(elements=[]){return new Response(JSON.stringify({elements}),{headers:{'Content-Type':'application/json'}});}
test('tolérance 150 m accepte un décalage GPS refusé en mode précis',()=>{const trace=[[50.0012,5.002],[50.0012,5.01],[50.0012,5.018]];const result=matchOSMDetailed(trace,line);assert.ok(result.stats.maxOffset>120&&result.stats.maxOffset<150);assert.ok(result.coordinates.every(p=>p[0]===50));assert.throws(()=>matchOSMDetailed(trace,line,{tolerance:75}),/éloignés/);});
test('250 m est disponible sans accepter une trace arbitrairement éloignée',()=>{const trace=[[50.0019,5.002],[50.0019,5.018]];assert.throws(()=>matchOSMDetailed(trace,line,{tolerance:150}));assert.ok(matchOSMDetailed(trace,line,{tolerance:250}).stats.maxOffset>200);assert.throws(()=>matchOSMDetailed([[50.004,5.002],[50.004,5.018]],line,{tolerance:250}));});
test('candidats connectés préférés au nœud isolé le plus proche',()=>{const roads=[...line,{id:2,nodes:[3,4],geometry:[{lat:50.0002,lon:5.0099},{lat:50.0002,lon:5.0101}]}];const result=matchOSMDetailed([[50.0002,5.002],[50.0002,5.01],[50.0002,5.018]],roads);assert.ok(result.coordinates.every(p=>p[0]===50));});
test('ne crée pas de connexion entre des composantes réellement séparées',()=>{assert.throws(()=>matchOSMDetailed([[50,5],[50,5.02]],[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.001}]},{id:2,nodes:[3,4],geometry:[{lat:50,lon:5.019},{lat:50,lon:5.02}]}]),/non reliés/);});
test('le chemin reste refusé quand le détour est excessif',()=>{const roads=[{id:1,nodes:[1,2,3,4],geometry:[{lat:50,lon:5},{lat:50.01,lon:5},{lat:50.01,lon:5.001},{lat:50,lon:5.001}]}];assert.throws(()=>matchOSMDetailed([[50,5],[50,5.001]],roads),/détour/);});
test('A* garde le même chemin optimal que Dijkstra',()=>{const nodes=new Map([[1,[50,5]],[2,[50,5.001]],[3,[50.001,5]],[4,[50,5.002]]]),graph=new Map([[1,[[2,72],[3,112]]],[2,[[4,72]]],[3,[[4,250]]],[4,[]]]);assert.deepEqual(shortest(graph,1,4,nodes),shortest(graph,1,4));});
test('la marge demandée à OSM augmente avec la tolérance',()=>{const trace=[[50,5],[50.01,5.01]],small=selectionBounds(trace,75),large=selectionBounds(trace,250);assert.ok(large[0]<small[0]&&large[1]<small[1]&&large[2]>small[2]&&large[3]>small[3]);assert.throws(()=>validateBox([0,0,10,10]));});
test('cache OSM réutilise une zone englobante puis expire',async()=>{let time=0,calls=0;const service=createOSMService({fetcher:async()=>{calls++;return response(line);},now:()=>time,ttl:1000});const a=await service([50,5,50.01,5.01]),b=await service([50.002,5.002,50.008,5.008]);assert.equal(a.cached,false);assert.equal(b.cached,true);assert.equal(calls,1);time=1001;assert.equal((await service([50,5,50.01,5.01])).cached,false);assert.equal(calls,2);});
test('deux requêtes simultanées vers la même zone partagent un téléchargement',async()=>{let resolve,calls=0;const service=createOSMService({fetcher:()=>{calls++;return new Promise(r=>resolve=r);}});const a=service([50,5,50.01,5.01]),b=service([50,5,50.01,5.01]);assert.equal(calls,1);resolve(response(line));await Promise.all([a,b]);assert.equal(calls,1);});
test('les réponses OSM en erreur ne sont pas mises en cache',async()=>{let calls=0;const service=createOSMService({fetcher:async()=>{calls++;return calls===1?new Response('unavailable',{status:503}):response(line);}});await assert.rejects(service([50,5,50.01,5.01]));await service([50,5,50.01,5.01]);assert.equal(calls,2);});
test('les réponses partielles OSM ne deviennent pas un graphe valide',async()=>{const service=createOSMService({fetcher:async()=>new Response(JSON.stringify({elements:line,remark:'runtime error: timeout'}))});await assert.rejects(service([50,5,50.01,5.01]),/incomplète/);});
test('un écart GPS isolé ne fait pas échouer toute la portion',()=>{const trace=Array.from({length:151},(_,i)=>[i===75?50.0016:50,5+i*.0001]);const result=matchOSMDetailed(trace,line);assert.equal(result.stats.ignoredAnchors,1);assert.ok(result.coordinates.every(p=>p[0]===50));});
test('le cache OSM borne sa mémoire et recharge les zones évincées',async()=>{let calls=0;const bytes=Buffer.byteLength(JSON.stringify({elements:line}));const service=createOSMService({maxBytes:bytes+2,fetcher:async()=>{calls++;return response(line);}});await service([50,5,50.01,5.01]);await service([50.02,5.02,50.03,5.03]);await service([50,5,50.01,5.01]);assert.equal(calls,3);});

test('routage deux points choisit le chemin court, snapping suit le détour du GPX',()=>{
 const roads=[{id:1,nodes:[1,2],tags:{surface:'asphalt'},geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]},{id:2,nodes:[1,3,4,2],tags:{surface:'ground'},geometry:[{lat:50,lon:5},{lat:50.003,lon:5},{lat:50.003,lon:5.01},{lat:50,lon:5.01}]}];
 const trace=[[50,5],[50.003,5],[50.003,5.01],[50,5.01]],route=routeOSM(trace,roads),matched=matchOSMDetailed(trace,roads);
 assert.ok(route.coordinates.every(p=>p[0]===50));assert.ok(matched.coordinates.some(p=>p[0]===50.003));assert.equal(route.surface.type,'Asphalte');assert.equal(matched.surface.type,'Chemin de terre');
});
test('revêtement OSM pondéré par longueur, absent si données insuffisantes',()=>{
 const trace=[[50,5],[50,5.01]],road={id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]};
 assert.equal(routeOSM(trace,[road]).surface,null);
 assert.deepEqual(routeOSM(trace,[{...road,tags:{surface:'rock'}}]).surface,{type:'Grosses pierres / blocs',coverage:100});
 const roads=[{id:1,nodes:[1,2],tags:{surface:'sand'},geometry:[{lat:50,lon:5},{lat:50,lon:5.002}]},{id:2,nodes:[2,3],geometry:[{lat:50,lon:5.002},{lat:50,lon:5.01}]}];
 assert.equal(routeOSM(trace,roads).surface,null);
});
test('progression snapping correspond aux points de contrôle réellement traités',()=>{
 const updates=[];matchOSMDetailed([[50,5.002],[50,5.018]],[...line],{onProgress:p=>updates.push(p)});
 const matched=updates.filter(p=>p.stage==='match');assert.ok(matched.length>2);assert.equal(matched[0].completed,0);assert.equal(matched.at(-1).completed,matched.at(-1).total);
 assert.ok(matched.every((p,i)=>i===0||p.completed===matched[i-1].completed+1));assert.ok(updates.some(p=>p.stage==='prepare'));assert.ok(updates.some(p=>p.stage==='index'));
});
test('le routage respecte les sens uniques vélo et leur exception explicite',()=>{
 const road={id:1,nodes:[1,2],tags:{oneway:'yes'},geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]},back=[[50,5.01],[50,5]];
 assert.throws(()=>routeOSM(back,[road]),/reliés/);
 assert.ok(routeOSM(back,[{...road,tags:{oneway:'yes','oneway:bicycle':'no'}}]).coordinates.length>1);
});
