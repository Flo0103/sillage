import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planData,planGPX} from '../server/plans.js';
import {portion,hashPassword,verifyPassword,coordinates} from '../server/model.js';
import {matchOSM,shortest,routeLength} from '../dist/geo.js';
const input={coordinates:[[50,5],[50.001,5]],rating:4,surface:'Grosses pierres / blocs',difficulty:'Technique',winter:'conditions',name:'   '};
test('nom facultatif, grosses pierres et hiver conservés',()=>{const p=portion(input);assert.match(p.name,/^Secteur de 0,11 km$/);assert.equal(p.winter,'conditions');assert.equal(p.surface,input.surface);assert.equal(portion({...input,name:'  Chemin des pins  '}).name,'Chemin des pins');});
test('validation des données du serveur',()=>{for(const rating of [0,6,2.5,'5'])assert.throws(()=>portion({...input,rating}));assert.throws(()=>coordinates([[91,5],[50,5]]));assert.throws(()=>portion({...input,winter:'maybe'}));assert.throws(()=>portion({...input,surface:'inconnue'}));});
test('mots de passe salés et vérification',async()=>{const p='Une phrase assez longue !';const a=await hashPassword(p),b=await hashPassword(p);assert.notEqual(a,b);assert.equal(await verifyPassword(p,a),true);assert.equal(await verifyPassword('autre',a),false);});
test('plus court chemin et composante déconnectée',()=>{const graph=new Map([[1,[[2,5],[3,1]]],[3,[[2,1]]],[2,[]],[4,[]]]);assert.deepEqual(shortest(graph,1,2),[1,3,2]);assert.throws(()=>shortest(graph,1,4));});
test('accrochage sur un long segment OSM sans nœud au milieu',()=>{const original=[[50,5.002],[50,5.004],[50,5.006],[50,5.008]];const result=matchOSM(original,[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]}]);assert.ok(result.length>2);assert.ok(Math.abs(routeLength(result)-routeLength(original))<80);assert.ok(result.every(p=>p[0]===50));});
test('ne raccorde pas artificiellement deux chemins déconnectés',()=>{assert.throws(()=>matchOSM([[50,5],[50,5.01]],[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.001}]},{id:2,nodes:[3,4],geometry:[{lat:50,lon:5.009},{lat:50,lon:5.01}]}]),/éloignée|reliés/);});

test('routage conserve ses points de passage et refuse des points non valides ou trop nombreux',()=>{
 const routePoints=[[50,5],[50.0005,5.0005],[50.001,5]],p=portion({...input,mode:'route',routePoints});assert.deepEqual(p.routePoints,routePoints);
 assert.deepEqual(portion({...input,mode:'route'}).routePoints,[input.coordinates[0],input.coordinates[1]]);
 assert.throws(()=>portion({...input,mode:'route',routePoints:[[500,5],[50,5]]}));assert.throws(()=>portion({...input,mode:'route',routePoints:Array.from({length:201},(_,i)=>[50+i*.001,5])}));
});

test('modèle d’itinéraire : limites, nom obligatoire et GPX échappé',()=>{
 const p=planData({mode:'manual',coordinates:[[50,5],[50.02,5]],name:'  Tour & bois  ',notes:'<pause> & eau'});assert.equal(p.name,'Tour & bois');assert.ok(p.distance>2000);assert.equal(p.mode,'manual');assert.match(planGPX(p),/<name>Tour &amp; bois<\/name>/);assert.match(planGPX(p),/<desc>&lt;pause&gt; &amp; eau<\/desc>/);assert.match(planGPX(p),/lat="50.02" lon="5"/);
 assert.throws(()=>planData({mode:'manual',coordinates:[[50,5],[50.01,5]]}),/nom/);assert.throws(()=>planData({coordinates:[[0,0],[10,10]],mode:'manual'}),/500 km/);assert.throws(()=>planData({coordinates:[[50,5],[50,5]],mode:'manual'}),/distincts/);
});

test('segment avec corrections locales : validation et conservation des portions, incohérences rejetées',()=>{
 const a=[50,5],b=[50.01,5],c=[50.02,5],body={coordinates:[a,b,c],mode:'route',snapped:true,rating:4,surface:'Gravier fin',difficulty:'Facile',legs:[{mode:'route',coordinates:[a,b]},{mode:'manual',coordinates:[b,c]}]},p=portion(body);assert.deepEqual(p.routePoints,[a,b,c]);assert.deepEqual(p.legs.map(l=>l.mode),['route','manual']);assert.throws(()=>portion({...body,legs:[{mode:'unknown',coordinates:[a,b,c]}]}),/Mode/);assert.throws(()=>portion({...body,legs:[{mode:'route',coordinates:[a,b]}]}),/correspondent/);assert.throws(()=>portion({...body,legs:[{mode:'route',coordinates:[a,b]},{mode:'manual',coordinates:[a,c]}]}),/rejoindre/);assert.equal(portion({...body,legs:null}).legs,undefined);
});
