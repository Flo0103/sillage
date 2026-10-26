import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds} from '../dist/geo.js';
import {smoothElevation,elevationGain} from '../dist/elevation-data.js';
import * as Elevation from '../dist/elevation.js';
import {filterPlans,planLibraryStats} from '../dist/plan-library.js';
import {ItineraryDraft,planSummary} from '../dist/planner.js';
import {insertionIndex} from '../dist/route-edit.js';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,difficultyColors,escapeHTML} from '../dist/catalog.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const previewScript=(await readFile(new URL('../dist/preview.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const elevationScript=(await readFile(new URL('../dist/elevation.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const script=previewScript+'\n'+elevationScript+'\n'+(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
function element(){const classes=new Set();return {style:{setProperty(){}},value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,children:[],classList:{toggle(c,value){const next=value??!classes.has(c);if(next)classes.add(c);else classes.delete(c);return next;},contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},attributes:{},setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},append(...children){this.children.push(...children);},insertBefore(child,before){const at=this.children.indexOf(before);if(at<0)this.children.push(child);else this.children.splice(at,0,child);},replaceChildren(){this.children=[];},reset(){},remove(){},click(){}};}
function context({optionalMissing=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
 for(const tag of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g))if(/\btype="checkbox"/.test(tag[0]))elements.get(tag[1]).checked=/\bchecked\b/.test(tag[0]);
 if(optionalMissing)for(const id of ['source','modeControls','legacyImport'])elements.delete(id);
 const points=[[50,5],[50.001,5]],ride={id:'00000000-0000-0000-0000-000000000001',name:'Ma sortie',coordinates:points,distance:111};
 const calls=[],timers=new Map();let timerId=0;
 const document={body:element(),addEventListener(){},getElementById:id=>elements.get(id)||null,createElement:()=>element(),createTextNode:text=>({textContent:text}),querySelector:()=>null};
 const fetch=async(path,options={})=>{calls.push({path,options});const data=path==='/api/plan-elevations'?JSON.parse(options.body).paths.map(()=>({elevation:null,error:'Altitudes indisponibles.'})):path==='/api/route/nearest'?{point:JSON.parse(options.body).point}:path==='/api/me'?{username:'alice'}:['/api/portions','/api/catalog','/api/wms','/api/plans','/api/rides/overlay'].includes(path)?[]:path==='/api/rides'?options.method==='POST'?{id:ride.id}:[ride]:ride;return {ok:true,status:200,json:async()=>data};};
 const xml={querySelector:()=>null,getElementsByTagNameNS:(ns,tag)=>tag==='trkpt'?points.map(p=>({hasAttribute:()=>true,getAttribute:n=>n==='lat'?String(p[0]):String(p[1])})):[]};
 const ctx={filterPlans,planLibraryStats,...Elevation,smoothElevation,elevationGain,document,fetch,ItineraryDraft,planSummary,insertionIndex,distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds,visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,difficultyColors,escapeHTML,location:{replace(){}},localStorage:{getItem:()=>null},AbortController,console,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),innerWidth:1200,Blob,URL,URLSearchParams,confirm:()=>true,DOMParser:class{parseFromString(){return xml;}}};
 return {elements,calls,ctx,flushTimers(max=350){for(const[id,t]of [...timers])if(t.delay<=max){timers.delete(id);t.fn();}}};
}
test('choix d’une sortie sauvegardée sans dépendre des contrôles facultatifs',async()=>{
 const {elements,ctx}=context({optionalMissing:true});
 await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');return {trace:trace.length,current:currentRide?.name};})()`,ctx).then(result=>{assert.equal(result.trace,2);assert.equal(result.current,'Ma sortie');});
 assert.equal(elements.get('mapSubtitle').textContent,'Ma sortie');assert.equal(elements.get('rideList').children.length,4);assert.equal(elements.get('rideList').children[2].textContent,'Ma sortie');assert.equal(elements.get('rideList').hidden,false);
});
test('import GPX conserve le fichier original et réaffiche la sortie sans erreur hidden',async()=>{
 const {elements,calls,ctx}=context({optionalMissing:true});await vm.runInNewContext(`(async()=>{${script}})()`,ctx);
 const original='<gpx><trk/></gpx>',target={files:[{name:'mon.gpx',size:original.length,text:async()=>original}],value:'mon.gpx'};
 await elements.get('gpx').onchange({target});
 const uploaded=calls.find(c=>c.path==='/api/rides'&&c.options.method==='POST');assert.ok(uploaded);assert.equal(JSON.parse(uploaded.options.body).gpx,original);assert.equal(JSON.parse(uploaded.options.body).fileName,'mon.gpx');
 assert.equal(target.value,'');assert.match(elements.get('toast').textContent,/enregistrée/);assert.doesNotMatch(elements.get('toast').textContent,/hidden|null/);
});
test('erreurs OSM signalées sans rafale de notifications et carte redimensionnée',async()=>{
 const {ctx,elements}=context();elements.get('mapNotice').hidden=true;const tiles=[],active=new Set(),events={};let resized=0;
 const map={setView(){return this;},createPane(){return {style:{}};},getPane(){return {style:{}};},on(name,fn){events[name]=fn;return this;},hasLayer(layer){return active.has(layer);},invalidateSize(){resized++;},fitBounds(){}};
 const layer=()=>({events:{},on(name,fn){this.events[name]=fn;return this;},addTo(target){if(target===map)active.add(this);return this;},clearLayers(){},bindTooltip(){return this;}});
 const makeTile=(url,options)=>{const item=layer();item.url=url;item.options=options;tiles.push(item);return item;};makeTile.wms=makeTile;
 ctx.L={map:()=>map,tileLayer:makeTile,layerGroup:layer,polyline:layer,latLngBounds:p=>p,control:{layers:()=>({addTo(){return this;},addBaseLayer(){}}),zoom:()=>({addTo(){}})}};
 ctx.ResizeObserver=class{constructor(fn){this.fn=fn;}observe(){this.fn();}};
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);
 const osm=tiles[0];assert.equal(osm.url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.equal(osm.options.referrerPolicy,'strict-origin-when-cross-origin');assert.ok(resized>0);assert.equal(tiles[2].url,'https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png');assert.equal(tiles[2].options.maxNativeZoom,17);assert.equal(tiles[2].options.minNativeZoom,7);assert.equal(tiles[3].url,'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png');assert.equal(tiles[3].options.referrerPolicy,'strict-origin-when-cross-origin');
 osm.events.loading();osm.events.tileerror();osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,true);osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,false);assert.match(elements.get('mapNotice').textContent,/tuiles OSM/);assert.equal(elements.get('toast').textContent,'');
 active.delete(osm);events.baselayerchange();assert.equal(elements.get('mapNotice').hidden,true);osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,true);
 const ign=tiles[2];active.add(ign);ign.events.loading();ign.events.tileerror();assert.equal(elements.get('mapNotice').hidden,false);assert.match(elements.get('mapNotice').textContent,/IGN/);ign.events.load();assert.equal(elements.get('mapNotice').hidden,false);ign.events.loading();ign.events.load();assert.equal(elements.get('mapNotice').hidden,true);
});

test('la carte initiale ne charge pas automatiquement le dernier GPX',async()=>{const {calls,ctx}=context();const result=await vm.runInNewContext(`(async()=>{${script}\nreturn {view,trace:trace.length,current:currentRide};})()`,ctx);assert.equal(result.view,'saved');assert.equal(result.trace,0);assert.equal(result.current,null);assert.equal(calls.some(c=>/^\/api\/rides\//.test(c.path)),false);});
test('catalogue initial, filtres personnel/public/hiver et légende sans GPX',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;const items=[{id:'a',name:'Personnel',rating:5,surface:'Gravier fin',winter:'yes',distance:100,coordinates:[[50,5],[50.001,5]],owner:'alice',isMine:true,isPublic:false},{id:'b',name:'Public',rating:3,surface:'Sable',winter:'no',distance:100,coordinates:[[50,5.01],[50.001,5.01]],owner:'bob',isMine:false,isPublic:true}];
 ctx.fetch=async(path,options)=>path==='/api/catalog'?{ok:true,status:200,json:async()=>items}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);elements.get('planScope').value='all';elements.get('planScope').onchange();assert.equal(elements.get('editorPanel').hidden,true);assert.equal(elements.get('gpxLegend').hidden,true);assert.equal(elements.get('segmentLegend').hidden,false);assert.equal(elements.get('savedList').children.length,1);assert.equal(elements.get('segmentSelect').children.length,2);
 elements.get('showMine').checked=false;elements.get('showMine').onchange();assert.equal(elements.get('savedList').children.length,1);
 elements.get('winterFilter').value='yes';elements.get('winterFilter').onchange();assert.equal(elements.get('savedList').children.length,0);assert.equal(elements.get('segmentSelect').children[0].textContent,'Aucun secteur avec ces filtres');
 elements.get('colorMode').value='surface';elements.get('colorMode').onchange();assert.equal(elements.get('legendContent').children[0].textContent,'Secteurs · Revêtement');
});
test('changer la tolérance réutilise les données OSM déjà chargées dans la page',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;ctx.fetch=async(path,options)=>{if(path==='/api/osm'){calls.push({path,options});return {ok:true,status:200,json:async()=>({bbox:[49.99,4.99,50.02,5.03],elements:[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.02}]}]})};}return base(path,options);};
 const result=await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');mode='snap';gpsSelection=[[50,5.001],[50,5.01]];await snap();$('snapTolerance').value='250';await snap();return {snapped,points:selected.length};})()`,ctx);assert.equal(result.snapped,true);assert.ok(result.points>1);assert.equal(calls.filter(c=>c.path==='/api/osm').length,1);
});

test('plein écran de secours et sortie conservent un contrôle utilisable',async()=>{const {ctx,elements}=context();await vm.runInNewContext(`(async()=>{${script}})()`,ctx);await elements.get('fullscreenMap').onclick();assert.equal(ctx.document.body.classList.contains('map-expanded'),true);assert.equal(elements.get('fullscreenMap').classList.contains('is-expanded'),true);await elements.get('fullscreenMap').onclick();assert.equal(ctx.document.body.classList.contains('map-expanded'),false);});

test('clic propriétaire ouvre tous les attributs et soumission PATCH sans nouvelle portion',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,r={id:'00000000-0000-0000-0000-000000000123',isMine:true,isPublic:true,name:'Sentier du bois',rating:4,surface:'Chemin de terre',difficulty:'Technique',winter:'conditions',singleTrack:'yes',notes:'Racines',snapped:true,mode:'route',coordinates:[[50,5],[50.001,5]]};
 const result=await vm.runInNewContext(`(async()=>{${script}\nshowSegment(${JSON.stringify(r)});return {view,editing:editingSegment.id,points:selected.length};})()`,ctx);
 assert.equal(result.view,'explore');assert.equal(result.editing,r.id);assert.equal(result.points,2);assert.equal(elements.get('editorTitle').textContent,'Modifier le secteur');assert.equal(elements.get('name').value,r.name);assert.equal(elements.get('singleTrack').value,'yes');assert.equal(elements.get('winter').value,'conditions');assert.equal(elements.get('save').disabled,false);
 elements.get('name').value='Sentier corrigé';await elements.get('ratingForm').onsubmit({preventDefault(){}});
 const patch=calls.find(c=>c.options.method==='PATCH');assert.equal(patch.path,'/api/portions/'+r.id);assert.equal(JSON.parse(patch.options.body).name,'Sentier corrigé');assert.equal(JSON.parse(patch.options.body).singleTrack,'yes');assert.ok(!calls.some(c=>c.path==='/api/portions'&&c.options.method==='POST'));
});
test('segments et légende restent visibles lors de la création sans recentrage au filtrage',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,items=[{id:'a',name:'Existant',rating:4,surface:'Gravier fin',winter:'yes',singleTrack:'yes',owner:'alice',isMine:true,isPublic:true,coordinates:[[50,5],[50.001,5]]}];
 ctx.fetch=async(path,options)=>path==='/api/catalog'?{ok:true,status:200,json:async()=>items}:base(path,options);
 const events={},drawn=[];let fits=0;const map={setView(){return this;},createPane(){},getPane(){return {style:{}};},on(n,fn){events[n]=fn;return this;},invalidateSize(){},fitBounds(){fits++;},hasLayer(){return false;}};
 const layer=()=>({on(){return this;},addTo(){return this;},clearLayers(){},bindTooltip(){return this;}}),tile=()=>layer();tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:layer,polyline:(coordinates,options)=>{drawn.push({coordinates,options});return layer();},latLngBounds:p=>p,control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);const before=drawn.length;elements.get('drawSegment').onclick();assert.ok(drawn.length>before);assert.equal(drawn.at(-1).options.interactive,true);assert.equal(elements.get('segmentLegend').hidden,false);assert.equal(elements.get('catalogFilters').hidden,false);
 const count=fits;elements.get('showMine').checked=false;elements.get('showMine').onchange();assert.equal(fits,count);assert.equal(elements.get('segmentCount').textContent,'0 secteur(s) affiché(s)');
});
test('snapping Worker publie une progression réelle et un résultat tardif annulé ne modifie pas la sélection',async()=>{
 const {ctx,elements}=context(),workers=[];ctx.Worker=class{constructor(url){this.url=url;workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}};
 await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');mode='snap';gpsSelection=[[50,5],[50,5.01]];osmSnapshot={time:Date.now(),data:{bbox:[49,4,51,6],elements:[]}};globalThis.running=snap();})()`,ctx);
 const worker=workers[0];assert.ok(worker.url.includes('osm-worker.js'));assert.equal(worker.data.mode,'snap');worker.onmessage({data:{progress:{stage:'match',completed:2,total:4}}});assert.equal(elements.get('osmProgress').value,50);assert.match(elements.get('progressCaption').textContent,/50 %/);
 elements.get('cancelSnap').onclick();await ctx.running;assert.equal(worker.terminated,true);assert.equal(elements.get('snapProgress').hidden,true);worker.onmessage({data:{result:{coordinates:[[0,0],[1,1]]}}});assert.equal(elements.get('snapState').textContent,'GPS d’origine');
});
test('suggestion OSM préremplit le revêtement mais respecte une correction manuelle',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;ctx.fetch=async(path,options)=>path==='/api/osm'?{ok:true,status:200,json:async()=>({bbox:[49.9,4.9,50.1,5.1],elements:[{id:1,nodes:[1,2],tags:{surface:'sand'},geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]}]})}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');mode='snap';gpsSelection=[[50,5],[50,5.01]];await snap();})()`,ctx);assert.equal(elements.get('surface').value,'Sable');assert.match(elements.get('surfaceSource').textContent,/100 %/);
 elements.get('surface').value='Chemin de terre';elements.get('surface').onchange();await elements.get('snap').onclick();assert.equal(elements.get('surface').value,'Chemin de terre');assert.match(elements.get('surfaceSource').textContent,/choix est conservé/);
});

