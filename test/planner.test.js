import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ItineraryDraft,planSummary} from '../dist/planner.js';
import {planData,planFilename,planGPX,createPlanEnrichment} from '../server/plans.js';
import {createPlanMetrics,elevationProfile,samplePath,surfaceProfile} from '../server/plan-metrics.js';
const a=[50,5],b=[50.01,5],c=[50.02,5],d=[50.03,5];
const solve=(draft,i,path=[draft.points[i],draft.points[i+1]])=>draft.resolve(draft.legs[i].id,{coordinates:path});
function enrichmentFixture(){
 const plan={...planData({name:'Sortie convertie',coordinates:[a,b],legs:[{mode:'manual',coordinates:[a,b]}]}),id:'converted',analysisStatus:'pending',isMine:true,fromStrava:true},row={user:'alice',data:structuredClone(plan),isPublic:false,sourceStrava:true},calls=[];
 const db={async query(sql,args){calls.push({sql,args});if(!row.data||row.data.id!==args[2]||row.user!==args[3]||row.data.analysisStatus!=='pending'||JSON.stringify(row.data.legs)!==args[4]||JSON.stringify(row.data.coordinates)!==args[5])return {rowCount:0};row.data={...row.data,legs:JSON.parse(args[0]),analysisStatus:args[1]};return {rowCount:1};}};
 const analysis={elevation:{ascent:50,descent:0,profile:[{at:0,altitude:100},{at:1112,altitude:150}]},surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:[a,b]}],surfaceVersion:2,errors:[]};return {plan,row,calls,db,analysis};
}
test('conversion : analyse lancée sans attendre, puis enregistrée sans modifier trace, attributs ni confidentialité',async()=>{
 const f=enrichmentFixture();let finish,requests=0;const enrich=createPlanEnrichment({db:f.db,metrics:input=>{requests++;assert.equal(input.kind,'all');return new Promise(resolve=>{finish=()=>resolve(f.analysis);});}}),job=enrich(f.plan,'alice');assert.equal(requests,1);assert.equal(enrich(f.plan,'alice'),job);assert.equal(f.row.data.analysisStatus,'pending');
 f.row.data.name='Nom conservé';finish();await job;assert.equal(requests,1);assert.equal(f.row.data.analysisStatus,'complete');assert.deepEqual(f.row.data.coordinates,[a,b]);assert.equal(f.row.data.legs[0].mode,'manual');assert.equal(f.row.data.legs[0].analysis.elevation.ascent,50);assert.equal(f.row.data.legs[0].analysis.surfaces[0].type,'Gravier');assert.equal(f.row.data.name,'Nom conservé');assert.equal(f.row.isPublic,false);assert.equal(f.row.sourceStrava,true);assert.match(f.calls[0].sql,/user_id=\$4/);assert.match(f.calls[0].sql,/data->'coordinates'=\$6::jsonb/);
});
test('analyse de conversion : suppression ou géométrie modifiée pendant le calcul jamais écrasées',async()=>{
 for(const action of ['delete','edit','owner']){const f=enrichmentFixture();let finish;const enrich=createPlanEnrichment({db:f.db,metrics:()=>new Promise(r=>{finish=()=>r(f.analysis);})}),job=enrich(f.plan,'alice');if(action==='delete')f.row.data=null;else if(action==='owner')f.row.user='bob';else{f.row.data.coordinates=[a,c];f.row.data.legs=[{mode:'manual',coordinates:[a,c],analysis:null}];}const before=JSON.stringify(f.row);finish();await job;assert.equal(JSON.stringify(f.row),before);}
});
test('analyse de conversion : panne signalée et résultat partiel enregistré',async()=>{
 const f=enrichmentFixture(),enrich=createPlanEnrichment({db:f.db,metrics:async()=>{throw Error('Service indisponible');}});await enrich(f.plan,'alice');assert.equal(f.row.data.analysisStatus,'partial');assert.equal(f.row.data.legs[0].analysis.elevation,null);assert.match(f.row.data.legs[0].analysis.errors[0],/indisponible/);
});
test('prolonger conserve les géométries et analyses des portions précédentes, insertion et déplacement localisés',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0,[a,[50.004,5.001],b]);draft.analyse(draft.legs[0].id,{surfaces:[]});const original=draft.legs[0];draft.append(c);assert.equal(draft.legs[0],original);assert.equal(draft.legs[1].coordinates,null);solve(draft,1);draft.append(d);solve(draft,2);const last=draft.legs[2];draft.move(1,[50.011,5]);assert.equal(draft.legs[0].coordinates,null);assert.equal(draft.legs[1].coordinates,null);assert.equal(draft.legs[2],last);
 solve(draft,0);solve(draft,1);const first=draft.legs[0];draft.insert(2,[50.015,5.001]);assert.equal(draft.legs[0],first);assert.equal(draft.legs.at(-1),last);assert.equal(draft.legs.filter(l=>!l.coordinates).length,2);
});
test('corrections manuelles locales survivent au routage, annuler/rétablir et rechargement',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0);const routed=draft.legs[0];draft.append(c,'manual');draft.analyse(draft.legs[1].id,{surfaces:[]});const manual=draft.legs[1];draft.append(d);solve(draft,2);assert.equal(draft.legs[1],manual);assert.equal(draft.legs[0],routed);assert.deepEqual(draft.legs.map(l=>l.mode),['route','manual','route']);assert.equal(draft.complete(),true);assert.equal(draft.undo(),true);assert.equal(draft.points.length,3);assert.equal(draft.redo(),true);assert.equal(draft.complete(),true);
 const loaded=new ItineraryDraft();loaded.load({legs:draft.serialise()});assert.deepEqual(loaded.coordinates(),draft.coordinates());assert.equal(loaded.legs[1].mode,'manual');loaded.insert(2,[50.015,5.001],true);assert.equal(loaded.legs[1].mode,'manual');assert.equal(loaded.legs[2].mode,'manual');assert.deepEqual(loaded.legs[0].coordinates,routed.coordinates);
});
test('une réponse de calcul devenue périmée ne modifie pas un déplacement, annulation ou autre itinéraire',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);const id=draft.legs[0].id;draft.move(1,c);assert.equal(draft.resolve(id,{coordinates:[a,b]}),false);assert.deepEqual(draft.points,[a,c]);const next=draft.legs[0].id;draft.undo();assert.equal(draft.resolve(next,{coordinates:[a,c]}),false);draft.append(d,'manual');assert.equal(draft.future.length,0);
});
test('raccord au routage et accrochage du nouveau point sans réécrire une portion existante',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0);const original=draft.legs[0];draft.append(c);solve(draft,1,[[50.0101,5],[50.0201,5]]);assert.equal(draft.legs[0],original);assert.deepEqual(draft.legs[1].coordinates[0],b);assert.deepEqual(draft.points.at(-1),[50.0201,5]);assert.deepEqual(draft.coordinates(),[a,b,[50.0101,5],[50.0201,5]]);
});
test('anciens itinéraires sont découpés sans changer leur géométrie ni recalculer tout le parcours',()=>{
 const draft=new ItineraryDraft(),path=[a,[50.005,5.001],b,[50.015,5.001],c];draft.load({mode:'route',coordinates:path,routePoints:[a,b,c]});assert.deepEqual(draft.coordinates(),path);assert.equal(draft.complete(),true);draft.append(d);assert.equal(draft.legs.filter(l=>!l.coordinates).length,1);
});
test('surfaces explicites OSM, tronçons mixtes, inconnus et pointillés pour le non-bitume/non-béton',()=>{
 const path=[a,b,c,d],ways=[{tags:{highway:'track',surface:'asphalt'},geometry:[{lat:50,lon:5},{lat:50.01,lon:5}]},{tags:{highway:'track',surface:'gravel'},geometry:[{lat:50.01,lon:5},{lat:50.02,lon:5}]},{tags:{highway:'path'},geometry:[{lat:50.02,lon:5},{lat:50.03,lon:5}]}];
 const profile=surfaceProfile(path,ways);assert.equal(profile.surfaceRuns[0].unpaved,false);assert.equal(profile.surfaceRuns[1].unpaved,true);assert.equal(profile.surfaceRuns[2].unpaved,null);assert.deepEqual(profile.surfaces.map(s=>s.type),['Asphalte / bitume','Gravier','Inconnu']);assert.ok(profile.surfaces.every(s=>Math.abs(s.distance-1112)<2));
 const parallel=surfaceProfile([a,b],[{tags:{highway:'track',surface:'gravel'},geometry:[{lat:50,lon:5.01},{lat:50.01,lon:5.01}]}]);assert.equal(parallel.surfaces[0].type,'Inconnu');
 const concrete=surfaceProfile([a,b],[{tags:{highway:'track',surface:'concrete:plates'},geometry:[{lat:50,lon:5},{lat:50.01,lon:5}]}]);assert.equal(concrete.surfaceRuns[0].unpaved,false);
});
test('altitudes : échantillonnage aux deux bouts, gain/perte, bruit filtré et données manquantes distinctes de zéro',()=>{
 const samples=samplePath([a,b],100,10);assert.deepEqual(samples[0].point,a);assert.deepEqual(samples.at(-1).point,b);assert.equal(samples.length,10);assert.equal(elevationProfile(samples,Array(10).fill(200)).ascent,0);const uphill=elevationProfile(samples,samples.map((_,i)=>100+i*10));assert.equal(uphill.ascent,90);assert.equal(uphill.descent,0);const down=elevationProfile(samples,samples.map((_,i)=>200-i*10));assert.equal(down.descent,90);assert.throws(()=>elevationProfile(samples,[200]),/incomplètes/);assert.throws(()=>elevationProfile(samples,samples.map(()=>null)),/incomplètes/);assert.equal(planSummary([{coordinates:[a,b],analysis:null}]).elevationCoverage,0);
});
test('analyse de corridor OSM et altitudes en lots, cache, authentification amont, panne partielle conservée',async()=>{
 let calls=0,time=0;const seen=[];const service=createPlanMetrics({now:()=>time,wait:async ms=>{time+=ms;},fetcher:async(url,options)=>{calls++;seen.push({url:String(url),options});if(String(url).includes('overpass'))return Response.json({elements:[]});const u=new URL(url);return Response.json({elevation:u.searchParams.get('latitude').split(',').map((_,i)=>100+i)});}});
 const data=await service({coordinates:[a,c]});assert.equal(data.errors.length,0);assert.ok(data.elevation.ascent>0);assert.equal(data.surfaces[0].type,'Inconnu');assert.match(seen[0].options.body.get('data'),/way\(around:35,/);assert.match(seen[0].options.headers['User-Agent'],/Sillage/);await service({coordinates:[a,c]});assert.equal(calls,2);
 const failed=createPlanMetrics({wait:async()=>{},fetcher:async url=>String(url).includes('overpass')?Response.json({elements:[]}):Response.json({elevation:[null]})});const partial=await failed({coordinates:[a,b]});assert.equal(partial.elevation,null);assert.equal(partial.errors.length,1);assert.ok(partial.surfaces.length);
});
test('panne amont évite une requête répétée pour chaque portion pendant une minute',async()=>{
 let calls=0,time=0;const service=createPlanMetrics({now:()=>time,wait:async()=>{},fetcher:async()=>{calls++;throw Error('offline');}});await service({coordinates:[a,b]});assert.equal(calls,2);await service({coordinates:[b,c]});assert.equal(calls,2);time=60001;await service({coordinates:[c,d]});assert.equal(calls,4);
});
test('enregistrement mixte et GPX : nom obligatoire, fichier UTF-8 sans préfixe, sport et altitudes interpolées',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0);draft.append(c,'manual');draft.analyse(draft.legs[0].id,{surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[],errors:[],elevation:{ascent:100,descent:0,profile:[{at:0,altitude:100},{at:1112,altitude:200}],spacing:60}});
 const input={name:'Bois & rivière',coordinates:draft.coordinates(),legs:draft.serialise(),mode:'route',snapped:true},data=planData(input);assert.equal(data.legs[1].mode,'manual');assert.equal(data.sport,'GravelRide');const xml=planGPX(data);assert.match(xml,/<type>cycling<\/type>/);assert.match(xml,/<sillage:sport>GravelRide<\/sillage:sport>/);assert.match(xml,/<ele>100.0<\/ele>/);assert.match(xml,/<ele>200.0<\/ele>/);assert.equal((xml.match(/<trkpt /g)||[]).length,3);assert.match(planFilename(data.name),/filename\*=UTF-8''Bois%20%26%20rivi%C3%A8re.gpx/);assert.doesNotMatch(planFilename(data.name),/sillage-|itineraire-/);assert.doesNotMatch(planFilename('Test\r\n"/\\<>'),/[\r\n]/);assert.throws(()=>planData({...input,name:'  '}),/nom/);assert.throws(()=>planData({...input,coordinates:[a,d]}),/correspondent/);
});

