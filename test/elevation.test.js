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

test('lissage métrique léger réduit les petites oscillations sans changer les données enregistrées ni les extrémités',async()=>{
 const {smoothElevation,elevationGain}=await import('../dist/elevation-data.js'),profile=Array.from({length:51},(_,i)=>({at:i*40,altitude:i===0||i===50?200:200+(i%2?3:-3)})),before=JSON.stringify(profile),smooth=smoothElevation(profile);assert.equal(JSON.stringify(profile),before);assert.equal(smooth[0].altitude,200);assert.equal(smooth.at(-1).altitude,200);assert.ok(Math.max(...smooth.slice(2,-2).map(p=>Math.abs(p.altitude-200)))<1);assert.ok(elevationGain(smooth).ascent<elevationGain(profile).ascent/4);
 const ramp=Array.from({length:51},(_,i)=>({at:i*40,altitude:100+i*2}));assert.equal(elevationGain(smoothElevation(ramp)).ascent,100);
});
test('modèle en cache : une mise à jour des surfaces ne reconstruit pas le graphe et un changement d’altitude le reconstruit',()=>{
 const legs=[withProfile(a,b)],first=buildElevationModel(legs);assert.equal(buildElevationModel(legs),first);legs[0]={...legs[0],analysis:{...legs[0].analysis,surfaces:[{type:'Terre',distance:1100}]}};assert.equal(buildElevationModel(legs),first);legs[0]={...legs[0],analysis:{...legs[0].analysis,elevation:{profile:[{at:0,altitude:200},{at:1111.9,altitude:300}]}}};assert.notEqual(buildElevationModel(legs),first);
});
test('SVG allégé garde les extrémités et extrema, sans réduire les données du curseur',async()=>{
 const {chartSamples}=await import('../dist/elevation.js'),profile=Array.from({length:6000},(_,i)=>({at:i*10,altitude:i===3001?900:100+Math.sin(i/100)*10})),small=chartSamples(profile,320);assert.ok(small.length<=320);assert.equal(small[0],profile[0]);assert.equal(small.at(-1),profile.at(-1));assert.ok(small.some(p=>p.altitude===900));assert.equal(profile.length,6000);
});

test('le GPX exporte les mêmes altitudes lissées que le graphe pour un ancien profil bruité',async()=>{
 const {distance}=await import('../dist/geo.js'),{planGPX}=await import('../server/plans.js'),coordinates=Array.from({length:21},(_,i)=>[50+i*.0004,5]),profile=coordinates.map((_,i)=>({at:i*distance(coordinates[0],coordinates[1]),altitude:i%2?103:97})),legs=[{mode:'route',coordinates,analysis:{elevation:{profile}}}],model=buildElevationModel(legs),xml=planGPX({name:'Ancien profil',legs,coordinates}),elevations=[...xml.matchAll(/<ele>([\d.-]+)<\/ele>/g)].map(m=>Number(m[1]));assert.equal(elevations.length,coordinates.length);assert.ok(Math.abs(elevations[10]-100)<1);assert.ok(Math.abs(elevations[10]-elevationAt(model,model.distances[10]))<.06);assert.equal(profile[10].altitude,97);
});