test('Mon compte propose OAuth Strava officiel selon la configuration et la connexion',async()=>{
 const accountHTML=await readFile(new URL('../dist/account.html',import.meta.url),'utf8'),accountScript=(await readFile(new URL('../dist/account.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
 assert.match(accountHTML,/id="accountConnectStrava"[^>]*href="\/api\/strava\/connect"/);assert.doesNotMatch(accountHTML,/type="password"[^>]*strava/i);
 for(const state of [{configured:false,connected:false},{configured:true,connected:false},{configured:true,connected:true}]){
  const elements=new Map([...accountHTML.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()])),ctx={$:id=>elements.get(id),api:async path=>path==='/api/me'?{username:'alice'}:path==='/api/wms'?[]:state,post:async()=>{},message(){},button(){}};
  await vm.runInNewContext(`(async()=>{${accountScript}})()`,ctx);
  assert.equal(elements.get('accountConnectStrava').hidden,!state.configured||state.connected);assert.equal(elements.get('accountStravaActivities').hidden,!state.configured||!state.connected);assert.equal(elements.get('accountDisconnectStrava').hidden,!state.connected);
 }
});

test('routage vélo appelle le nouvel endpoint et conserve les points exacts à chaque changement de mode',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;
 ctx.fetch=async(path,options)=>{if(path==='/api/route'){calls.push({path,options});return {ok:true,status:200,json:async()=>({coordinates:[[50,5.0001],[50,5.005],[50,5.0099]],stats:{maxOffset:8,ignoredAnchors:0},engine:'OSRM vélo / FOSSGIS'})};}if(path==='/api/osm')return {ok:false,status:503,json:async()=>({error:'Indisponible'})};return base(path,options);};
 const result=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');segmentDraftActive=false;trace=[[50,5],[50,5.005],[50,5.01]];endpoints=[[50,5],[50,5.01]];gpsSelection=endpoints.map(p=>[...p]);await snap();const routed=JSON.stringify(selected);setMode('manual');const manual=JSON.stringify(selected);setMode('route');const restored=JSON.stringify(selected);setMode('snap');cancelSnap();const preserved=JSON.stringify(endpoints);setMode('manual');return {routed,manual,restored,preserved,manualAgain:JSON.stringify(selected)};})()`,ctx);
 assert.equal(result.preserved,JSON.stringify([[50,5.0001],[50,5.0099]]));assert.equal(result.manual,result.preserved);assert.equal(result.manualAgain,result.manual);assert.equal(result.restored,result.routed);
 const route=calls.find(c=>c.path==='/api/route');assert.deepEqual(JSON.parse(route.options.body).points,[[50,5],[50,5.01]]);assert.equal(calls.filter(c=>c.path==='/api/route').length,1);
});
test('un départ seul survit aux changements de mode, absence de GPX ne détruit pas les points',async()=>{
 const {ctx}=context();const r=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');choose({lat:50,lng:5});setMode('manual');setMode('route');setMode('snap');return {mode,selected:JSON.stringify(selected),endpoints:JSON.stringify(endpoints),message:$('toast').textContent};})()`,ctx);
 assert.equal(r.endpoints,'[[50,5]]');assert.equal(r.selected,'[[50,5]]');
});
test('aperçu de sortie : une réponse ancienne ne remplace pas le choix plus récent',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;let a,b;
 ctx.fetch=async(path,options)=>{if(path==='/api/rides/a')return new Promise(r=>a=r);if(path==='/api/rides/b')return new Promise(r=>b=r);return base(path,options);};
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);elements.get('rideSelect').value='a';const first=elements.get('rideSelect').onchange();elements.get('rideSelect').value='b';const second=elements.get('rideSelect').onchange();
 const answer=name=>({ok:true,status:200,json:async()=>({id:name,name,coordinates:[[50,5],[50.001,5]],distance:111})});b(answer('b'));await second;a(answer('a'));await first;assert.equal(elements.get('rideList').children[2].textContent,'b');assert.equal(elements.get('downloadRide').href,'/api/rides/b/gpx');
});
test('choix Strava et aperçu dans le panneau, ouverture directe puis nouveau segment indépendant sans copie',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,ride={id:'00000000-0000-0000-0000-000000000001',name:'Gravel Spa',distance:1000,source_type:'strava',coordinates:[[50,5],[50.001,5]]};
 ctx.fetch=async(path,options={})=>{calls.push({path,options});const data=path==='/api/strava/status'?{configured:true,connected:true}:path.startsWith('/api/strava/activities')?{page:1,hasMore:true,activities:[{id:'101',name:'Gravel Spa',distance:1000,startDate:'2026-10-22',sportType:'GravelRide',preview:ride.coordinates}]}:path==='/api/strava/import'?{id:ride.id}:path==='/api/rides'?[ride]:path==='/api/rides/'+ride.id?ride:null;if(data)return {ok:true,status:200,json:async()=>data};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');return {state:()=>({trace:trace.length,selected:selected.length,currentRide})};})()`,ctx);
 elements.get('rideSource').value='strava';await elements.get('rideSource').onchange();assert.equal(elements.get('stravaPicker').hidden,false);assert.equal(elements.get('stravaRideSelect').children.length,2);
 elements.get('stravaRideSelect').value='101';elements.get('stravaRideSelect').onchange();assert.equal(elements.get('stravaRidePreview').children[2].textContent,'Gravel Spa');assert.equal(elements.get('openStravaRide').disabled,false);
 await elements.get('openStravaRide').onclick();assert.equal(access.state().currentRide.source_type,'strava');assert.equal(elements.get('publicSegment').disabled,true);assert.equal(elements.get('rideSource').value,'saved');assert.ok(calls.some(c=>c.path==='/api/strava/import'&&JSON.parse(c.options.body).activityId==='101'));
 elements.get('independentSegment').onclick();assert.equal(access.state().trace,2);assert.equal(access.state().selected,0);assert.equal(access.state().currentRide.source_type,'strava');assert.equal(elements.get('publicSegment').disabled,false);assert.doesNotMatch(html,/id="legacyImport"/);
});

test('chargement de sortie : réponse tardive ignorée après choix plus récent ou retour au catalogue',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;let a,b,c;
 ctx.fetch=async(path,options)=>path==='/api/rides/a'?new Promise(r=>a=r):path==='/api/rides/b'?new Promise(r=>b=r):path==='/api/rides/c'?new Promise(r=>c=r):base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {loadRide,state:()=>({ride:currentRide?.name,view})};})()`,ctx);
 const answer=name=>({ok:true,status:200,json:async()=>({id:name,name,coordinates:[[50,5],[50.001,5]],distance:111})});
 const first=access.loadRide('a'),second=access.loadRide('b');b(answer('b'));await second;a(answer('a'));await first;assert.equal(access.state().ride,'b');
 const third=access.loadRide('c');elements.get('finishDrawing').onclick();c(answer('c'));await third;assert.equal(access.state().view,'saved');assert.equal(access.state().ride,'b');
});

test('déplacer départ, arrivée et passages recalcule tous les points sans perdre leur ordre',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;
 ctx.fetch=async(path,options)=>{if(path==='/api/route'){calls.push({path,options});const points=JSON.parse(options.body).points;return {ok:true,status:200,json:async()=>({coordinates:points,legFractions:points.map((_,i)=>i/(points.length-1)),stats:{maxOffset:0,ignoredAnchors:0}})};}if(path==='/api/osm')return {ok:false,status:503,json:async()=>({error:'Indisponible'})};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');segmentDraftActive=false;endpoints=[[50,5],[50.002,5]];selected=endpoints.map(p=>[...p]);snapped=true;return {insertVia,moveRouteControl,removeVia,setMode,state:()=>JSON.stringify(routeControls())};})()`,ctx);
 await access.insertVia(1,[50.001,5.001]);assert.equal(JSON.parse(access.state()).length,3);await access.moveRouteControl(0,[50,4.999]);await access.moveRouteControl(2,[50.003,5]);await access.moveRouteControl(1,[50.001,5.002]);
 const expected=[[50,4.999],[50.001,5.002],[50.003,5]];assert.deepEqual(JSON.parse(access.state()),expected);assert.deepEqual(JSON.parse(calls.filter(c=>c.path==='/api/route').at(-1).options.body).points,expected);
 access.setMode('manual');access.setMode('route');assert.deepEqual(JSON.parse(access.state()),expected);elements.get('waypointDetails').open=true;elements.get('waypointDetails').ontoggle();assert.equal(elements.get('waypointList').children.length,3);
 await access.removeVia(0);assert.deepEqual(JSON.parse(access.state()),[expected[0],expected[2]]);
});
test('dessin indépendant garde le repère Strava privé et envoie uniquement les nouveaux points OSM',async()=>{
 const {ctx,elements,calls}=context();const access=await vm.runInNewContext(`(async()=>{${script}\ncurrentRide={id:'00000000-0000-0000-0000-000000000001',source_type:'strava',name:'Activité privée',coordinates:[[51,6],[51.001,6]],distance:111};trace=[[51,6],[51.001,6]];selected=trace.map(p=>[...p]);$('independentSegment').onclick();setMode('snap');setMode('manual');choose({lat:50,lng:5});choose({lat:50.001,lng:5});rating=4;update();return {mode,points:JSON.stringify(selected),trace:trace.length};})()`,ctx);
 assert.equal(access.mode,'manual');assert.equal(access.trace,2);assert.equal(access.points,'[[50,5],[50.001,5]]');assert.equal(elements.has('autoMode'),false);assert.equal(elements.get('publicSegment').checked,true);
 elements.get('surface').value='Sable';elements.get('difficulty').value='Facile';elements.get('winter').value='unknown';elements.get('singleTrack').value='unknown';await elements.get('ratingForm').onsubmit({preventDefault(){}});
 const saved=JSON.parse(calls.find(c=>c.path==='/api/portions'&&c.options.method==='POST').options.body);assert.equal(saved.independentOsm,true);assert.equal(saved.rideId,null);assert.equal(saved.source,'Dessin OSM indépendant');assert.equal(saved.isPublic,true);assert.ok(!JSON.stringify(saved).includes('Activité privée'));assert.deepEqual(saved.coordinates,[[50,5],[50.001,5]]);
});

