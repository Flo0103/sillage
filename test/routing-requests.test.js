import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoutingRequests,isRoutingRequest} from '../dist/routing-requests.js';
import {createAdmissionController} from '../server/security.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const calls=[],gate=createAdmissionController();let active=0,peak=0;const requests=createRoutingRequests((path,data,options)=>{const release=gate.enter(path,'POST','same-user');active++;peak=Math.max(peak,active);return new Promise((resolve,reject)=>calls.push({path,data,signal:options.signal,finish(value=data){active--;release();resolve(value);},fail(error){active--;release();reject(error);}}));});return {requests,calls,peak:()=>peak};}

test('accrochages identiques partagent une seule requête pendant le calcul à froid',async()=>{
 const f=fixture(),data={point:[50.7715,6.075],tolerance:150,allowRestricted:true,accessMode:'explicit'},a=f.requests.request('/api/route/nearest',data),b=f.requests.request('/api/route/nearest',{...data});assert.equal(f.calls.length,1);f.calls[0].finish({point:data.point});assert.deepEqual(await a,await b);await tick();assert.equal(f.requests.stats.active,0);
});
test('la limite réelle du serveur reste respectée pour route, accrochage et enrichissement',async()=>{
 const f=fixture(),one=f.requests.request('/api/plan-elevations',{}),two=f.requests.request('/api/plan-metrics',{}),route=f.requests.request('/api/route',{}),nearest=f.requests.request('/api/route/nearest',{point:[50,5]});assert.deepEqual(f.calls.map(c=>c.path),['/api/plan-elevations','/api/route']);f.calls[0].finish();await tick();assert.equal(f.calls[2].path,'/api/route/nearest','le routage passe avant l’enrichissement en attente');f.calls[1].finish();await tick();assert.equal(f.calls[3].path,'/api/plan-metrics');f.calls[2].finish();f.calls[3].finish();await Promise.all([one,two,route,nearest]);assert.equal(f.peak(),2);
});
test('annuler un observateur ne prive pas un autre calcul du même point',async()=>{
 const f=fixture(),controller=new AbortController(),data={point:[50,5]},one=f.requests.request('/api/route/nearest',data,{signal:controller.signal}),two=f.requests.request('/api/route/nearest',data);controller.abort();await assert.rejects(one,e=>e.name==='AbortError');assert.equal(f.calls[0].signal.aborted,false);f.calls[0].finish({point:[50,5]});assert.deepEqual(await two,{point:[50,5]});
});
test('requêtes en vol abandonnées : les créneaux restent occupés jusqu’aux réponses du serveur',async()=>{
 const f=fixture(),a=new AbortController(),b=new AbortController(),one=f.requests.request('/api/route',{id:1},{signal:a.signal}),two=f.requests.request('/api/route',{id:2},{signal:b.signal});a.abort();b.abort();await assert.rejects(one,e=>e.name==='AbortError');await assert.rejects(two,e=>e.name==='AbortError');const three=f.requests.request('/api/route',{id:3});assert.equal(f.calls.length,2);f.calls[0].finish();await tick();assert.equal(f.calls.length,3);f.calls[1].finish();f.calls[2].finish('actuel');assert.equal(await three,'actuel');assert.equal(f.peak(),2);
});
test('annuler une requête en attente l’enlève sans contacter le serveur',async()=>{
 const f=fixture(),one=f.requests.request('/api/route',{}),two=f.requests.request('/api/route',{}),controller=new AbortController(),three=f.requests.request('/api/route',{cancelled:true},{signal:controller.signal});controller.abort();await assert.rejects(three,e=>e.name==='AbortError');f.calls[0].finish();f.calls[1].finish();await Promise.all([one,two]);await tick();assert.equal(f.calls.length,2);assert.equal(f.requests.stats.queued,0);
});
test('une erreur partagée libère la file et un nouvel essai peut recalculer le point',async()=>{
 const f=fixture(),data={point:[50,5]},one=f.requests.request('/api/route/nearest',data),two=f.requests.request('/api/route/nearest',data),both=Promise.allSettled([one,two]);f.calls[0].fail(Object.assign(Error('Source indisponible'),{status:503}));const results=await both;assert.ok(results.every(r=>r.status==='rejected'&&r.reason.status===503));await tick();const retry=f.requests.request('/api/route/nearest',data);assert.equal(f.calls.length,2);f.calls[1].finish({point:[50,5]});assert.deepEqual(await retry,{point:[50,5]});
});
test('la file ne peut pas relancer une écriture métier ; un signal déjà annulé ne contacte rien',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.requests.request('/api/route',{}, {signal:controller.signal}),e=>e.name==='AbortError');assert.equal(f.calls.length,0);assert.equal(isRoutingRequest('/api/route'),true);assert.equal(isRoutingRequest('/api/plans'),false);assert.throws(()=>f.requests.request('/api/portions',{}),/lecture seule/);
});
test('nouvel observateur après résolution : il ne rejoint pas une promesse déjà notifiée',async()=>{
 const f=fixture(),data={point:[50,5]},one=f.requests.request('/api/route/nearest',data);f.calls[0].finish({point:[50,5]});await one;const next=f.requests.request('/api/route/nearest',data);await tick();assert.equal(f.calls.length,2);f.calls[1].finish({point:[50,5]});assert.deepEqual(await next,{point:[50,5]});
});