test('altitudes regroupées entre portions, coordonnées partagées dédupliquées et cache réutilisé pour un autre découpage',async()=>{
 let calls=0;const sizes=[];const service=createPlanMetrics({wait:async()=>{},fetcher:async url=>{calls++;const u=new URL(url),n=u.searchParams.get('latitude').split(',').length;sizes.push(n);return Response.json({elevation:Array(n).fill(200)});}}),paths=Array.from({length:10},(_,i)=>[[50+i*.001,5],[50+(i+1)*.001,5]]);
 const result=await service.elevations({paths});assert.equal(result.length,10);assert.ok(result.every(r=>r.elevation&&r.error===null));assert.equal(calls,1);assert.ok(sizes[0]<30);await service.elevations({paths:[paths[0]]});assert.equal(calls,1);
});
test('une requête de revêtement bloquée ne retarde pas la réponse des altitudes',async()=>{
 let release,osmFinished=false;const service=createPlanMetrics({wait:async()=>{},fetcher:async url=>{if(String(url).includes('overpass'))return new Promise(r=>release=()=>{osmFinished=true;r(Response.json({elements:[]}));});const n=new URL(url).searchParams.get('latitude').split(',').length;return Response.json({elevation:Array(n).fill(100)});}});
 const surface=service({coordinates:[a,b],kind:'surface'});await new Promise(r=>setImmediate(r));assert.ok(release);const elevated=await service.elevations({paths:[[a,b]]});assert.ok(elevated[0].elevation);assert.equal(osmFinished,false);release();await surface;
});
test('budget des profils longs : 4096 échantillons au maximum et lots API de 100 coordonnées',async()=>{
 const sizes=[],service=createPlanMetrics({wait:async()=>{},fetcher:async url=>{const n=new URL(url).searchParams.get('latitude').split(',').length;sizes.push(n);return Response.json({elevation:Array(n).fill(200)});}}),paths=Array.from({length:199},(_,i)=>[[i*.02,5],[(i+1)*.02,5]]),result=await service.elevations({paths});assert.ok(result.every(r=>r.elevation));assert.ok(result.reduce((n,r)=>n+r.elevation.profile.length,0)<=4096);assert.ok(sizes.every(n=>n<=100));assert.ok(sizes.length<=41);
});