test('aperçus OSM créés à visibilité, attribution et Referer présents, ressources libérées',async()=>{
 const visibility=[],resize=[],tiles=[],maps=[];let removed=0,disconnected=0;
 const ctx={document:{createElement:()=>({...element(),clientWidth:320,clientHeight:185})},IntersectionObserver:class{constructor(fn){this.fn=fn;visibility.push(this);}observe(node){this.node=node;}disconnect(){disconnected++;}},ResizeObserver:class{constructor(fn){this.fn=fn;resize.push(this);}observe(){}disconnect(){disconnected++;}}};
 ctx.L={latLngBounds:p=>p,map:(node,options)=>{const map={node,options,fitBounds(points,opts){this.points=points;this.fit=opts;},invalidateSize(){},remove(){removed++;}};maps.push(map);return map;},tileLayer:(url,options)=>{const tile={url,options,events:{},on(n,fn){this.events[n]=fn;return this;},addTo(){return this;}};tiles.push(tile);return tile;},polyline:()=>({addTo(){}})};
 const access=vm.runInNewContext(`${previewScript}\n({renderPreview,disposePreviews})`,ctx),container=element(),item={name:'Sentier',coordinates:[[50,5],[50.001,5]]};
 access.renderPreview(container,item);assert.equal(maps.length,0);visibility[0].fn([{isIntersecting:true}]);assert.equal(maps.length,1);assert.equal(maps[0].options.scrollWheelZoom,false);assert.equal(maps[0].fit.maxZoom,16);assert.equal(tiles[0].url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.equal(tiles[0].options.referrerPolicy,'strict-origin-when-cross-origin');assert.match(tiles[0].options.attribution,/OpenStreetMap/);
 const graphic=container.children[0],notice=graphic.children.at(-1);tiles[0].events.tileerror();assert.equal(notice.hidden,false);tiles[0].events.loading();tiles[0].events.load();assert.equal(notice.hidden,true);
 access.renderPreview(container,null);assert.equal(removed,1);assert.equal(disconnected,2);visibility[0].fn([{isIntersecting:true}]);assert.equal(maps.length,1);
});

test('glissement réel de marqueur et de ligne ajoute un passage, recalcul à la fin seulement, annulation propre',async()=>{
 const {ctx,calls,elements}=context(),base=ctx.fetch,markers=[],lines=[],listeners=new Map();let mapDragging=true;
 ctx.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 const dom=()=>({...element(),events:{},addEventListener(name,fn){this.events[name]=fn;}});
 const layer=(coords,options={})=>({coords,options,events:{},node:dom(),removed:false,layers:[],on(n,fn){this.events[n]=fn;return this;},addTo(target){this.removed=false;target.layers?.push(this);return this;},setOpacity(value){this.opacity=value;return this;},clearLayers(){for(const l of this.layers)l.removed=true;this.layers=[];},bindTooltip(){return this;},getElement(){return this.node;},getLatLng(){return {lat:this.coords[0],lng:this.coords[1]};},setLatLng(p){this.coords=Array.isArray(p)?p:[p.lat,p.lng];return this;},setLatLngs(p){this.coords=p;return this;},remove(){this.removed=true;}});
 const map={setView(){return this;},createPane(){},getPane(){return {style:{}};},on(){return this;},invalidateSize(){},fitBounds(){},hasLayer(){return false;},mouseEventToLatLng:e=>({lat:e.lat,lng:e.lng}),dragging:{enabled:()=>mapDragging,disable:()=>mapDragging=false,enable:()=>mapDragging=true}};
 const tile=()=>layer();tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:()=>layer(),polyline:(p,o)=>{const l=layer(p,o);lines.push(l);return l;},marker:(p,o)=>{const l=layer(p,o);markers.push(l);return l;},divIcon:o=>o,latLngBounds:p=>p,DomEvent:{stopPropagation(){}},control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 ctx.fetch=async(path,options)=>{if(path==='/api/route'){calls.push({path,options});const points=JSON.parse(options.body).points;return {ok:true,status:200,json:async()=>({coordinates:points,legFractions:points.map((_,i)=>i/(points.length-1)),stats:{maxOffset:0,ignoredAnchors:0}})};}if(path==='/api/osm')return {ok:false,status:503,json:async()=>({error:'Indisponible'})};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');segmentDraftActive=false;endpoints=[[50,5],[50.002,5]];selected=endpoints.map(p=>[...p]);snapped=true;rating=4;drawSelection();update();return {controls:()=>JSON.stringify(routeControls())};})()`,ctx);
 const start=markers.find(m=>m.options.draggable&&!m.removed);start.events.dragstart();start.setLatLng([50.0001,5]);start.events.dragend({target:start});await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(access.controls())[0][0],50.0001);
 const line=lines.filter(l=>l.options.className==='routing-draggable'&&!l.removed).at(-1),event={pointerId:7,button:0,isPrimary:true,clientX:100,clientY:100,lat:50.001,lng:5,preventDefault(){},stopPropagation(){}};
 const before=calls.filter(c=>c.path==='/api/route').length;line.node.events.pointerdown(event);assert.equal(mapDragging,false);listeners.get('pointermove')({...event,clientX:120,clientY:110,lat:50.001,lng:5.001});assert.equal(calls.filter(c=>c.path==='/api/route').length,before);
 listeners.get('pointerup')({...event,clientX:120,clientY:110,lat:50.001,lng:5.001});await new Promise(r=>setImmediate(r));assert.equal(mapDragging,true);assert.equal(listeners.size,0);assert.deepEqual(JSON.parse(access.controls()),[[50.0001,5],[50.001,5.001],[50.002,5]]);assert.equal(calls.filter(c=>c.path==='/api/route').length,before+1);
 const next=lines.filter(l=>l.options.className==='routing-draggable'&&!l.removed).at(-1);next.node.events.pointerdown({...event,pointerId:8});listeners.get('pointercancel')({pointerId:8});assert.equal(mapDragging,true);assert.equal(listeners.size,0);assert.equal(calls.filter(c=>c.path==='/api/route').length,before+1);
 elements.get('surface').value='Sable';elements.get('difficulty').value='Facile';elements.get('winter').value='yes';elements.get('singleTrack').value='yes';await elements.get('ratingForm').onsubmit({preventDefault(){}});const saved=JSON.parse(calls.find(c=>c.path==='/api/portions'&&c.options.method==='POST').options.body);assert.equal(saved.routePoints.length,3);
});

test('départ accroché seul à OSM et réponse ancienne ignorée après choix de l’arrivée',async()=>{
 const {ctx,flushTimers}=context(),base=ctx.fetch;let finishNearest;
 ctx.fetch=async(path,options)=>path==='/api/route/nearest'?new Promise(r=>finishNearest=r):path==='/api/route'?{ok:true,status:200,json:async()=>({coordinates:[[50.0001,5],[50.0011,5]],snappedPoints:[[50.0001,5],[50.0011,5]],stats:{maxOffset:20,ignoredAnchors:0}})}:path==='/api/osm'?{ok:false,status:503,json:async()=>({error:'Indisponible'})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');choose({lat:50,lng:5.0002});choose({lat:50.001,lng:5.0002});return {points:()=>JSON.stringify(endpoints)};})()`,ctx);
 flushTimers(150);await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(access.points()),[[50.0001,5],[50.0011,5]]);finishNearest({ok:true,status:200,json:async()=>({point:[49,4]})});flushTimers(150);await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(access.points()),[[50.0001,5],[50.0011,5]]);
});
test('planificateur prolonge un itinéraire long, enregistre sans note de segment et propose son GPX',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch;let saved=[];
 ctx.fetch=async(path,options={})=>{if(path==='/api/route'){calls.push({path,options});const points=JSON.parse(options.body).points;return {ok:true,status:200,json:async()=>({coordinates:points,snappedPoints:points,stats:{maxOffset:0,ignoredAnchors:0}})};}if(path==='/api/plans'&&options.method==='POST'){calls.push({path,options});const body=JSON.parse(options.body),p={...body,id:'00000000-0000-0000-0000-000000000999',distance:40000,isMine:true,owner:'alice'};saved=[p];return {ok:true,status:201,json:async()=>p};}if(path==='/api/plans')return {ok:true,status:200,json:async()=>saved};if(path.endsWith('/00000000-0000-0000-0000-000000000999'))return {ok:true,status:200,json:async()=>saved[0]};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.15,lng:5.1});choose({lat:50.3,lng:5.2});return {state:()=>({view,mode,rating,points:JSON.stringify(routeControls()),selected:selected.length}),loadPlan};})()`,ctx);
 flushTimers();await new Promise(r=>setImmediate(r));elements.get('planName').value='Grand tour gravel';elements.get('planName').oninput();assert.equal(access.state().view,'planner');assert.equal(access.state().rating,0);assert.equal(access.state().selected,3);assert.equal(elements.get('savePlan').disabled,false);assert.equal(elements.get('ratingForm').hidden,true);assert.equal(elements.get('planForm').hidden,false);
 const route=JSON.parse(calls.filter(c=>c.path==='/api/route').at(-1).options.body);assert.equal(route.purpose,'itinerary');assert.equal(route.points.length,2);
 elements.get('planName').value='Grand tour gravel';elements.get('planNotes').value='Pause au village';elements.get('publicPlan').checked=true;await elements.get('planForm').onsubmit({preventDefault(){}});assert.equal(saved.length,1);assert.equal(saved[0].isPublic,true);assert.equal(saved[0].routePoints.length,3);assert.equal(elements.get('exportPlan').href,'/api/plans/'+saved[0].id+'/gpx');
 await access.loadPlan(saved[0].id);assert.equal(access.state().selected,3);assert.equal(elements.get('planName').value,'Grand tour gravel');
});
test('itinéraire public d’un autre membre non modifiable, copie privée éditable',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p={id:'00000000-0000-0000-0000-000000000777',name:'Tour public',coordinates:[[50,5],[50.02,5]],routePoints:[[50,5],[50.02,5]],mode:'route',snapped:true,isPublic:true,isMine:false,owner:'bob'};
 ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {loadPlan,choose,state:()=>({readonly:planReadOnly,editing:editingPlan?.id,coords:JSON.stringify(selected),canDraw:canDraw()})};})()`,ctx);
 await access.loadPlan(p.id);assert.equal(access.state().readonly,true);assert.equal(access.state().canDraw,false);assert.equal(elements.get('savePlan').disabled,true);access.choose({lat:51,lng:6});assert.equal(access.state().coords,JSON.stringify(p.coordinates));
 await access.loadPlan(p.id,{copy:true});assert.equal(access.state().readonly,false);assert.equal(access.state().editing,undefined);assert.equal(elements.get('publicPlan').checked,false);assert.equal(elements.get('planName').value,'Copie de Tour public');
});
test('superposition des traces désactivée par défaut et chargement tardif ignoré après décochage',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;let finish;ctx.fetch=async(path,options)=>path==='/api/rides/overlay'?new Promise(r=>finish=r):base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {overlays:()=>importedTraces};})()`,ctx);assert.ok(!elements.get('showImportedTraces').checked);
 elements.get('showImportedTraces').checked=true;const pending=elements.get('showImportedTraces').onchange();elements.get('showImportedTraces').checked=false;await elements.get('showImportedTraces').onchange();finish({ok:true,status:200,json:async()=>[{id:'a',name:'Privé',coordinates:[[50,5],[50.01,5]]}]});await pending;assert.equal(access.overlays(),null);assert.equal(elements.get('importedTracesStatus').textContent,'');
});

test('un premier point de routage est réellement déplacé sur le chemin renvoyé par OSM',async()=>{
 const {ctx}=context(),base=ctx.fetch;ctx.fetch=async(path,options)=>path==='/api/route/nearest'?{ok:true,status:200,json:async()=>({point:[50.0002,5],offset:75})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');choose({lat:50,lng:5.001});return {point:()=>JSON.stringify(endpoints),selection:()=>JSON.stringify(selected)};})()`,ctx);await new Promise(r=>setImmediate(r));assert.equal(access.point(),'[[50.0002,5]]');assert.equal(access.selection(),'[[50.0002,5]]');
});
test('les traces importées sont dessinées en fond et retirées quand l’option est décochée',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,drawn=[];let fitted=0;
 const map={setView(){return this;},createPane(){},getPane(){return {style:{}};},on(){return this;},invalidateSize(){},fitBounds(){fitted++;},hasLayer(){return false;}};
 const layer=()=>({items:[],on(){return this;},addTo(target){target.items?.push(this);return this;},clearLayers(){this.items=[];},bindTooltip(){return this;}}),tile=()=>layer();tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:layer,polyline:(points,options)=>{drawn.push({points,options});return layer();},latLngBounds:p=>p,control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 ctx.fetch=async(path,options)=>path==='/api/rides/overlay'?{ok:true,status:200,json:async()=>[{id:'a',name:'Ma sortie',coordinates:[[50,5],[50.01,5]]}]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {count:()=>importedLayer.items.length};})()`,ctx);assert.equal(access.count(),0);elements.get('showImportedTraces').checked=true;await elements.get('showImportedTraces').onchange();assert.equal(access.count(),1);assert.equal(drawn.at(-1).options.pane,'importsPane');assert.ok(fitted>0);elements.get('showImportedTraces').checked=false;await elements.get('showImportedTraces').onchange();assert.equal(access.count(),0);
});

test('itinéraires : ajout incrémental, correction manuelle, undo/redo et nom obligatoire dans le vrai contrôleur',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch;
 ctx.fetch=async(path,options={})=>{if(path==='/api/route'){calls.push({path,options});const {points}=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({coordinates:[points[0],[(points[0][0]+points[1][0])/2,5.0001],points[1]]})};}if(path==='/api/plan-metrics')return {ok:true,status:200,json:async()=>({elevation:null,surfaces:[],surfaceRuns:[],errors:[]})};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();return {choose,moveRouteControl,insertVia,state:()=>JSON.stringify({points:planDraft.points,legs:planDraft.serialise(),selected})};})()`,ctx);
 access.choose({lat:50,lng:5});access.choose({lat:50.01,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));const original=JSON.parse(access.state()).legs[0];
 assert.equal(elements.get('savePlan').disabled,true);assert.equal(elements.get('toleranceControls').hidden,true);assert.equal(elements.has('modeControls'),false);assert.equal(elements.get('plannerTools').hidden,false);
 elements.get('planName').value='Les bois';elements.get('planName').oninput();assert.equal(elements.get('savePlan').disabled,false);
 access.choose({lat:50.02,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(access.state()).legs[0],original);const requests=calls.filter(c=>c.path==='/api/route');assert.equal(requests.length,2);assert.deepEqual(JSON.parse(requests[1].options.body).points,[[50.01,5],[50.02,5]]);assert.equal(JSON.parse(requests[1].options.body).tolerance,150);
 elements.get('manualLeg').checked=true;access.choose({lat:50.021,lng:5.001});flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.path==='/api/route').length,2);assert.equal(JSON.parse(access.state()).legs.at(-1).mode,'manual');
 elements.get('undoPlan').onclick();assert.equal(JSON.parse(access.state()).points.length,3);elements.get('redoPlan').onclick();assert.equal(JSON.parse(access.state()).points.length,4);assert.equal(JSON.parse(access.state()).legs.at(-1).mode,'manual');
 elements.get('manualLeg').checked=false;access.choose({lat:50.03,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(access.state()).legs[2].mode,'manual');assert.equal(calls.filter(c=>c.path==='/api/route').length,3);
 const before=calls.filter(c=>c.path==='/api/route').length;await access.moveRouteControl(1,[50.011,5.001]);await new Promise(r=>setImmediate(r));flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.path==='/api/route').length,before+2);
});
test('enregistrer attend les altitudes et revêtements pour les conserver et les exporter',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch;let finish;const analysis={elevation:{ascent:40,descent:0,profile:[{at:0,altitude:100},{at:1112,altitude:140}],spacing:60},surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[],errors:[]};
 ctx.fetch=async(path,options={})=>{if(path==='/api/route')return {ok:true,status:200,json:async()=>({coordinates:JSON.parse(options.body).points})};if(path==='/api/plan-elevations')return new Promise(r=>finish=r);if(path==='/api/plan-metrics')return {ok:true,status:200,json:async()=>({surfaces:analysis.surfaces,surfaceRuns:[],errors:[]})};if(path==='/api/plans'&&options.method==='POST'){calls.push({path,options});return {ok:true,status:201,json:async()=>({...JSON.parse(options.body),id:'p',isMine:true})};}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});})()`,ctx);flushTimers();await new Promise(r=>setImmediate(r));elements.get('planName').value='Dénivelé test';elements.get('planName').oninput();const saving=elements.get('planForm').onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.path==='/api/plans'&&c.options.method==='POST').length,0);assert.equal(elements.get('savePlan').disabled,true);
 finish({ok:true,status:200,json:async()=>[{elevation:analysis.elevation,error:null}]});await saving;const saved=JSON.parse(calls.find(c=>c.path==='/api/plans'&&c.options.method==='POST').options.body);assert.equal(saved.legs[0].analysis.elevation.ascent,40);assert.match(elements.get('planElevation').textContent,/D\+ 40 m/);
});
test('les segments et les imports laissent passer les clics de dessin ; le non-bitume est dessiné en pointillés',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,drawn=[];const map={setView(){return this;},createPane(){},getPane(){return {style:{}};},on(){return this;},invalidateSize(){},fitBounds(){},hasLayer(){return false;}};
 const layer=()=>({on(){return this;},addTo(){return this;},clearLayers(){},bindTooltip(){return this;}}),tile=()=>layer();tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:layer,polyline:(points,options)=>{drawn.push({points,options});return layer();},marker:layer,divIcon:o=>o,latLngBounds:p=>p,control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 await vm.runInNewContext(`(async()=>{${script}\nnewPlan();catalog=[{name:'Segment',isMine:true,rating:4,surface:'Gravier fin',owner:'alice',coordinates:[[50,5],[50.01,5]]}];drawCatalog();$('showImportedTraces').checked=true;importedTraces=[{name:'GPX',coordinates:[[50,5],[50.01,5]]}];drawImportedTraces();planDraft.append([50,5]);planDraft.append([50.01,5]);planDraft.resolve(planDraft.legs[0].id,{coordinates:[[50,5],[50.01,5]]});planDraft.analyse(planDraft.legs[0].id,{surfaceRuns:[{coordinates:[[50,5],[50.005,5]],type:'Gravier',unpaved:true},{coordinates:[[50.005,5],[50.01,5]],type:'Béton',unpaved:false}]});syncPlanner();})()`,ctx);
 const catalogLine=drawn.find(l=>l.options.weight===6&&l.options.opacity===.9),importLine=drawn.find(l=>l.options.pane==='importsPane');assert.equal(catalogLine.options.interactive,true);assert.equal(importLine.options.interactive,false);const runs=drawn.filter(l=>l.options.color==='#b5654c'&&l.options.weight===6);assert.equal(runs[0].options.dashArray,'7 7');assert.equal(runs[1].options.dashArray,null);
});

function profilePlan({mine=true}={}){const points=[[50,5],[50.1,5],[50.2,5]],make=(a,b,lo,hi)=>({mode:'route',coordinates:[a,b],analysis:{surfaces:[{type:'Gravier',distance:11119.5}],surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:[a,b]}],errors:[],elevation:{ascent:hi-lo,descent:0,spacing:60,profile:[{at:0,altitude:lo},{at:11119.5,altitude:hi}]}}});return {id:'00000000-0000-0000-0000-000000000999',name:'Tour des bois',notes:'Pause au sommet',isMine:mine,isPublic:!mine,owner:mine?'alice':'bob',coordinates:points,routePoints:points,mode:'route',snapped:true,distance:22239,legs:[make(points[0],points[1],100,200),make(points[1],points[2],200,350)]};}
function interactiveMap(ctx){const markers=[],lines=[],events={};let zoom=14;const layer=(coords,options={})=>({coords,options,layers:[],events:{},removed:false,on(name,fn){this.events[name]=fn;return this;},addTo(target){this.removed=false;target.layers?.push(this);return this;},setOpacity(value){this.opacity=value;return this;},clearLayers(){for(const l of this.layers)l.removed=true;this.layers=[];},bindTooltip(html,options){this.tooltip={html,options};return this;},getLatLng(){return {lat:this.coords[0],lng:this.coords[1]};},setLatLng(p){this.coords=p;return this;},remove(){this.removed=true;}});
 const map={layers:[],setView(){return this;},createPane(){},getPane(){return {style:{}};},on(name,fn){events[name]=fn;return this;},invalidateSize(){},fitBounds(){},hasLayer(layer){return this.layers.includes(layer)&&!layer.removed;},getZoom:()=>zoom,getBounds:()=>({contains:()=>true})},tile=(url,options)=>{const l=layer(null,options);l.url=url;return l;};tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:()=>layer(),polyline:(p,o)=>{const l=layer(p,o);lines.push(l);return l;},marker:(p,o)=>{const l=layer(p,o);markers.push(l);return l;},divIcon:o=>o,latLngBounds:p=>p,DomEvent:{stopPropagation(){}},control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 return {map,markers,lines,events,setZoom(value){zoom=value;events['zoomend moveend']();}};
}
test('sélection et clic sur un itinéraire affichent directement, miniature sous la carte, édition explicite',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options)=>path==='/api/plans'?{ok:true,status:200,json:async()=>[p]}:path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();await refreshPlans();return {state:()=>({viewing:planViewing,canDraw:canDraw(),size:planDraft.points.length})};})()`,ctx);
 elements.get('planSelect').value=p.id;elements.get('planSelect').onchange();await new Promise(r=>setImmediate(r));assert.equal(access.state().viewing,true);assert.equal(access.state().canDraw,false);assert.equal(elements.get('planForm').hidden,true);assert.equal(elements.get('routeEditControls').hidden,true);assert.equal(elements.get('elevationPanel').hidden,false);assert.equal(elements.get('planPreview').children[1].className,'mini-elevation');assert.match(elements.get('planPreview').children[1].innerHTML,/elevation-chart compact/);assert.match(elements.get('planPreview').children.at(-1).textContent,/100 % non asphalté/);assert.doesNotMatch(html,/id="(?:newPlan|openPlan)"/);
 elements.get('editPlan').onclick();assert.equal(access.state().canDraw,true);assert.equal(elements.get('planForm').hidden,false);elements.get('planPreview').onclick({target:{closest:()=>null}});await new Promise(r=>setImmediate(r));assert.equal(access.state().viewing,true);
});
test('nouvel itinéraire dans la carte est annulable, y compris visibilité, nom, analyses et retour en consultation publique',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan({mine:false});ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {state:()=>JSON.stringify({viewing:planViewing,readonly:planReadOnly,editing:editingPlan?.id,coordinates:planDraft.coordinates(),legs:planDraft.serialise()})};})()`,ctx),before=access.state();assert.equal(elements.get('reset').getAttribute('aria-label'),'Créer un nouvel itinéraire');elements.get('reset').onclick();assert.equal(JSON.parse(access.state()).coordinates.length,0);assert.equal(elements.get('planName').value,'');assert.equal(elements.get('manualLeg').checked,false);elements.get('undoPlan').onclick();assert.equal(access.state(),before);assert.equal(elements.get('planName').value,p.name);assert.equal(elements.get('redoPlan').disabled,false);assert.equal(elements.get('redoPlan').hidden,false);elements.get('redoPlan').onclick();assert.equal(JSON.parse(access.state()).coordinates.length,0);
});
test('consultation avec bornes kilométriques adaptatives, sans passages ; graphe et curseur déplacent un repère réel',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan(),fake=interactiveMap(ctx);ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const attrs=()=>({values:{},setAttribute(k,v){this.values[k]=v;}}),line=attrs(),dot=attrs(),svg={events:{},getBoundingClientRect:()=>({left:0,width:800}),querySelector:selector=>selector==='.profile-cursor'?line:dot,addEventListener(k,v){this.events[k]=v;}};elements.get('elevationGraph').querySelector=()=>svg;
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {size:()=>marks.layers.length};})()`,ctx);assert.equal(access.size(),0);let km=fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='kilometre-marker');assert.ok(km.length>=20);assert.equal(km[0].options.icon.html,'1 km');fake.setZoom(12);km=fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='kilometre-marker');assert.equal(km[0].options.icon.html,'5 km');fake.setZoom(9);assert.equal(fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='kilometre-marker').length,0);
 elements.get('elevationSeek').value='5559.75';elements.get('elevationSeek').oninput();let cursor=fake.markers.find(m=>m.options.icon?.className==='elevation-map-cursor'&&!m.removed);assert.ok(Math.abs(cursor.coords[0]-50.05)<.00001);assert.match(elements.get('elevationReadout').textContent,/150 m/);assert.equal(line.values.visibility,'visible');assert.equal(dot.values.visibility,'visible');svg.events.pointermove({clientX:500});assert.ok(cursor.coords[0]>50.1);assert.match(elements.get('elevationReadout').textContent,/pente/);
 elements.get('planColorMode').value='altitude';elements.get('planColorMode').onchange();const colors=new Set(fake.lines.filter(l=>!l.removed&&l.options.weight===6).map(l=>l.options.color));assert.ok(colors.size>2);assert.match(elements.get('legendContent').children[0].textContent,/Altitude/);
});
test('cocher le mode d’un point change uniquement sa portion entrante et la légende de technicité est disponible',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');$('editPlan').onclick();const outgoing=planDraft.legs[1];openPointSettings(1);return {state:()=>({first:planDraft.legs[0].mode,outgoingUnchanged:outgoing===planDraft.legs[1]}),setPointMode};})()`,ctx);assert.equal(elements.get('pointSettings').hidden,false);elements.get('pointIncomingManual').checked=true;elements.get('pointIncomingManual').onchange();assert.equal(access.state().first,'manual');assert.equal(access.state().outgoingUnchanged,true);elements.get('undoPlan').onclick();assert.equal(access.state().first,'route');
 elements.get('colorMode').value='difficulty';elements.get('colorMode').onchange();assert.ok(elements.get('legendContent').children.some(c=>c.textContent==='Secteurs · Technicité'));assert.ok(elements.get('legendContent').children.some(c=>c.children?.some(x=>x.textContent==='Très technique')));assert.ok(html.includes('<option value="difficulty">Technicité</option>'));
});

