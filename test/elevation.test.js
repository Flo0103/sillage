import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ItineraryDraft} from '../dist/planner.js';
import {buildElevationModel,pointAtDistance,elevationAt,slopeAt,routeRenderRuns,kilometreMarkers,chartGeometry,elevationColor,slopeColor} from '../dist/elevation.js';
import {segmentColor,difficultyColors} from '../dist/catalog.js';
const a=[50,5],b=[50.01,5],c=[50.02,5],d=[50.03,5];
const withProfile=(from,to,lo=100,hi=150)=>({mode:'route',coordinates:[from,to],analysis:{elevation:{profile:[{at:0,altitude:lo},{at:1111.9,altitude:hi}]},surfaceRuns:[]}});
test('profil cumulé, interpolation géographique, altitude et pente sans relier les trous de données',()=>{
 const model=buildElevationModel([withProfile(a,b),{mode:'manual',coordinates:[b,c]},withProfile(c,d,200,220)]);assert.ok(Math.abs(model.total-3335.85)<2);assert.equal(model.spans.length,2);assert.deepEqual(pointAtDistance(model,0),a);assert.deepEqual(pointAtDistance(model,model.total),d);assert.ok(Math.abs(pointAtDistance(model,model.total/2)[0]-50.015)<1e-8);assert.ok(Math.abs(elevationAt(model,555.95)-125)<.01);assert.equal(elevationAt(model,1667),null);assert.equal(slopeAt(model,1667),null);assert.ok(slopeAt(model,555)>4&&slopeAt(model,555)<5);assert.deepEqual(pointAtDistance(model,-50),a);assert.deepEqual(pointAtDistance(model,model.total+50),d);
});
test('tracé manuel continu, pointillés dictés exclusivement par le revêtement dans les quatre modes',()=>{
 const legs=[{...withProfile(a,b),mode:'manual',analysis:{...withProfile(a,b).analysis,surfaceRuns:[{type:'Asphalte / bitume',unpaved:false,coordinates:[a,b]}]}},{...withProfile(b,c,150,200),analysis:{...withProfile(b,c,150,200).analysis,surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:[b,c]}]}}],model=buildElevationModel(legs);
 for(const mode of ['simple','surface','slope','altitude']){const runs=routeRenderRuns(legs,mode,model);assert.equal(runs[0].dashArray,null);assert.equal(runs.at(-1).dashArray,'7 7');assert.ok(runs.every(r=>/^#[0-9a-f]{6}$/i.test(r.color)));}
 const unknown=routeRenderRuns([{mode:'manual',coordinates:[a,b]}],'simple',buildElevationModel([{coordinates:[a,b]}]));assert.equal(unknown[0].dashArray,null);assert.notEqual(routeRenderRuns(legs,'surface',model)[0].color,routeRenderRuns(legs,'surface',model)[1].color);
});
test('couleurs selon altitude et pente avec indication distincte des données manquantes',()=>{
 const model=buildElevationModel([withProfile(a,b)]);assert.notEqual(elevationColor(100,model),elevationColor(150,model));assert.notEqual(slopeColor(-15),slopeColor(15));assert.equal(slopeColor(null),'#9b9b91');assert.equal(elevationColor(null,model),'#9b9b91');
});
test('bornes adaptées au zoom : aucun repère, dix, cinq ou un kilomètre, sur la géométrie réelle',()=>{
 const model=buildElevationModel([{coordinates:[a,[50.5,5]]}]);assert.equal(kilometreMarkers(model,9).length,0);assert.equal(kilometreMarkers(model,10)[0].km,10);assert.equal(kilometreMarkers(model,12)[0].km,5);assert.equal(kilometreMarkers(model,14)[0].km,1);for(const mark of kilometreMarkers(model,14)){assert.deepEqual(mark.point,pointAtDistance(model,mark.at));assert.ok(mark.at<model.total);}
});
test('graphe grand et miniature : chemins SVG finis, lacunes séparées, valeurs plates et aucune altitude inventée',()=>{
 const model=buildElevationModel([withProfile(a,b,100,100),{coordinates:[b,c]},withProfile(c,d,150,150)]);for(const compact of [true,false]){const g=chartGeometry(model,compact);assert.equal(g.lines.length,2);assert.ok(g.lines.every(p=>p.startsWith('M')&&!/NaN|Infinity/.test(p)));assert.ok(g.areas.every(p=>p.endsWith(' Z')));assert.ok(g.y(100)>g.y(150));}assert.equal(buildElevationModel([{coordinates:[a,b]}]).min,null);
});
test('effacer est une opération annulable et rétablissable avec géométrie, analyses et contexte',()=>{
 const draft=new ItineraryDraft();draft.load({legs:[withProfile(a,b)]});const original=draft.legs[0],context={id:'mon-itineraire',viewing:true};draft.context=context;draft.clear({id:null,viewing:false});assert.equal(draft.points.length,0);assert.equal(draft.undo(),true);assert.equal(draft.context,context);assert.equal(draft.legs[0],original);assert.deepEqual(draft.coordinates(),[a,b]);assert.equal(draft.redo(),true);assert.equal(draft.points.length,0);assert.equal(draft.context.id,null);
});
test('correction sans routage depuis le précédent ne remplace que la portion entrante et préserve la suivante',()=>{
 const draft=new ItineraryDraft();draft.load({legs:[withProfile(a,b),withProfile(b,c,150,200)]});const outgoing=draft.legs[1],incoming=draft.legs[0];assert.equal(draft.setIncomingMode(0,'manual'),false);assert.equal(draft.setIncomingMode(1,'manual'),true);assert.equal(draft.legs[0].mode,'manual');assert.equal(draft.legs[1],outgoing);assert.deepEqual(draft.legs[0].coordinates,[a,b]);assert.equal(draft.undo(),true);assert.equal(draft.legs[0],incoming);assert.equal(draft.redo(),true);assert.equal(draft.setIncomingMode(1,'route'),true);assert.equal(draft.legs[0].coordinates,null);assert.equal(draft.legs[1],outgoing);
});
test('palette de technicité pour les quatre difficultés et segments anciens non renseignés',()=>{
 const values=['Facile','Intermédiaire','Technique','Très technique'].map(difficulty=>segmentColor({difficulty},'difficulty'));assert.equal(new Set(values).size,4);assert.equal(values[0],difficultyColors.Facile);assert.equal(segmentColor({},'difficulty'),'#9b9b91');
});

test('insérer un point sans routage ne force pas la portion sortante à devenir manuelle',()=>{const draft=new ItineraryDraft();draft.load({legs:[withProfile(a,c)]});draft.insert(1,b,true);assert.equal(draft.legs[0].mode,'manual');assert.equal(draft.legs[1].mode,'route');assert.equal(draft.legs[1].coordinates,null);});