test('bibliothèque : recherche sans accents, seuils inclusifs et dénivelé estimé en cache sans calcul externe',async()=>{
 const {filterPlans,planLibraryStats}=await import('../dist/plan-library.js');const make=(id,name,distance,ascent,isMine=true)=>({id,name,owner:isMine?'Alice':'Bob',notes:'Départ à Spa',isMine,distance,coordinates:[[50,5],[50.01,5]],legs:ascent===null?[]:[{coordinates:[[50,5],[50.01,5]],analysis:{elevation:{profile:[{at:0,altitude:100},{at:1111.9,altitude:100+ascent}]}}}]});
 const plans=[make('a','Crêtes des Fagnes',20000,500),make('b','Tour des bois',40000,900,false),make('c','Sans altitude',20000,null)];const ids=opts=>filterPlans(plans,opts).map(p=>p.id);
 assert.deepEqual(ids({search:'cretes ALICE spa'}),['a']);assert.deepEqual(ids({distanceMin:20,distanceMax:20,ascentMin:500,ascentMax:500}),['a']);assert.deepEqual(ids({scope:'others',ascentMin:500}),['b']);assert.deepEqual(ids({distanceMin:40,distanceMax:20}),[]);assert.deepEqual(ids({ascentMax:0}),[]);assert.equal(planLibraryStats(plans[2]).ascent,null);assert.equal(planLibraryStats(plans[0]),planLibraryStats(plans[0]));assert.deepEqual(ids({search:'',distanceMin:'',distanceMax:'',ascentMin:'',ascentMax:''}),['a','b','c']);
});
test('bibliothèque : filtre sur les extrémités réelles, départ et/ou arrivée, sans confondre traversée et extrémité',async()=>{
 const {filterPlans}=await import('../dist/plan-library.js');const plans=[{id:'start',coordinates:[[50,5],[51,5]]},{id:'end',coordinates:[[49,5],[50,5]]},{id:'both',coordinates:[[50,5],[50.1,5]]},{id:'cross',coordinates:[[49,5],[50,5],[51,5]]}].map(p=>({...p,legs:[],distance:1000})),bounds={contains:p=>p[0]>=50&&p[0]<=50.1},ids=mapFilter=>filterPlans(plans,{mapFilter,bounds}).map(p=>p.id);
 assert.deepEqual(ids('start'),['start','both']);assert.deepEqual(ids('end'),['end','both']);assert.deepEqual(ids('either'),['start','end','both']);assert.deepEqual(ids('both'),['both']);assert.deepEqual(ids('all'),['start','end','both','cross']);assert.deepEqual(filterPlans(plans,{mapFilter:'start',bounds:null}),[]);
});