test('ouvrir un itinéraire complet ou incomplet, sa copie et son édition ne déclenchent aucun calcul externe',async()=>{
 const {ctx,calls,elements}=context(),base=ctx.fetch,p=profilePlan();p.legs=p.legs.map(l=>({...l,analysis:null}));ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {loadPlan};})()`,ctx);await new Promise(r=>setImmediate(r));elements.get('editPlan').onclick();await access.loadPlan(p.id,{copy:true});await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>['/api/plan-metrics','/api/plan-elevations'].includes(c.path)).length,0);assert.equal(elements.get('retryAnalysis').hidden,false);assert.match(elements.get('planAnalysisStatus').textContent,/Données manquantes/);
});
test('profil visible dès la réponse groupée des altitudes, avant les revêtements encore en attente',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,original=profilePlan(),p={...original,legs:original.legs.map(l=>({...l,analysis:null}))};let releaseSurface,firstSurface=true;
 ctx.fetch=async(path,options={})=>{if(path==='/api/plans/'+p.id)return {ok:true,status:200,json:async()=>p};if(path==='/api/plan-elevations'){calls.push({path,options});return {ok:true,status:200,json:async()=>original.legs.map(l=>({elevation:l.analysis.elevation,error:null}))};}if(path==='/api/plan-metrics'){if(firstSurface){firstSurface=false;return new Promise(r=>releaseSurface=()=>r({ok:true,status:200,json:async()=>({surfaces:[],surfaceRuns:[],errors:[]})}));}return {ok:true,status:200,json:async()=>({surfaces:[],surfaceRuns:[],errors:[]})};}return base(path,options);};
 await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');})()`,ctx);elements.get('retryAnalysis').onclick();await new Promise(r=>setImmediate(r));assert.ok(releaseSurface);assert.match(elements.get('planElevation').textContent,/D\+ 250 m/);assert.match(elements.get('elevationGraph').innerHTML,/elevation-line/);assert.equal(JSON.parse(calls.find(c=>c.path==='/api/plan-elevations').options.body).paths.length,2);releaseSurface();await new Promise(r=>setImmediate(r));
});
test('prolonger un ancien itinéraire ne recalcule pas ses anciennes altitudes',async()=>{
 const {ctx,calls,elements,flushTimers}=context(),base=ctx.fetch,p=profilePlan();p.legs=p.legs.map(l=>({...l,analysis:null}));ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');$('editPlan').onclick();$('manualLeg').checked=true;choose({lat:50.201,lng:5});return {state:()=>planDraft.legs.slice(0,2).map(l=>l.analysis)};})()`,ctx);flushTimers(350);await new Promise(r=>setImmediate(r));flushTimers(1000);await new Promise(r=>setImmediate(r));const batch=calls.filter(c=>c.path==='/api/plan-elevations');assert.equal(batch.length,1);assert.deepEqual(JSON.parse(batch[0].options.body).paths,[[[50.2,5],[50.201,5]]]);assert.ok(access.state().every(a=>!Object.hasOwn(a||{},'elevation')));
});

test('bibliothèque repliable du planificateur : redimensionne la carte, conserve le tracé et reste réouvrable',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx);let resizes=0;fake.map.invalidateSize=()=>resizes++;
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([50,5]);planDraft.append([50.01,5],'manual');syncPlanner();return {state:()=>JSON.stringify(planDraft.snapshot()),setView};})()`,ctx),before=access.state();
 assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);elements.get('sidebarToggle').onclick();const baseline=resizes;elements.get('sidebarToggle').onclick();assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);assert.equal(elements.get('sidebarToggle').hidden,false);assert.equal(elements.get('sidebarToggle').classList.contains('is-collapsed'),true);assert.equal(access.state(),before);assert.ok(resizes>baseline);
 elements.get('sidebarToggle').onclick();assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),false);assert.equal(access.state(),before);elements.get('sidebarToggle').onclick();access.setView('saved');assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);assert.equal(elements.get('sidebarToggle').hidden,false);access.setView('planner');assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);
});
test('actualiser les surfaces d’un itinéraire enregistré garde les altitudes et ne demande aucune altitude',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,p=profilePlan();p.legs[1].analysis=null;
 ctx.fetch=async(path,options={})=>{if(path==='/api/plans/'+p.id)return {ok:true,status:200,json:async()=>p};if(path==='/api/plan-metrics'){calls.push({path,options});return {ok:true,status:200,json:async()=>({surfaceVersion:2,surfaces:[{type:'Terre',distance:11119.5}],surfaceRuns:[{type:'Terre',unpaved:true,coordinates:JSON.parse(options.body).coordinates}],accessRuns:[],errors:[]})};}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {state:()=>JSON.stringify(planDraft.serialise()),refreshPlanSurfaces};})()`,ctx),old=JSON.parse(access.state());await access.refreshPlanSurfaces();const after=JSON.parse(access.state());assert.deepEqual(after[0].analysis.elevation,old[0].analysis.elevation);assert.equal(Object.hasOwn(after[1].analysis,'elevation'),false);assert.equal(after[0].analysis.surfaceRuns[0].unpaved,true);assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,2);assert.equal(calls.filter(c=>c.path==='/api/plan-elevations').length,0);assert.equal(elements.get('refreshSurfaces').disabled,false);
});
test('réponse locale : pointillés immédiats, repère d’accès sur le seul tronçon limité et analyses conservées',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch,fake=interactiveMap(ctx),a=[50,5],b=[50.005,5],c=[50.01,5];
 const analysis={surfaceVersion:2,surfaces:[{type:'Asphalte / bitume',distance:556},{type:'Gravier',distance:556}],surfaceRuns:[{type:'Asphalte / bitume',unpaved:false,coordinates:[a,b]},{type:'Gravier',unpaved:true,coordinates:[b,c]}],accessRuns:[{label:'Accès privé (access=private)',coordinates:[b,c]}],errors:[]};
 ctx.fetch=async(path,options={})=>{if(path==='/api/route'){calls.push({path,options});return {ok:true,status:200,json:async()=>({coordinates:[a,b,c],analysis,stats:{maxOffset:0,ignoredAnchors:0}})};}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});return {legs:()=>planDraft.serialise(),drawSelection,setView};})()`,ctx);flushTimers();await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(calls.find(c=>c.path==='/api/route').options.body).allowRestricted,true);
 const runs=fake.lines.filter(l=>!l.removed&&l.options.weight===6);assert.ok(runs.some(l=>l.options.dashArray==='7 7'));const warnings=fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='access-warning');assert.equal(warnings.length,1);assert.ok(Math.abs(warnings[0].coords[0]-50.0075)<.00001);assert.deepEqual(access.legs()[0].analysis.accessRuns,analysis.accessRuns);
 flushTimers(1000);await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,0);assert.equal(access.legs()[0].analysis.surfaceVersion,2);access.setView('saved');access.drawSelection();assert.equal(fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='access-warning').length,0);
});

test('secteur : accès limité visible dans la carte et sa légende, y compris après un zoom',async()=>{
 const {ctx,elements,flushTimers}=context(),base=ctx.fetch,fake=interactiveMap(ctx),a=[50,5],b=[50.01,5],analysis={surfaceVersion:2,surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:[a,b]}],accessRuns:[{label:'Accès privé (access=private)',coordinates:[a,b]}],errors:[]};
 ctx.fetch=async(path,options)=>path==='/api/route'?{ok:true,status:200,json:async()=>({coordinates:[a,b],analysis,stats:{maxOffset:0}})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();choose({lat:50,lng:5});choose({lat:50.01,lng:5});return {setView};})()`,ctx);flushTimers();await new Promise(r=>setImmediate(r));
 const warnings=()=>fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='access-warning');assert.equal(warnings().length,1);assert.match(warnings()[0].tooltip.html,/Accès privé/);assert.ok(elements.get('legendContent').children.some(e=>e.children?.some(c=>/! Accès limité/.test(c.textContent))));fake.setZoom(16);assert.equal(warnings().length,1);assert.equal(elements.get('routingSourceNotice').hidden,true);assert.equal(elements.get('reset').classList.contains('is-plan'),true);
 elements.get('finishDrawing').onclick();assert.equal(warnings().length,0);await elements.get('reset').onclick();assert.equal(elements.get('reset').classList.contains('is-plan'),true);
});

