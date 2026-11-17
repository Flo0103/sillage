import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crossedSectors} from '../dist/sector-crossings.js';
// Ligne de lat0,lon0 à lat1,lon1 découpée en n segments ([latitude, longitude]).
const line=(lat0,lon0,lat1,lon1,n=20)=>Array.from({length:n+1},(_,i)=>[lat0+(lat1-lat0)*i/n,lon0+(lon1-lon0)*i/n]);
const route=line(50,5,50.05,5,100);// environ 5,6 km vers le nord
const sectors=[
 {id:'complet',coordinates:line(50.01,5,50.02,5)},
 {id:'inverse',coordinates:line(50.04,5.00005,50.03,5.00005)},// tracé dans l'autre sens, décalé de 4 m
 {id:'moitie',coordinates:line(50.045,5,50.055,5)},
 {id:'croisement',coordinates:line(50.025,4.99,50.025,5.01)},// coupe l'itinéraire à angle droit
 {id:'eloigne',coordinates:line(50.02,5.01,50.03,5.01)},
 {id:'bifurcation',coordinates:[...line(50.002,5,50.006,5,5),...line(50.006,5.0001,50.006,5.02,10).slice(1)]},
];
const summary=list=>list.map(c=>`${c.sector.id}:${c.kind}`);
test('secteurs complets, partiels, sans croisement ni secteur voisin, dans l’ordre du parcours',()=>{
 const result=crossedSectors(route,sectors);
 assert.deepEqual(summary(result),['bifurcation:partial','complet:complete','inverse:complete','moitie:partial']);
 const half=result.find(c=>c.sector.id==='moitie');assert.ok(half.ratio>.45&&half.ratio<.55);assert.ok(Math.abs(half.covered-556)<30);
 const full=result.find(c=>c.sector.id==='complet');assert.ok(Math.abs(full.from-1112)<15);assert.ok(Math.abs(full.to-2224)<15);assert.equal(full.ratio,1);
});
test('le sens de parcours de l’itinéraire ne change pas les secteurs trouvés',()=>{
 const forward=crossedSectors(route,sectors),backward=crossedSectors(route.slice().reverse(),sectors);
 assert.deepEqual(summary(backward).sort(),summary(forward).sort());
 assert.deepEqual(summary(backward),['moitie:partial','inverse:complete','complet:complete','bifurcation:partial']);
 for(const c of forward){const other=backward.find(b=>b.sector===c.sector);assert.ok(Math.abs(other.ratio-c.ratio)<.02);}
});
test('un secteur emprunté en aller-retour ou un itinéraire en boucle reste un seul résultat',()=>{
 const loop=[...line(50,5,50.03,5,30),...line(50.03,5,50,5,30).slice(1)],result=crossedSectors(loop,[sectors[0]]);
 assert.deepEqual(summary(result),['complet:complete']);
});
test('entrées invalides ou vides',()=>{
 assert.deepEqual(crossedSectors([],sectors),[]);assert.deepEqual(crossedSectors(route,[]),[]);
 assert.deepEqual(crossedSectors(route,[{id:'x'},{id:'y',coordinates:[[50,5]]},null]),[]);
});
test('un court secteur entièrement suivi est complet',()=>{
 const short={id:'court',coordinates:line(50.02,5,50.0204,5,2)};// 45 m
 assert.deepEqual(summary(crossedSectors(route,[short])),['court:complete']);
});