test('part non asphaltée calculée sur les géométries et distinguée des surfaces inconnues',()=>{
 const a=[50,5],b=[50.01,5],c=[50.02,5],d=[50.03,5],summary=planSummary([{coordinates:[a,b,c,d],analysis:{surfaceRuns:[{coordinates:[a,b],unpaved:true},{coordinates:[b,c],unpaved:false},{coordinates:[c,d],unpaved:null}]}}]);assert.ok(Math.abs(summary.unpaved/summary.total-1/3)<.001);assert.ok(Math.abs(summary.unpavedKnown/summary.total-2/3)<.001);assert.equal(planSummary([{coordinates:[a,b]}]).unpavedKnown,0);
});

test('surface inconnue en cache : actualiser interroge OSM à nouveau sans déplacer les coordonnées',async()=>{
 let calls=0,known=false,time=0;const way={tags:{highway:'track',surface:'gravel'},geometry:[{lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]}]},service=createPlanMetrics({now:()=>time,wait:async ms=>{time+=ms;},fetcher:async()=>{calls++;return Response.json({elements:known?[way]:[]});}}),first=await service({coordinates:[a,b],kind:'surface'});
 assert.equal(first.surfaces[0].type,'Inconnu');await service({coordinates:[a,b],kind:'surface'});assert.equal(calls,1);known=true;const refreshed=await service({coordinates:[a,b],kind:'surface',retry:true});assert.equal(calls,2);assert.equal(refreshed.surfaces[0].type,'Gravier');await service({coordinates:[a,b],kind:'surface'});assert.equal(calls,2);
});
test('cache des surfaces inconnues expire rapidement, les données complètes gardent leur cache long',async()=>{
 let calls=0,known=false,time=0;const way={tags:{highway:'track',surface:'asphalt'},geometry:[{lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]}]},service=createPlanMetrics({now:()=>time,wait:async()=>{},fetcher:async()=>{calls++;return Response.json({elements:known?[way]:[]});}});
 await service({coordinates:[a,b],kind:'surface'});known=true;time=59000;await service({coordinates:[a,b],kind:'surface'});assert.equal(calls,1);time=61000;const result=await service({coordinates:[a,b],kind:'surface'});assert.equal(calls,2);assert.equal(result.surfaces[0].type,'Asphalte / bitume');time=300000;await service({coordinates:[a,b],kind:'surface'});assert.equal(calls,2);
});