test('le recours au moteur de secours reste signalé pendant le dessin',async()=>{
 const {ctx,elements,flushTimers}=context(),base=ctx.fetch,warning='Moteur vélo de secours : les accès restreints peuvent être évités.';
 ctx.fetch=async(path,options)=>path==='/api/route'?{ok:true,status:200,json:async()=>({coordinates:JSON.parse(options.body).points,warning,stats:{maxOffset:0}})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});return {update,setView};})()`,ctx);flushTimers();await new Promise(r=>setImmediate(r));access.update();assert.equal(elements.get('routingSourceNotice').hidden,false);assert.equal(elements.get('routingSourceNotice').textContent,warning);access.setView('saved');assert.equal(elements.get('routingSourceNotice').hidden,true);
});

test('échec signalé par l’analyse de surface ne remplace pas les données sauvegardées par de l’inconnu',async()=>{
 const {ctx}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options={})=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:path==='/api/plan-metrics'?{ok:true,status:200,json:async()=>({surfaces:[{type:'Inconnu',distance:11119}],surfaceRuns:[],errors:['Revêtements OSM indisponibles.']})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {refreshPlanSurfaces,state:()=>JSON.stringify(planDraft.serialise())};})()`,ctx),before=access.state();await access.refreshPlanSurfaces();assert.equal(access.state(),before);
});

test('profil lisible sur mobile : dimensions réelles, graduations fixes, gradient et extrema optionnels sans perdre le curseur',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan(),fake=interactiveMap(ctx);let width=360;
 ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const attrs=()=>({values:{},setAttribute(k,v){this.values[k]=v;}}),line=attrs(),dot=attrs(),svg={getBoundingClientRect:()=>({left:0,width}),querySelector:selector=>selector==='.profile-cursor'?line:dot,addEventListener(){}};elements.get('elevationGraph').getBoundingClientRect=()=>({width});elements.get('elevationGraph').querySelector=()=>svg;
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {resizeElevationPanel};})()`,ctx);const graph=elements.get('elevationGraph');assert.match(graph.innerHTML,/viewBox="0 0 360 176"/);assert.match(graph.innerHTML,/preserveAspectRatio="xMidYMid meet"/);assert.match(graph.innerHTML,/linearGradient/);assert.match(graph.innerHTML,/profile-grid/);assert.match(graph.innerHTML,/Haut ·/);assert.match(graph.innerHTML,/>200 m<\/text>/);
 elements.get('elevationSeek').value='5559';elements.get('elevationSeek').oninput();const before=fake.markers.find(m=>!m.removed&&m.options.icon?.className==='elevation-map-cursor').coords;
 elements.get('profileExtrema').checked=true;elements.get('profileExtrema').onchange();assert.match(graph.innerHTML,/Haut · 350 m/);assert.match(graph.innerHTML,/Bas · 100 m/);assert.equal(line.values.visibility,'visible');width=700;access.resizeElevationPanel();assert.match(graph.innerHTML,/viewBox="0 0 700 196"/);assert.equal(line.values.visibility,'visible');assert.deepEqual(fake.markers.find(m=>!m.removed&&m.options.icon?.className==='elevation-map-cursor').coords,before);
});
test('réponses d’altitude ne redessinent pas la ligne simple ; changement de surface et de palette invalident le rendu',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan(),fake=interactiveMap(ctx);ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');return {drawSelection,altitude(){const leg=planDraft.legs[0];planDraft.analyse(leg.id,{...leg.analysis,elevation:{profile:[{at:0,altitude:200},{at:11119,altitude:400}]}});drawSelection();},surface(){const leg=planDraft.legs[0];planDraft.analyse(leg.id,{...leg.analysis,surfaceRuns:[{type:'Béton',unpaved:false,coordinates:leg.coordinates}]});drawSelection();}};})()`,ctx);const n=fake.lines.length;access.drawSelection();access.altitude();assert.equal(fake.lines.length,n);access.surface();assert.ok(fake.lines.length>n);const next=fake.lines.length;elements.get('planColorMode').value='slope';elements.get('planColorMode').onchange();assert.ok(fake.lines.length>next);assert.ok(fake.lines.some(l=>!l.removed&&l.options.weight===8&&l.options.color==='#53625c'));assert.ok(elements.get('legendContent').children.some(c=>c.children?.some(x=>x.textContent.includes('Descente'))));assert.ok(elements.get('legendContent').children.some(c=>c.children?.some(x=>x.textContent.includes('Montée'))));
});
test('la liste de passages du planificateur est construite uniquement lorsqu’elle est dépliée',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');$('editPlan').onclick();})()`,ctx);assert.equal(elements.get('waypointList').children.length,0);elements.get('waypointDetails').open=true;elements.get('waypointDetails').ontoggle();assert.equal(elements.get('waypointList').children.length,3);elements.get('waypointDetails').open=false;elements.get('waypointDetails').ontoggle();assert.equal(elements.get('waypointList').children.length,0);
});


test('onglet Carte commun : bibliothèques visibles en consultation et dessin, sortie conservée et clics libres',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');$('finishDrawing').onclick();return {state:()=>({view,ride:currentRide?.id,trace:trace.length,selected:selected.length}),drawCatalog};})()`,ctx);
 assert.equal(elements.has('savedTab'),false);assert.equal((html.match(/class="nav(?: active)?"/g)||[]).length,0);assert.equal(elements.get('rideChooser').hidden,false);assert.equal(elements.get('segmentBrowser').hidden,true);assert.equal(elements.get('editorPanel').hidden,true);assert.equal(elements.has('explore'),false);const before=access.state();
 elements.get('drawSegment').onclick();assert.equal(elements.get('editorPanel').hidden,false);assert.equal(elements.get('rideChooser').hidden,false);assert.equal(elements.get('segmentBrowser').hidden,true);assert.equal(access.state().ride,before.ride);assert.equal(access.state().trace,2);
 elements.get('finishDrawing').onclick();assert.equal(access.state().view,'saved');elements.get('finishDrawing').onclick();assert.equal(access.state().view,'saved');assert.equal(access.state().ride,before.ride);assert.equal(access.state().trace,2);assert.ok(fake.lines.some(l=>!l.removed&&l.options.pane==='gpxPane'));
 elements.get('showLoadedRide').checked=false;elements.get('showLoadedRide').onchange();assert.equal(fake.lines.filter(l=>!l.removed&&l.options.pane==='gpxPane').length,0);assert.equal(access.state().trace,2);
});

test('panneau carte unique : fonds WMS et relief opaque indépendant sans modifier le dessin',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,fake=interactiveMap(ctx);ctx.fetch=async(path,options)=>path==='/api/wms'?{ok:true,status:200,json:async()=>[{name:'Mon WMS',url:'https://example.org/wms',layers:'topo'}]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([50,5]);planDraft.append([50.01,5],'manual');syncPlanner();return {state:()=>JSON.stringify(planDraft.snapshot()),relief:hillshadeLayer};})()`,ctx),before=access.state();
 assert.equal(elements.get('baseMapSelect').children.length,5);assert.equal(elements.get('baseMapSelect').children[4].textContent,'Mon WMS');assert.equal(fake.map.hasLayer(access.relief),true);assert.equal(access.relief.options.pane,'reliefPane');
 elements.get('showHillshade').checked=true;elements.get('showHillshade').onchange();assert.equal(fake.map.hasLayer(access.relief),true);assert.equal(access.relief.options.opacity,1);assert.equal(elements.has('hillshadeTransparency'),false);
 elements.get('baseMapSelect').value='base-4';elements.get('baseMapSelect').onchange();assert.equal(fake.map.hasLayer(access.relief),true);assert.ok(fake.map.layers.some(l=>!l.removed&&l.url==='https://example.org/wms'));assert.equal(access.state(),before);
 access.relief.events.loading();access.relief.events.tileerror();assert.match(elements.get('hillshadeStatus').textContent,/indisponible/);assert.equal(access.state(),before);elements.get('showHillshade').checked=false;elements.get('showHillshade').onchange();assert.equal(fake.map.hasLayer(access.relief),false);assert.equal(elements.get('hillshadeStatus').textContent,'');
 for(const id of ['baseMapSelect','showHillshade','catalogFilters','planMapControls','legendContent'])assert.ok(html.indexOf('id="'+id+'"')>html.indexOf('id="segmentLegend"'));
});

test('enregistrement : consultation immédiate avec bornes, passages seulement après Modifier, sans nouvel appel altitude',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,p=profilePlan(),fake=interactiveMap(ctx);ctx.fetch=async(path,options={})=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:path==='/api/plans'?{ok:true,status:200,json:async()=>[p]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');$('editPlan').onclick();return {marks:()=>marks.layers.length,viewing:()=>planViewing};})()`,ctx);assert.ok(access.marks()>0);
 await elements.get('planForm').onsubmit({preventDefault(){}});assert.equal(access.viewing(),true);assert.equal(access.marks(),0);assert.equal(elements.get('planForm').hidden,true);assert.equal(elements.get('planViewActions').hidden,false);assert.ok(fake.markers.some(m=>!m.removed&&m.options.icon?.className==='kilometre-marker'));assert.equal(calls.filter(c=>c.path==='/api/plan-elevations').length,0);
 elements.get('editPlan').onclick();assert.equal(access.viewing(),false);assert.ok(access.marks()>0);assert.equal(fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='kilometre-marker').length,0);
});


test('survol des segments dans les deux onglets : attributs échappés, single track pointillé et clic de dessin transmis',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx),r={id:'segment',name:'Sentier <img onerror=alert(1)>',notes:'Racines & boue',isMine:true,isPublic:true,rating:2,difficulty:'Technique',surface:'Gravier fin',singleTrack:'yes',winter:'conditions',owner:'alice',distance:1111,coordinates:[[50,5],[50.01,5]]};
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {draw(v){setView(v);catalog=[${JSON.stringify(r)},{...${JSON.stringify(r)},id:'large',singleTrack:'no'}];drawCatalog();},state:()=>({view,editing:editingSegment?.id,points:planDraft.points.length}),setMode};})()`,ctx);
 for(const view of ['saved','explore','planner']){access.draw(view);const lines=fake.lines.filter(l=>!l.removed&&l.options.opacity===.9),line=lines[0];assert.equal(line.options.interactive,true);assert.equal(line.options.dashArray,'5 6');assert.equal(lines[1].options.dashArray,null);for(const text of ['Technicité','Technique','Gravier fin','2/5','Single track','Hiver selon conditions','alice','Racines &amp; boue'])assert.ok(line.tooltip.html.includes(text),text);assert.ok(line.tooltip.html.includes('&lt;img'));assert.ok(!line.tooltip.html.includes('<img'));if(view==='explore'){access.setMode('manual');line.events.click({latlng:{lat:50.005,lng:5}});assert.equal(access.state().editing,undefined);}if(view==='planner'){elements.get('manualLeg').checked=true;line.events.click({latlng:{lat:50.005,lng:5}});assert.equal(access.state().points,1);}}
 assert.equal(elements.has('singleTrackFilter'),false);assert.equal(elements.has('plannerShowSegments'),false);assert.doesNotMatch(html,/<option value="singleTrack">/);assert.match(html,/Secteurs publics/);
});

test('recherche itinéraire et filtres combinés : pas de chargement, de modification du brouillon ni de recalcul d’altitude',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,p=profilePlan(),second={...profilePlan(),id:'other',name:'Boucle des crêtes',owner:'bob',isMine:false,distance:40000},fake=interactiveMap(ctx);let visible=true;fake.map.getBounds=()=>({contains:point=>visible&&point[0]===50});ctx.fetch=async(path,options)=>path==='/api/plans'?{ok:true,status:200,json:async()=>[p,second]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([49,4]);planDraft.append([49.01,4],'manual');syncPlanner();await refreshPlans();return {state:()=>JSON.stringify(planDraft.snapshot())};})()`,ctx),before=access.state();
 elements.get('planScope').value='all';elements.get('planScope').onchange();elements.get('planSearch').value='cretes BOB';elements.get('planSearch').oninput();assert.equal(elements.get('planSelect').children.length,2);assert.equal(elements.get('planSelect').children[1].value,'other');elements.get('planDistanceMax').value='30';elements.get('planDistanceMax').oninput();assert.equal(elements.get('planSelect').children.length,1);elements.get('resetPlanFilters').onclick();
 elements.get('planAscentMin').value='200';elements.get('planAscentMin').oninput();assert.equal(elements.get('planSelect').children.length,2);elements.get('planAscentMax').value='100';elements.get('planAscentMax').oninput();assert.equal(elements.get('planAscentMax').value,'200');assert.equal(elements.get('planSelect').children.length,1);elements.get('resetPlanFilters').onclick();elements.get('planMapFilter').value='start';elements.get('planMapFilter').onchange();assert.equal(elements.get('planSelect').children.length,2);visible=false;fake.events['zoomend moveend']();assert.equal(elements.get('planSelect').children.length,1);assert.equal(access.state(),before);assert.equal(calls.filter(c=>/^\/api\/(?:plans\/|plan-elevations)/.test(c.path)).length,0);
 assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);elements.get('sidebarToggle').onclick();assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),false);elements.get('sidebarToggle').onclick();assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);assert.equal(access.state(),before);
});