test('graduations d’altitude arrondies, régulières et stables avec faible évolution des extrema',async()=>{
 const {altitudeAxis}=await import('../dist/elevation.js');for(const [min,max]of [[105,395],[201,799],[-180,20],[500,500],[0,9000]]){const axis=altitudeAxis(min,max);assert.ok(axis.low<=min&&axis.high>=max);assert.ok(axis.ticks.length>=3&&axis.ticks.length<=8);assert.ok(axis.ticks.every(v=>Math.abs(v/axis.step-Math.round(v/axis.step))<1e-8));assert.ok(axis.ticks.every((v,i)=>!i||Math.abs(v-axis.ticks[i-1]-axis.step)<1e-8));}assert.deepEqual(altitudeAxis(105,395).ticks,altitudeAxis(110,390).ticks);
});
test('graphe responsive : coordonnées prévues pour la largeur réelle, axes espacés et lacunes intactes',()=>{
 const model=buildElevationModel([withProfile(a,b),{coordinates:[b,c]},withProfile(c,d,200,300)]);for(const width of [300,480,1200]){const g=chartGeometry(model,false,width);assert.equal(g.width,width);assert.equal(g.lines.length,2);assert.ok(g.distanceTicks.length>=2&&g.distanceTicks.length<=7);assert.ok(g.distanceTicks.every(at=>at>=0&&at<=model.total+.01));assert.ok(g.y(model.min)>g.y(model.max));assert.ok(g.axis.ticks.every(h=>Number.isFinite(g.y(h))));}
});
test('pentes : descente bleue, zéro blanc, montée rouge et libellés sans ambiguïté de signe',async()=>{
 const {slopeBins}=await import('../dist/elevation.js'),rgb=hex=>hex.slice(1).match(/../g).map(h=>parseInt(h,16)),blue=rgb(slopeColor(-20)),red=rgb(slopeColor(20)),zero=rgb(slopeColor(0));assert.ok(blue[2]>blue[0]*2);assert.ok(red[0]>red[2]*3);assert.ok(zero.every(v=>v>=245));assert.ok(slopeBins.filter(([low,high])=>high<=-.5).every(([,,label])=>label.includes('Descente')&&label.includes('−')));assert.ok(slopeBins.filter(([low])=>low>=.5).every(([,,label])=>label.includes('Montée')&&label.includes('+')));
});
test('cache du rendu cartographique conserve le tracé lors d’une analyse d’altitude en mode simple et invalide les surfaces modifiées',()=>{
 const legs=[withProfile(a,b)],first=routeRenderRuns(legs,'simple',buildElevationModel(legs));assert.equal(routeRenderRuns(legs,'simple',buildElevationModel(legs)),first);legs[0]={...legs[0],analysis:{...legs[0].analysis,elevation:{profile:[{at:0,altitude:200},{at:1111.9,altitude:300}]}}};assert.equal(routeRenderRuns(legs,'simple',buildElevationModel(legs)),first);legs[0]={...legs[0],analysis:{...legs[0].analysis,surfaceRuns:[{coordinates:[a,b],type:'Gravier',unpaved:true}]}};const next=routeRenderRuns(legs,'simple',buildElevationModel(legs));assert.notEqual(next,first);assert.equal(next[0].dashArray,'7 7');
});

test('dénivelé : les petites inversions ne s’accumulent plus, les vraies montées et descentes restent complètes',async()=>{
 const {elevationGain}=await import('../dist/elevation-data.js'),profile=values=>values.map((altitude,i)=>({at:i*50,altitude})),ripple=profile([100,104,101,105,102,106,103,107,104,108,105,109,106,110]);assert.deepEqual(elevationGain(ripple),{ascent:10,descent:0});assert.deepEqual(elevationGain(profile([100,102,98,101,100])),{ascent:0,descent:0});assert.deepEqual(elevationGain(profile([100,103])),{ascent:3,descent:0});
 const hills=[100,104,102,120,118,150,148,140,143,130,134,160,158,150];assert.deepEqual(elevationGain(profile(hills)),{ascent:80,descent:30});assert.deepEqual(elevationGain(profile([...hills].reverse())),{ascent:30,descent:80});
});
test('pentes lissées sur 300 m : rampe bruitée stable, sans franchir une lacune ni raccourcir la fenêtre aux extrémités',async()=>{
 const {slopeWindow}=await import('../dist/elevation.js');assert.equal(slopeWindow,300);const profile=Array.from({length:81},(_,i)=>({at:i*50,altitude:200+i*2+3*Math.sin(2*Math.PI*i/6)})),model=buildElevationModel([{coordinates:[[50,5],[50.04,5]],analysis:{elevation:{profile}}}]);
 for(let at=500;at<=3500;at+=25)assert.ok(Math.abs(slopeAt(model,at)-4)<.08,`${at}: ${slopeAt(model,at)}`);assert.equal(slopeAt(model,4200),null);assert.ok(Math.abs(slopeAt(model,0)-slopeAt(model,100))<1e-8);assert.ok(Math.abs(slopeAt(model,3900)-slopeAt(model,4000))<1e-8);
});
test('ancien profil enregistré : nouveau dénivelé calculé localement et partagé avec la bibliothèque, sans toucher aux échantillons',async()=>{
 const {planSummary}=await import('../dist/planner.js'),{planLibraryStats}=await import('../dist/plan-library.js'),profile=[100,104,101,105,102,106,103,107,104,108,105,109,106,110].map((altitude,i)=>({at:i*200,altitude})),legs=[{coordinates:[[50,5],[50.03,5]],analysis:{elevation:{ascent:850,descent:840,profile}}}],before=JSON.stringify(legs),plan={coordinates:[[50,5],[50.03,5]],legs};const model=buildElevationModel(legs);assert.equal(model.ascent,10);assert.equal(planSummary(legs).ascent,10);assert.equal(planLibraryStats(plan).ascent,10);assert.equal(JSON.stringify(legs),before);
});