test('synthèse des surfaces : une nouvelle analyse et annuler un déplacement conservent les bonnes statistiques',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0);draft.append(c);solve(draft,1);const first=draft.legs[0].id,last=draft.legs[1].id;
 draft.analyse(first,{surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[{coordinates:[a,b],unpaved:true}]});draft.analyse(last,{surfaces:[{type:'Inconnu',distance:1112}],surfaceRuns:[{coordinates:[b,c],unpaved:null}]});const initial=planSummary(draft.legs);assert.ok(initial.unpaved>1100&&initial.unpaved<1120);
 draft.analyse(last,{surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[{coordinates:[b,c],unpaved:true}]});const complete=planSummary(draft.legs);assert.ok(complete.unpaved>2200);assert.equal(complete.surfaceCoverage,100);draft.move(1,[50.011,5]);assert.equal(planSummary(draft.legs).unpavedKnown,0);draft.undo();assert.deepEqual(planSummary(draft.legs),complete);
});

test('inverser : échange les extrémités, recalcule les portions routées et inverse les corrections manuelles et leur profil',()=>{
 const draft=new ItineraryDraft();draft.append(a);draft.append(b);solve(draft,0);draft.append(c,'manual');const length=planSummary([draft.legs[1]]).total;draft.analyse(draft.legs[1].id,{surfaces:[{type:'Terre',distance:length}],surfaceRuns:[{type:'Terre',unpaved:true,coordinates:[b,c]}],accessRuns:[{label:'Privé',coordinates:[b,c]}],elevation:{ascent:100,descent:0,profile:[{at:0,altitude:100},{at:length,altitude:200}]}});const original=draft.snapshot();assert.equal(draft.reverse(),true);assert.deepEqual(draft.points,[c,b,a]);assert.deepEqual(draft.legs.map(l=>l.mode),['manual','route']);assert.equal(draft.legs[1].coordinates,null);assert.deepEqual(draft.legs[0].coordinates,[c,b]);assert.deepEqual(draft.legs[0].analysis.surfaceRuns[0].coordinates,[c,b]);assert.deepEqual(draft.legs[0].analysis.elevation.profile.map(p=>p.altitude),[200,100]);assert.equal(planSummary([draft.legs[0]]).descent,100);assert.equal(draft.complete(),false);draft.undo();assert.deepEqual(draft.snapshot(),original);draft.redo();assert.deepEqual(draft.points,[c,b,a]);
});
test('conversion sortie : découpage borné, aucune perte de point et aucune déclaration d’accrochage OSM',async()=>{
 const {importedRideLegs}=await import('../dist/planner.js'),points=Array.from({length:10000},(_,i)=>[50+i*.0002,5+Math.sin(i/100)*.001]),legs=importedRideLegs(points);assert.ok(legs.length<=199);assert.ok(legs.length>1);assert.ok(legs.every(l=>l.mode==='manual'));assert.deepEqual(legs.flatMap((l,i)=>i?l.coordinates.slice(1):l.coordinates),points);const data=planData({name:'Sortie importée',coordinates:points,legs});assert.equal(data.snapped,false);assert.equal(data.mode,'manual');
});