test('éditeur : formulaire au début et nouvel itinéraire annulable même avant le premier point',async()=>{
 const {ctx,elements}=context();await vm.runInNewContext(`(async()=>{${script}\nnewPlan();$('planName').value='Boucle à préparer';$('planNotes').value='Parking nord';$('reset').onclick();})()`,ctx);assert.equal(elements.get('planName').value,'');assert.equal(elements.get('planNotes').value,'');assert.equal(elements.get('reset').disabled,false);assert.ok(html.match(/id="reset"[^>]*class="map-tool-button"/));elements.get('undoPlan').onclick();assert.equal(elements.get('planName').value,'Boucle à préparer');assert.equal(elements.get('planNotes').value,'Parking nord');assert.ok(html.indexOf('id="planForm"')<html.indexOf('id="status"'));assert.ok(html.indexOf('id="savePlan"')<html.indexOf('id="plannerTools"'));assert.equal(elements.has('export'),false);assert.equal(elements.has('toggleSidebar'),false);assert.equal(elements.has('collapseSidebar'),false);assert.match(html,/id="sidebarToggle"[^>]*aria-expanded/);
});
test('curseurs min/max : bornes adaptées aux parcours, poignées sans croisement et réinitialisation sans perdre le tracé',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options)=>path==='/api/plans'?{ok:true,status:200,json:async()=>[p,{...p,id:'unknown',legs:[]}]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([49,4]);await refreshPlans();return {state:()=>JSON.stringify(planDraft.snapshot())};})()`,ctx),before=access.state();assert.equal(elements.get('planDistanceMax').max,'30');assert.equal(elements.get('planAscentMax').max,'500');assert.equal(elements.get('planSelect').children.length,3);
 elements.get('planAscentMin').value='100';elements.get('planAscentMin').oninput();assert.equal(elements.get('planSelect').children.length,2);elements.get('planAscentMax').value='50';elements.get('planAscentMax').oninput();assert.equal(elements.get('planAscentMax').value,'100');elements.get('planAscentMin').value='400';elements.get('planAscentMin').oninput();assert.equal(elements.get('planAscentMin').value,'100');assert.equal(elements.get('planAscentValue').textContent,'100–100 m');elements.get('resetPlanFilters').onclick();assert.equal(elements.get('planAscentMin').value,'0');assert.equal(elements.get('planAscentMax').value,'500');assert.equal(elements.get('planSelect').children.length,3);assert.equal(access.state(),before);for(const id of ['planDistanceMin','planDistanceMax','planAscentMin','planAscentMax'])assert.match(html,new RegExp('id="'+id+'" type="range"'));
});
test('export du compte : téléchargement complet, messages d’échec et réactivation du bouton',async()=>{
 const accountHTML=await readFile(new URL('../dist/account.html',import.meta.url),'utf8'),accountScript=(await readFile(new URL('../dist/account.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,''),elements=new Map([...accountHTML.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()])),urls=[],revoked=[],links=[],document={body:element(),createElement:()=>{const el=element();links.push(el);return el;}},ctx={$:id=>elements.get(id),api:async path=>path==='/api/me'?{username:'alice'}:path==='/api/strava/status'?{configured:false,connected:false}:[],post:async()=>{},message(){},button(){},document,location:{replace(){}},fetch:async()=>({ok:true,status:200,blob:async()=>new Blob(['{"rides":[],"segments":{}}'])}),URL:{createObjectURL(blob){urls.push(blob);return 'blob:export';},revokeObjectURL:url=>revoked.push(url)},setTimeout:fn=>fn()};
 await vm.runInNewContext(`(async()=>{${accountScript}})()`,ctx);await elements.get('exportAccount').onclick();assert.equal(urls.length,1);assert.match(links[0].download,/^sillage-donnees-.*\.json$/);assert.equal(links[0].href,'blob:export');assert.deepEqual(revoked,['blob:export']);assert.equal(elements.get('exportAccount').disabled,false);assert.match(elements.get('exportStatus').textContent,/téléchargement/);ctx.fetch=async()=>({ok:false,status:500,json:async()=>({error:'Export temporairement indisponible.'})});await elements.get('exportAccount').onclick();assert.equal(urls.length,1);assert.equal(elements.get('exportAccount').disabled,false);assert.match(elements.get('exportStatus').textContent,/temporairement/);
});

test('carte sans bandeau : relief et extrema activés par défaut, commandes pictographiques et choix conservés entre onglets',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx),access=await vm.runInNewContext(`(async()=>{${script}\nreturn {relief:hillshadeLayer,setView};})()`,ctx);assert.equal(elements.get('showHillshade').checked,true);assert.equal(fake.map.hasLayer(access.relief),true);assert.equal(elements.get('profileExtrema').checked,true);assert.ok(!html.includes('class="maphead"'));assert.match(html,/id="fit"[^>]*aria-label="Recentrer la carte"/);assert.match(html,/id="fullscreenMap"[^>]*aria-label="Afficher la carte en plein écran"/);
 elements.get('showHillshade').checked=false;elements.get('showHillshade').onchange();elements.get('profileExtrema').checked=false;access.setView('planner');access.setView('saved');assert.equal(fake.map.hasLayer(access.relief),false);assert.equal(elements.get('profileExtrema').checked,false);
});

test('segments : les points prolongent la fin, seules les nouvelles portions sont routées, undo/redo et correction locale persistée',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch;ctx.fetch=async(path,options={})=>{if(path==='/api/route'){calls.push({path,options});const points=JSON.parse(options.body).points;return {ok:true,status:200,json:async()=>({coordinates:points,stats:{maxOffset:0,ignoredAnchors:0}})};}if(path==='/api/osm')return {ok:false,status:503,json:async()=>({error:'indisponible'})};return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();return {choose,openPointSettings,removeDraftPoint,state:()=>({points:JSON.stringify(planDraft.points),legs:JSON.stringify(planDraft.serialise()),coords:JSON.stringify(selected)}),rate(){rating=4;update();}};})()`,ctx);
 access.choose({lat:50,lng:5});access.choose({lat:50.01,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));const first=JSON.parse(access.state().legs)[0];access.choose({lat:50.02,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(access.state().points),[[50,5],[50.01,5],[50.02,5]]);assert.deepEqual(JSON.parse(access.state().legs)[0],first);assert.deepEqual(JSON.parse(calls.filter(c=>c.path==='/api/route').at(-1).options.body).points,[[50.01,5],[50.02,5]]);
 elements.get('undoPlan').onclick();assert.equal(JSON.parse(access.state().points).length,2);elements.get('redoPlan').onclick();assert.equal(JSON.parse(access.state().points).length,3);access.openPointSettings(2);elements.get('pointIncomingManual').checked=true;elements.get('pointIncomingManual').onchange();assert.equal(JSON.parse(access.state().legs)[1].mode,'manual');const before=calls.filter(c=>c.path==='/api/route').length;elements.get('manualLeg').checked=true;access.choose({lat:50.021,lng:5.001});flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(access.state().points).length,4);assert.equal(calls.filter(c=>c.path==='/api/route').length,before);access.rate();elements.get('surface').value='Gravier fin';elements.get('difficulty').value='Facile';elements.get('winter').value='yes';elements.get('singleTrack').value='yes';await elements.get('ratingForm').onsubmit({preventDefault(){}});const saved=JSON.parse(calls.find(c=>c.path==='/api/portions'&&c.options.method==='POST').options.body);assert.equal(saved.routePoints.length,4);assert.deepEqual(saved.legs.map(l=>l.mode),['route','manual','manual']);
});
test('points sélectionnés : repère visible, suppression des extrémités et des passages annulable, routage limité à la jonction',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch,p=profilePlan(),fake=interactiveMap(ctx);ctx.fetch=async(path,options={})=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:path==='/api/route'?{ok:true,status:200,json:async()=>{calls.push({path,options});return {coordinates:JSON.parse(options.body).points,stats:{maxOffset:0,ignoredAnchors:0}};}}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');$('editPlan').onclick();return {openPointSettings,state:()=>JSON.stringify(planDraft.points)};})()`,ctx);assert.equal(ctx.document.body.classList.contains('sidebar-collapsed'),true);const before=access.state();access.openPointSettings(1);assert.ok(fake.markers.some(m=>!m.removed&&m.options.icon?.className.includes('route-selected')));elements.get('deletePoint').onclick();flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(access.state()).length,2);assert.equal(calls.filter(c=>c.path==='/api/route').length,1);elements.get('undoPlan').onclick();assert.equal(access.state(),before);access.openPointSettings(0);assert.equal(elements.get('pointIncomingManual').disabled,true);elements.get('deletePoint').onclick();assert.deepEqual(JSON.parse(access.state()),p.routePoints.slice(1));elements.get('undoPlan').onclick();access.openPointSettings(2);elements.get('deletePoint').onclick();assert.deepEqual(JSON.parse(access.state()),p.routePoints.slice(0,2));elements.get('undoPlan').onclick();assert.equal(access.state(),before);
});
test('surfaces : pourcentage non asphalté compact, détail replié à l’ouverture et aides dans une icône',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan();ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);elements.get('surfaceDetails').open=true;await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');})()`,ctx);assert.equal(elements.get('surfaceDetails').open,false);assert.equal(elements.get('planUnpaved').textContent,'100 % non asphalté');assert.ok(elements.get('planSurfaces').children.length>0);assert.ok(html.indexOf('id="undoPlan"')<html.indexOf('id="editorPanel"'));assert.ok(html.indexOf('Ajoutez les étapes par clics successifs')<html.indexOf('id="editorPanel"'));assert.match(html,/id="drawingHelp"[^>]*><summary[^>]*aria-label="Aide au tracé"/);
});

test('segments : un seul tracé incrémental, correction locale disponible dès le départ et anciens manuels conservés',async()=>{
 const {ctx,elements,calls,flushTimers}=context(),base=ctx.fetch;
 ctx.fetch=async(path,options={})=>path==='/api/plan-metrics'?{ok:true,status:200,json:async()=>({surfaces:[],surfaceRuns:[],errors:[]})}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();return {choose,showSegment,state:()=>({mode,points:JSON.stringify(planDraft.points),legs:JSON.stringify(planDraft.serialise())})};})()`,ctx);
 for(const id of ['modeControls','routeMode','autoMode','manualMode'])assert.equal(elements.has(id),false);
 assert.equal(elements.get('plannerTools').hidden,false);assert.equal(elements.get('manualLegControls').hidden,false);assert.equal(elements.get('toleranceControls').hidden,true);
 elements.get('manualLeg').checked=true;access.choose({lat:50,lng:5});access.choose({lat:50.01,lng:5});access.choose({lat:50.02,lng:5});flushTimers(150);await new Promise(r=>setImmediate(r));assert.equal(access.state().mode,'route');assert.deepEqual(JSON.parse(access.state().legs).map(l=>l.mode),['manual','manual']);assert.equal(calls.filter(c=>c.path==='/api/route').length,0);
 const path=[[50,5],[50.001,5.001],[50.002,5]];access.showSegment({id:'old',isMine:true,isPublic:false,name:'Ancien manuel',rating:4,surface:'Sable',difficulty:'Facile',winter:'yes',mode:'manual',snapped:false,coordinates:path});assert.equal(access.state().mode,'route');assert.deepEqual(JSON.parse(access.state().legs).flatMap((l,i)=>i?l.coordinates.slice(1):l.coordinates),path);assert.ok(JSON.parse(access.state().legs).every(l=>l.mode==='manual'));assert.equal(calls.filter(c=>c.path==='/api/route').length,0);
});

test('surface inconnue renvoyée au premier routage : enrichissement sans déplacer le tracé, avec profil d’altitude du secteur',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;
 ctx.fetch=async(path,options={})=>{
  if(path==='/api/route'){calls.push({path,options});const points=JSON.parse(options.body).points;return {ok:true,status:200,json:async()=>({coordinates:points,analysis:{surfaceVersion:2,surfaces:[{type:'Inconnu',distance:1112}],surfaceRuns:[{type:'Inconnu',unpaved:null,coordinates:points}],errors:[]}})};}
  if(path==='/api/plan-metrics'){calls.push({path,options});return {ok:true,status:200,json:async()=>({surfaceVersion:2,surfaces:[{type:'Gravier',distance:1112}],surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:JSON.parse(options.body).coordinates}],errors:[]})};}
  return base(path,options);
 };
 const result=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();choose({lat:50,lng:5});choose({lat:50.01,lng:5});await calculatePlanLegs();const before=JSON.stringify(selected);await analysePlanLegs();return {before,after:JSON.stringify(selected),types:planDraft.legs[0].analysis.surfaces.map(s=>s.type)};})()`,ctx);
 assert.equal(result.before,result.after);assert.ok(result.types.includes('Gravier'));assert.equal(elements.get('surface').value,'Gravier fin');assert.match(elements.get('surfaceSource').textContent,/Suggestion OSM/);assert.equal(calls.filter(c=>c.path==='/api/route').length,1);assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,1);assert.equal(calls.filter(c=>c.path==='/api/plan-elevations').length,1);
});

test('surface indisponible : une seule relance automatique et pas de boucle sur OSM non renseigné',async()=>{
 const {ctx,calls,flushTimers}=context(),base=ctx.fetch;let fail=true;
 ctx.fetch=async(path,options={})=>{
  if(path==='/api/plan-metrics'){calls.push({path,options});return fail?{ok:false,status:503,json:async()=>({error:'offline'})}:{ok:true,status:200,json:async()=>({surfaces:[{type:'Inconnu',distance:1112}],surfaceRuns:[{type:'Inconnu',unpaved:null,coordinates:JSON.parse(options.body).coordinates}],errors:[]})};}
  return base(path,options);
 };
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();$('manualLeg').checked=true;choose({lat:50,lng:5});choose({lat:50.01,lng:5});await calculatePlanLegs();await analysePlanLegs();return {analysePlanLegs,state:()=>JSON.stringify(selected)};})()`,ctx),before=access.state();assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,1);
 fail=false;flushTimers(65000);await new Promise(r=>setImmediate(r));await access.analysePlanLegs();assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,2);assert.equal(access.state(),before);flushTimers(65000);await new Promise(r=>setImmediate(r));await access.analysePlanLegs();assert.equal(calls.filter(c=>c.path==='/api/plan-metrics').length,2);assert.equal(calls.filter(c=>c.path==='/api/route').length,0);
});

test('enrichir les surfaces inconnues préserve les portions connues et le profil enregistré',async()=>{
 const {ctx}=context(),access=await vm.runInNewContext(`(async()=>{${script}\nreturn {mergeSurfaceResult};})()`,ctx),path=[[50,5],[50.005,5],[50.01,5]],total=routeLength(path),elevation={profile:[{at:0,altitude:100},{at:total,altitude:200}]},previous={surfaceVersion:2,elevation,surfaces:[{type:'Asphalte / bitume',distance:total/2},{type:'Inconnu',distance:total/2}],surfaceRuns:[{type:'Asphalte / bitume',unpaved:false,coordinates:path.slice(0,2)},{type:'Inconnu',unpaved:null,coordinates:path.slice(1)}],accessRuns:[{label:'Accès privé',coordinates:path.slice(1)}]},incoming={surfaceVersion:2,surfaces:[{type:'Gravier',distance:total}],surfaceRuns:[{type:'Gravier',unpaved:true,coordinates:path}],errors:[]};
 const merged=access.mergeSurfaceResult({coordinates:path,analysis:previous},incoming);assert.equal(merged.elevation,elevation);assert.deepEqual(Array.from(merged.surfaceRuns,r=>r.type),['Asphalte / bitume','Gravier']);assert.ok(Math.abs(merged.surfaces.reduce((n,s)=>n+s.distance,0)-total)<.001);assert.deepEqual(merged.accessRuns,previous.accessRuns);assert.deepEqual(merged.surfaceRuns[0].coordinates[0],path[0]);assert.deepEqual(merged.surfaceRuns.at(-1).coordinates.at(-1),path.at(-1));
 const failed=access.mergeSurfaceResult({coordinates:path,analysis:merged},{errors:['Revêtements OSM indisponibles.']});assert.equal(failed.surfaceRuns,merged.surfaceRuns);assert.equal(failed.elevation,elevation);assert.ok(failed.errors.length);
});

test('enregistrement d’un segment attend la suggestion de surface et refuse un changement de géométrie pendant l’analyse',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;let release;
 ctx.fetch=async(path,options={})=>{
  if(path==='/api/plan-metrics')return new Promise(r=>release=()=>r({ok:true,status:200,json:async()=>({surfaces:[{type:'Sable',distance:1112}],surfaceRuns:[{type:'Sable',unpaved:true,coordinates:JSON.parse(options.body).coordinates}],errors:[]})}));
  return base(path,options);
 };
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();$('manualLeg').checked=true;choose({lat:50,lng:5});choose({lat:50.01,lng:5});await calculatePlanLegs();rating=4;update();return {start:async()=>{$('manualLeg').checked=true;choose({lat:50.02,lng:5});choose({lat:50.03,lng:5});await calculatePlanLegs();rating=4;update();}};})()`,ctx);
 elements.get('difficulty').value='Facile';elements.get('winter').value='yes';elements.get('singleTrack').value='no';const saving=elements.get('ratingForm').onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(elements.get('save').disabled,true);assert.equal(calls.filter(c=>c.path==='/api/portions'&&c.options.method==='POST').length,0);release();await saving;const saved=JSON.parse(calls.find(c=>c.path==='/api/portions'&&c.options.method==='POST').options.body);assert.equal(saved.surface,'Sable');assert.deepEqual(saved.legs.map(l=>l.mode),['manual']);
 await access.start();
 const second=elements.get('ratingForm').onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));elements.get('reset').onclick();release();await second;assert.equal(calls.filter(c=>c.path==='/api/portions'&&c.options.method==='POST').length,1);assert.match(elements.get('toast').textContent,/tracé a changé/);
});

test('profil tactile : le geste vertical peut défiler dans la page avec le profil déplié',async()=>{
 const {ctx,elements}=context(),p=profilePlan(),base=ctx.fetch;const handlers={},options={};let captured=0;
 const attrs=()=>({setAttribute(){}}),svg={getBoundingClientRect:()=>({left:0,width:390}),querySelector:()=>attrs(),setPointerCapture(){captured++;},addEventListener(name,handler,opts){handlers[name]=handler;options[name]=opts;}};elements.get('elevationGraph').querySelector=()=>svg;ctx.fetch=async(path,opts)=>path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,opts);
 await vm.runInNewContext(`(async()=>{${script}\nawait loadPlan('${p.id}');})()`,ctx);handlers.pointerdown({clientX:120,pointerType:'touch',pointerId:1});handlers.pointermove({clientX:130,pointerType:'touch',pointerId:1});assert.equal(captured,0);assert.equal(options.pointerdown.passive,true);assert.equal(options.pointermove.passive,true);
 const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8'),mobile=css.slice(css.indexOf('@media(max-width:850px)'));assert.match(mobile,/\.elevation-panel\{[^}]*overflow:visible;overscroll-behavior:auto;touch-action:pan-y/);assert.match(elements.get('elevationReadout').textContent,/km/);
});

test('surface : une réponse de l’ancienne géométrie ne remplace pas le résultat après déplacement manuel',async()=>{
 const {ctx,calls}=context(),base=ctx.fetch;let release,number=0;
 ctx.fetch=async(path,options={})=>{
  if(path==='/api/plan-metrics'){calls.push({path,options});const coordinates=JSON.parse(options.body).coordinates,answer=type=>({ok:true,status:200,json:async()=>({surfaces:[{type,distance:routeLength(coordinates)}],surfaceRuns:[{type,unpaved:true,coordinates}],errors:[]})});if(++number===1)return new Promise(r=>release=()=>r(answer('Sable')));return answer('Gravier');}
  return base(path,options);
 };
 const access=await vm.runInNewContext(`(async()=>{${script}\n$('drawSegment').onclick();$('manualLeg').checked=true;choose({lat:50,lng:5});choose({lat:50.01,lng:5});await calculatePlanLegs();return {analysePlanLegs,moveRouteControl,state:()=>JSON.stringify(planDraft.serialise())};})()`,ctx);
 const pending=access.analysePlanLegs();await new Promise(r=>setImmediate(r));await access.moveRouteControl(1,[50.02,5]);release();await pending;const legs=JSON.parse(access.state());assert.equal(legs[0].mode,'manual');assert.deepEqual(legs[0].coordinates.at(-1),[50.02,5]);assert.equal(legs[0].analysis.surfaces[0].type,'Gravier');assert.deepEqual(legs[0].analysis.surfaceRuns.at(-1).coordinates.at(-1),[50.02,5]);assert.equal(calls.filter(c=>c.path==='/api/route').length,0);assert.equal(number,2);
});

test('profil d’un secteur enregistré personnel ou public : graphe, curseur et aucune nouvelle altitude',async()=>{
 for(const mine of [true,false]){
  const {ctx,elements,calls}=context(),fake=interactiveMap(ctx),p=profilePlan(),sector={...p,isMine:mine,isPublic:true,owner:'alice',rating:4,surface:'Gravier fin',difficulty:'Facile',winter:'yes',mode:'route',snapped:true};
  const access=await vm.runInNewContext(`(async()=>{${script}\nshowSegment(${JSON.stringify(sector)});await analysePlanLegs();return {reset,update};})()`,ctx);
  assert.equal(elements.get('elevationPanel').hidden,false);assert.match(elements.get('elevationGraph').innerHTML,/elevation-chart/);assert.match(elements.get('profileSummary').textContent,/D\+/);assert.equal(calls.filter(c=>c.path==='/api/plan-elevations').length,0);assert.equal(calls.filter(c=>c.path==='/api/route').length,0);
  elements.get('elevationSeek').value='1000';elements.get('elevationSeek').oninput();assert.ok(fake.markers.some(m=>!m.removed&&m.options.icon?.className==='elevation-map-cursor'));assert.match(elements.get('elevationReadout').textContent,/1.00 km/);elements.get('profileExtrema').checked=false;elements.get('profileExtrema').onchange();access.reset();access.update();assert.equal(fake.markers.filter(m=>!m.removed&&m.options.icon?.className==='elevation-map-cursor').length,0);
  if(!mine)assert.equal(elements.get('elevationPanel').hidden,true);
 }
});

test('ancien secteur : calcul des seules altitudes manquantes, réponse obsolète ignorée',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;let release;
 ctx.fetch=async(path,options)=>{if(path==='/api/plan-elevations'){calls.push({path,options});return new Promise(r=>release=()=>r({ok:true,status:200,json:async()=>[{elevation:{ascent:50,descent:0,profile:[{at:0,altitude:100},{at:1112,altitude:150}]}}]}));}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nshowSegment({id:'legacy',name:'Ancien',isMine:false,owner:'bob',rating:4,surface:'Sable',coordinates:[[50,5],[50.01,5]]});return {analysePlanLegs,reset,update,state:()=>JSON.stringify(planDraft.serialise())};})()`,ctx);
 const job=access.analysePlanLegs();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.path==='/api/plan-elevations').length,1);assert.equal(calls.filter(c=>c.path==='/api/route').length,0);access.reset();access.update();release();await job;assert.equal(access.state(),'[]');assert.equal(elements.get('elevationPanel').hidden,true);
});

test('secteur public : altitude indisponible puis relance explicite depuis le profil',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;let attempts=0;
 ctx.fetch=async(path,options)=>{if(path==='/api/plan-elevations'){attempts++;calls.push({path,options});return {ok:true,status:200,json:async()=>attempts===1?[{elevation:null,error:'Altitudes indisponibles.'}]:[{elevation:{ascent:50,descent:0,profile:[{at:0,altitude:100},{at:1111,altitude:150}]}}]};}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nshowSegment({id:'public',name:'Public',isMine:false,owner:'bob',rating:4,surface:'Sable',coordinates:[[50,5],[50.01,5]]});await analysePlanLegs();return {analysePlanLegs};})()`,ctx);
 assert.equal(elements.get('retryProfile').hidden,false);elements.get('retryProfile').onclick();await access.analysePlanLegs();assert.equal(attempts,2);assert.equal(JSON.parse(calls.at(-1).options.body).retry,true);assert.equal(elements.get('retryProfile').hidden,true);assert.match(elements.get('profileSummary').textContent,/D\+/);assert.equal(calls.some(c=>['POST','PATCH'].includes(c.options.method)&&c.path.startsWith('/api/portions')),false);
});

test('carte unique : bibliothèque indépendante du dessin et recherche dans les trois catégories',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan(),ride={id:'ride1',name:'Sortie des crêtes',distance:15000,source_type:'gpx',start_point:[50,5],end_point:[50.01,5]},sector={id:'sector1',name:'Secteur des crêtes',notes:'Racines',owner:'bob',isMine:false,isPublic:true,rating:4,surface:'Sable',distance:1112,coordinates:[[50,5],[50.01,5]]};
 ctx.fetch=async(path,options)=>['/api/plans','/api/rides','/api/catalog'].includes(path)?{ok:true,status:200,json:async()=>path==='/api/plans'?[{...p,name:'Boucle des crêtes'}]:path==='/api/rides'?[ride]:[sector]}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([50,5]);planDraft.append([50.01,5],'manual');syncPlanner();return {state:()=>JSON.stringify({view,points:planDraft.points,legs:planDraft.serialise()})};})()`,ctx),before=access.state();
 assert.equal(elements.has('plannerTab'),false);assert.equal((html.match(/class="nav(?: active)?"/g)||[]).length,0);assert.equal(elements.get('drawSegment').hidden,false);assert.equal(elements.get('reset').hidden,false);
 elements.get('planSearch').value='cretes';elements.get('planSearch').oninput();assert.equal(elements.get('planSelect').children.length,2);
 elements.get('planScope').value='all';elements.get('planScope').onchange();elements.get('libraryType').value='segments';elements.get('libraryType').onchange();assert.equal(elements.get('segmentBrowser').hidden,false);assert.equal(elements.get('planLibrary').hidden,true);assert.equal(elements.get('segmentSelect').children.length,1);assert.match(elements.get('planFilterStatus').textContent,/1 secteur/);
 elements.get('planSearch').value='racines';elements.get('planSearch').oninput();assert.equal(elements.get('segmentSelect').children.length,1);elements.get('planSearch').value='absent';elements.get('planSearch').oninput();assert.match(elements.get('segmentSelect').children[0].textContent,/Aucun secteur/);
 elements.get('planSearch').value='cretes';elements.get('libraryType').value='rides';elements.get('libraryType').onchange();assert.equal(elements.get('rideChooser').hidden,false);assert.equal(elements.get('planScope').hidden,true);assert.equal(elements.get('rideSelect').children.length,2);assert.equal(access.state(),before);assert.equal(elements.get('planForm').hidden,false);assert.equal(elements.get('ratingForm').hidden,true);
 elements.get('planDistanceMin').value='20';elements.get('planDistanceMin').oninput();assert.equal(elements.get('rideSelect').children.length,1);elements.get('resetPlanFilters').onclick();assert.equal(elements.get('rideSelect').children.length,2);assert.equal(access.state(),before);
});

test('outils communs : sortie en repère, création explicite de chaque type et formulaire adapté',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx);
 const access=await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');return {state:()=>({view,trace:trace.length,map,current:currentRide?.id})};})()`,ctx);
 assert.equal(elements.get('editorPanel').hidden,true);const map=access.state().map;elements.get('reset').onclick();assert.equal(access.state().view,'planner');assert.equal(elements.get('planForm').hidden,false);assert.equal(elements.get('ratingForm').hidden,true);assert.equal(access.state().trace,2);assert.ok(fake.lines.some(l=>!l.removed&&l.options.pane==='gpxPane'));
 elements.get('drawSegment').onclick();assert.equal(access.state().view,'explore');assert.equal(access.state().map,map);assert.equal(elements.get('planForm').hidden,true);assert.equal(elements.get('ratingForm').hidden,false);assert.equal(elements.get('plannerTools').hidden,false);assert.equal(elements.get('manualLeg').checked,false);assert.equal(elements.get('elevationPanel').hidden,false);elements.get('finishDrawing').onclick();assert.equal(elements.get('editorPanel').hidden,true);assert.equal(access.state().trace,2);
});

test('filtres de zone : métadonnées de sorties et aperçu Strava sans télécharger les traces',()=>{
 const bounds={contains:p=>p[0]===50},ride={name:'GPX',distance:12000,start_point:[50,5],end_point:[51,5]},remote={name:'Strava',distance:20000,preview:[[51,5],[50,5]]};
 assert.deepEqual(filterPlans([ride,remote],{bounds,mapFilter:'start'}),[ride]);assert.deepEqual(filterPlans([ride,remote],{bounds,mapFilter:'end'}),[remote]);assert.deepEqual(filterPlans([ride,remote],{ascentMin:100}),[]);
});

test('une consultation de secteur remplace un itinéraire public et invalide son chargement tardif',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan({mine:false});let release;
 ctx.fetch=async(path,options)=>path==='/api/plans/'+p.id?new Promise(r=>release=()=>r({ok:true,status:200,json:async()=>p})):base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {loadPlan,showSegment,state:()=>({view,readOnly:planReadOnly,editing:editingSegment?.id,selected:JSON.stringify(selected)})};})()`,ctx);
 const loading=access.loadPlan(p.id);await new Promise(r=>setImmediate(r));const sector={id:'mine',name:'Mon secteur',isMine:true,isPublic:true,rating:4,surface:'Sable',difficulty:'Facile',coordinates:[[50,5],[50.01,5]],mode:'route',snapped:true};access.showSegment(sector);release();await loading;
 assert.equal(access.state().view,'explore');assert.equal(access.state().editing,'mine');assert.equal(access.state().selected,JSON.stringify(sector.coordinates));assert.equal(elements.get('manualLeg').disabled,false);
});

test('bibliothèque : recherche dans les activités Strava chargées sans appel API à chaque saisie',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,activities=[{id:'1',name:'Gravel des crêtes',distance:20000,startDate:'2026-01-01',preview:[[50,5],[50.1,5]]},{id:'2',name:'Sortie en ville',distance:10000,startDate:'2026-01-02',preview:[[51,5],[51.1,5]]}];
 ctx.fetch=async(path,options)=>path==='/api/strava/status'?{ok:true,status:200,json:async()=>({connected:true,configured:true})}:path.startsWith('/api/strava/activities')?{ok:true,status:200,json:async()=>{calls.push({path,options:{}});return {activities,page:1,hasMore:false};}}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}\n$('libraryType').value='rides';$('rideSource').value='strava';await changeRideSource();})()`,ctx);const requests=calls.filter(c=>c.path.startsWith('/api/strava/activities')).length;
 elements.get('planSearch').value='cretes';elements.get('planSearch').oninput();assert.equal(elements.get('stravaRideSelect').children.length,2);assert.equal(elements.get('stravaRideSelect').children[1].value,'1');assert.match(elements.get('planFilterStatus').textContent,/1 sortie/);
 elements.get('planSearch').value='absent';elements.get('planSearch').oninput();assert.equal(elements.get('stravaRideSelect').children.length,1);assert.equal(calls.filter(c=>c.path.startsWith('/api/strava/activities')).length,requests);
});

test('atlas : recherche personnelle par défaut, choix public explicite et réinitialisation personnelle',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,own=profilePlan(),other={...profilePlan({mine:false}),id:'public-plan'},sectors=[{id:'own-sector',isMine:true,isPublic:false,name:'Personnel',rating:4,surface:'Sable',coordinates:[[50,5],[50.01,5]]},{id:'public-sector',isMine:false,isPublic:true,name:'Public',owner:'bob',rating:4,surface:'Sable',coordinates:[[50,5],[50.01,5]]}];
 ctx.fetch=async(path,options)=>path==='/api/plans'?{ok:true,status:200,json:async()=>[own,other]}:path==='/api/catalog'?{ok:true,status:200,json:async()=>sectors}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);assert.equal(elements.get('planScope').value,'mine');assert.equal(elements.get('planSelect').children.length,2);assert.equal(elements.get('planSelect').children[1].value,own.id);
 elements.get('libraryType').value='segments';elements.get('libraryType').onchange();assert.equal(elements.get('scopeMineOption').textContent,'Mes secteurs');assert.equal(elements.get('segmentSelect').children.length,1);assert.equal(elements.get('segmentSelect').children[0].value,'own-sector');
 elements.get('planScope').value='all';elements.get('planScope').onchange();assert.equal(elements.get('segmentSelect').children.length,2);elements.get('resetPlanFilters').onclick();assert.equal(elements.get('planScope').value,'mine');assert.equal(elements.get('segmentSelect').children.length,1);elements.get('libraryType').value='plans';elements.get('libraryType').onchange();assert.equal(elements.get('scopeMineOption').textContent,'Mes itinéraires');assert.equal(elements.get('planSelect').children.length,2);
});

test('création : seul le type en cours est actif ; consultation, enregistrement et édition restent neutres',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,p=profilePlan();
 ctx.fetch=async(path,options={})=>path==='/api/plans'&&options.method==='POST'?{ok:true,status:201,json:async()=>p}:path==='/api/plans'?{ok:true,status:200,json:async()=>[p]}:path==='/api/plans/'+p.id?{ok:true,status:200,json:async()=>p}:base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nreturn {newPlan,showSegment,loadPlan,prepare(){planDraft.load(${JSON.stringify(p)});editingPlan=null;planReadOnly=false;planViewing=false;$('planName').value='Nouveau';syncPlanner();}};})()`,ctx);
 const active=id=>elements.get(id).classList.contains('is-creating');assert.equal(active('reset'),false);assert.equal(active('drawSegment'),false);elements.get('reset').onclick();assert.equal(active('reset'),true);assert.equal(active('drawSegment'),false);assert.equal(elements.get('reset').getAttribute('aria-pressed'),'true');
 elements.get('drawSegment').onclick();assert.equal(active('drawSegment'),true);assert.equal(active('reset'),false);access.showSegment({id:'existing',isMine:true,isPublic:true,name:'Existant',rating:4,surface:'Sable',difficulty:'Facile',mode:'route',coordinates:[[50,5],[50.01,5]]});assert.equal(active('drawSegment'),false);
 access.newPlan();access.prepare();assert.equal(active('reset'),true);await elements.get('planForm').onsubmit({preventDefault(){}});assert.equal(active('reset'),false);assert.equal(active('drawSegment'),false);elements.get('editPlan').onclick();assert.equal(active('reset'),false);elements.get('reset').onclick();assert.equal(active('reset'),true);elements.get('finishDrawing').onclick();assert.equal(active('reset'),false);assert.equal(active('drawSegment'),false);
});

test('ajouts rapides : une file continue jusqu’au dernier point, avec l’arrivée réellement accrochée et sans recalculer le début',async()=>{
 const {ctx,flushTimers}=context(),base=ctx.fetch,jobs=[];
 ctx.fetch=(path,options)=>path==='/api/route'?new Promise(resolve=>jobs.push({points:JSON.parse(options.body).points,signal:options.signal,finish:coordinates=>resolve({ok:true,status:200,json:async()=>({coordinates:coordinates||JSON.parse(options.body).points,analysis:{surfaceVersion:2,surfaces:[{type:'Gravier',distance:1000}],surfaceRuns:[],errors:[]}})})})):base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});return {choose,calculatePlanLegs,state:()=>JSON.stringify({points:planDraft.points,legs:planDraft.serialise(),complete:planDraft.complete(),busy})};})()`,ctx);
 const first=access.calculatePlanLegs();await new Promise(r=>setImmediate(r));access.choose({lat:50.02,lng:5});access.choose({lat:50.03,lng:5});flushTimers(150);assert.equal(access.calculatePlanLegs(),first);assert.equal(jobs.length,1);assert.equal(jobs[0].signal.aborted,false);
 const snapped=[50.0101,5];jobs[0].finish([[50,5],snapped]);await new Promise(r=>setImmediate(r));assert.equal(jobs.length,2);assert.deepEqual(jobs[1].points,[snapped,[50.02,5]]);const original=JSON.parse(access.state()).legs[0];jobs[1].finish();await new Promise(r=>setImmediate(r));assert.equal(jobs.length,3);jobs[2].finish();await first;const state=JSON.parse(access.state());assert.equal(state.complete,true);assert.equal(state.busy,false);assert.equal(state.points.length,4);assert.deepEqual(state.legs[0],original);
});

test('étape impossible : les suivantes sont calculées, puis seule celle en échec est réessayée',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,calls=[];let fail=true;
 ctx.fetch=async(path,options)=>{if(path==='/api/route'){const points=JSON.parse(options.body).points;calls.push(points);return points[0][0]===50&&fail?{ok:false,status:422,json:async()=>({error:'Aucun passage autorisé'})}:{ok:true,status:200,json:async()=>({coordinates:points})};}return base(path,options);};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});choose({lat:50.02,lng:5});await calculatePlanLegs();return {calculatePlanLegs,state:()=>JSON.stringify({legs:planDraft.serialise(),complete:planDraft.complete(),busy})};})()`,ctx);
 let state=JSON.parse(access.state());assert.equal(calls.length,2);assert.equal(state.legs[0].coordinates,null);assert.ok(state.legs[1].coordinates);assert.equal(state.busy,false);assert.equal(elements.get('snapState').textContent,'À corriger');assert.match(elements.get('status').textContent,/étape 1 reste à corriger/);const done=state.legs[1];fail=false;await elements.get('retryPlanRoute').onclick();state=JSON.parse(access.state());assert.equal(state.complete,true);assert.equal(calls.length,3);assert.deepEqual(state.legs[1],done);
});

test('modification pendant le calcul : la requête périmée est abandonnée et remplacée sans attendre son résultat',async()=>{
 const {ctx}=context(),base=ctx.fetch,jobs=[];
 ctx.fetch=(path,options)=>path==='/api/route'?new Promise((resolve,reject)=>{const job={points:JSON.parse(options.body).points,signal:options.signal,finish:()=>resolve({ok:true,status:200,json:async()=>({coordinates:JSON.parse(options.body).points})})};jobs.push(job);options.signal.addEventListener('abort',()=>reject(Object.assign(Error('annulé'),{name:'AbortError'})));}):base(path,options);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});return {choose,calculatePlanLegs,removeDraftPoint,state:()=>JSON.stringify(planDraft.coordinates())};})()`,ctx);const task=access.calculatePlanLegs();await new Promise(r=>setImmediate(r));access.choose({lat:50.02,lng:5});access.removeDraftPoint(1);await new Promise(r=>setImmediate(r));assert.equal(jobs[0].signal.aborted,true);assert.equal(jobs.length,2);assert.deepEqual(jobs[1].points,[[50,5],[50.02,5]]);jobs[1].finish();await task;jobs[0].finish();await new Promise(r=>setImmediate(r));assert.equal(access.state(),'[[50,5],[50.02,5]]');
});

test('panne temporaire : points conservés et pause sans rafale, puis reprise explicite de toute la file',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;let offline='http',calls=0;
 ctx.fetch=async(path,options)=>{if(path!=='/api/route')return base(path,options);calls++;if(offline==='network')throw new TypeError('Failed to fetch');return offline?{ok:false,status:503,json:async()=>({error:'OSM indisponible'})}:{ok:true,status:200,json:async()=>({coordinates:JSON.parse(options.body).points})};};
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();choose({lat:50,lng:5});choose({lat:50.01,lng:5});choose({lat:50.02,lng:5});await calculatePlanLegs();return {choose,calculatePlanLegs,state:()=>({count:planDraft.points.length,complete:planDraft.complete(),busy})};})()`,ctx);assert.equal(calls,1);assert.equal(access.state().busy,false);access.choose({lat:50.03,lng:5});await access.calculatePlanLegs();assert.equal(calls,1);assert.equal(access.state().count,4);offline='network';await elements.get('retryPlanRoute').onclick();assert.equal(calls,2);assert.equal(access.state().busy,false);assert.match(elements.get('status').textContent,/ne répond pas correctement/);offline=false;await elements.get('retryPlanRoute').onclick();assert.equal(access.state().complete,true);assert.equal(calls,5);
});

test('clics réels sur départ/arrivée : menu, suppression, double-clic, clic droit et annulation',async()=>{
 const {ctx,elements}=context(),fake=interactiveMap(ctx);
 const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([50,5]);planDraft.append([50.01,5],'manual');planDraft.append([50.02,5],'manual');syncPlanner();return {markers:()=>routeMarkers,drawSelection,state:()=>JSON.stringify(planDraft.points)};})()`,ctx),original=access.state();
 const start=access.markers()[0];start.events.click({});access.drawSelection();assert.equal(access.markers()[0],start);assert.equal(start.removed,false);assert.equal(elements.get('pointSettingsTitle').textContent,'Départ');assert.equal(elements.get('pointIncomingManual').disabled,true);assert.equal(start.options.bubblingMouseEvents,false);elements.get('deletePoint').onclick();assert.equal(access.state(),'[[50.01,5],[50.02,5]]');elements.get('undoPlan').onclick();assert.equal(access.state(),original);
 let end=access.markers().at(-1);end.events.click({});assert.equal(end.removed,false);assert.equal(elements.get('pointSettingsTitle').textContent,'Arrivée');elements.get('deletePoint').onclick();assert.equal(access.state(),'[[50,5],[50.01,5]]');elements.get('undoPlan').onclick();end=access.markers().at(-1);end.events.click({});end.events.dblclick({});assert.equal(access.state(),'[[50,5],[50.01,5]]');elements.get('undoPlan').onclick();assert.equal(access.state(),original);access.markers()[0].events.contextmenu({});assert.equal(access.state(),'[[50.01,5],[50.02,5]]');elements.get('undoPlan').onclick();assert.equal(access.state(),original);
});

test('liste des points : départ et arrivée retirable même lorsque leurs marqueurs se superposent',async()=>{
 const {ctx,elements}=context();const access=await vm.runInNewContext(`(async()=>{${script}\nnewPlan();planDraft.append([50,5]);planDraft.append([50.01,5],'manual');planDraft.append([50,5],'manual');$('waypointDetails').open=true;syncPlanner();return {state:()=>JSON.stringify(planDraft.points)};})()`,ctx),original=access.state();
 const remove=index=>elements.get('waypointList').children[index].children.find(e=>e.textContent==='Retirer');assert.equal(remove(0).getAttribute('aria-label'),'Retirer le départ');assert.equal(remove(2).getAttribute('aria-label'),'Retirer l’arrivée');remove(0).onclick();assert.equal(access.state(),'[[50.01,5],[50,5]]');elements.get('undoPlan').onclick();assert.equal(access.state(),original);remove(2).onclick();assert.equal(access.state(),'[[50,5],[50.01,5]]');elements.get('undoPlan').onclick();assert.equal(access.state(),original);
});
