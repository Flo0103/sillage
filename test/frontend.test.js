import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds} from '../dist/geo.js';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,escapeHTML} from '../dist/catalog.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
function element(){const classes=new Set();return {style:{setProperty(){}},value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,children:[],classList:{toggle(c,value){const next=value??!classes.has(c);if(next)classes.add(c);else classes.delete(c);return next;},contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},setAttribute(){},removeAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},reset(){},remove(){},click(){}};}
function context({optionalMissing=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
 if(optionalMissing)for(const id of ['source','modeControls','legacyImport'])elements.delete(id);
 const points=[[50,5],[50.001,5]],ride={id:'00000000-0000-0000-0000-000000000001',name:'Ma sortie',coordinates:points,distance:111};
 const calls=[];
 const document={body:element(),addEventListener(){},getElementById:id=>elements.get(id)||null,createElement:()=>element(),createTextNode:text=>({textContent:text}),querySelector:()=>null};
 const fetch=async(path,options={})=>{calls.push({path,options});const data=path==='/api/me'?{username:'alice'}:['/api/portions','/api/catalog','/api/wms'].includes(path)?[]:path==='/api/rides'?options.method==='POST'?{id:ride.id}:[ride]:ride;return {ok:true,status:200,json:async()=>data};};
 const xml={querySelector:()=>null,getElementsByTagNameNS:(ns,tag)=>tag==='trkpt'?points.map(p=>({hasAttribute:()=>true,getAttribute:n=>n==='lat'?String(p[0]):String(p[1])})):[]};
 const ctx={document,fetch,distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds,visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,escapeHTML,location:{replace(){}},localStorage:{getItem:()=>null},AbortController,console,setTimeout:()=>1,clearTimeout(){},innerWidth:1200,Blob,URL,URLSearchParams,confirm:()=>true,DOMParser:class{parseFromString(){return xml;}}};
 return {elements,calls,ctx};
}
test('choix d’une sortie sauvegardée sans dépendre des contrôles facultatifs',async()=>{
 const {elements,ctx}=context({optionalMissing:true});
 await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');return {trace:trace.length,current:currentRide?.name};})()`,ctx).then(result=>{assert.equal(result.trace,2);assert.equal(result.current,'Ma sortie');});
 assert.equal(elements.get('mapSubtitle').textContent,'Ma sortie');assert.equal(elements.get('rideList').children.length,1);assert.equal(elements.get('rideList').hidden,false);
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
 const osm=tiles[0];assert.equal(osm.url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.equal(osm.options.referrerPolicy,'strict-origin-when-cross-origin');assert.ok(resized>0);assert.equal(tiles[2].url,'https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png');assert.equal(tiles[2].options.maxNativeZoom,17);assert.equal(tiles[2].options.minNativeZoom,7);
 osm.events.loading();osm.events.tileerror();osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,true);osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,false);assert.match(elements.get('mapNotice').textContent,/tuiles OSM/);assert.equal(elements.get('toast').textContent,'');
 active.delete(osm);events.baselayerchange();assert.equal(elements.get('mapNotice').hidden,true);osm.events.tileerror();assert.equal(elements.get('mapNotice').hidden,true);
 const ign=tiles[2];active.add(ign);ign.events.loading();ign.events.tileerror();assert.equal(elements.get('mapNotice').hidden,false);assert.match(elements.get('mapNotice').textContent,/IGN/);ign.events.load();assert.equal(elements.get('mapNotice').hidden,false);ign.events.loading();ign.events.load();assert.equal(elements.get('mapNotice').hidden,true);
});

test('la carte initiale ne charge pas automatiquement le dernier GPX',async()=>{const {calls,ctx}=context();const result=await vm.runInNewContext(`(async()=>{${script}\nreturn {view,trace:trace.length,current:currentRide};})()`,ctx);assert.equal(result.view,'saved');assert.equal(result.trace,0);assert.equal(result.current,null);assert.equal(calls.some(c=>/^\/api\/rides\//.test(c.path)),false);});
test('catalogue initial, filtres personnel/public/hiver et légende sans GPX',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch;const items=[{id:'a',name:'Personnel',rating:5,surface:'Gravier fin',winter:'yes',distance:100,coordinates:[[50,5],[50.001,5]],owner:'alice',isMine:true,isPublic:false},{id:'b',name:'Public',rating:3,surface:'Sable',winter:'no',distance:100,coordinates:[[50,5.01],[50.001,5.01]],owner:'bob',isMine:false,isPublic:true}];
 ctx.fetch=async(path,options)=>path==='/api/catalog'?{ok:true,status:200,json:async()=>items}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);assert.equal(elements.get('editorPanel').hidden,true);assert.equal(elements.get('gpxLegend').hidden,true);assert.equal(elements.get('segmentLegend').hidden,false);assert.equal(elements.get('savedList').children.length,2);
 elements.get('showMine').checked=false;elements.get('showMine').onchange();assert.equal(elements.get('savedList').children.length,1);
 elements.get('winterFilter').value='yes';elements.get('winterFilter').onchange();assert.equal(elements.get('savedList').children[0].textContent,'Aucun segment avec ces filtres.');
 elements.get('colorMode').value='surface';elements.get('colorMode').onchange();assert.equal(elements.get('legendContent').children[0].textContent,'Revêtement');
});
test('changer la tolérance réutilise les données OSM déjà chargées dans la page',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;ctx.fetch=async(path,options)=>{if(path==='/api/osm'){calls.push({path,options});return {ok:true,status:200,json:async()=>({bbox:[49.99,4.99,50.02,5.03],elements:[{id:1,nodes:[1,2],geometry:[{lat:50,lon:5},{lat:50,lon:5.02}]}]})};}return base(path,options);};
 const result=await vm.runInNewContext(`(async()=>{${script}\nawait loadRide('00000000-0000-0000-0000-000000000001');gpsSelection=[[50,5.001],[50,5.01]];await snap();$('snapTolerance').value='250';await snap();return {snapped,points:selected.length};})()`,ctx);assert.equal(result.snapped,true);assert.ok(result.points>1);assert.equal(calls.filter(c=>c.path==='/api/osm').length,1);
});

test('plein écran de secours et sortie conservent un contrôle utilisable',async()=>{const {ctx,elements}=context();await vm.runInNewContext(`(async()=>{${script}})()`,ctx);await elements.get('fullscreenMap').onclick();assert.equal(ctx.document.body.classList.contains('map-expanded'),true);assert.match(elements.get('fullscreenMap').textContent,/Quitter/);await elements.get('fullscreenMap').onclick();assert.equal(ctx.document.body.classList.contains('map-expanded'),false);});

test('clic propriétaire ouvre tous les attributs et soumission PATCH sans nouvelle portion',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch,r={id:'00000000-0000-0000-0000-000000000123',isMine:true,isPublic:true,name:'Sentier du bois',rating:4,surface:'Chemin de terre',difficulty:'Technique',winter:'conditions',singleTrack:'yes',notes:'Racines',snapped:true,mode:'route',coordinates:[[50,5],[50.001,5]]};
 const result=await vm.runInNewContext(`(async()=>{${script}\nshowSegment(${JSON.stringify(r)});return {view,editing:editingSegment.id,points:selected.length};})()`,ctx);
 assert.equal(result.view,'explore');assert.equal(result.editing,r.id);assert.equal(result.points,2);assert.equal(elements.get('editorTitle').textContent,'Modifier la portion');assert.equal(elements.get('name').value,r.name);assert.equal(elements.get('singleTrack').value,'yes');assert.equal(elements.get('winter').value,'conditions');assert.equal(elements.get('save').disabled,false);
 elements.get('name').value='Sentier corrigé';await elements.get('ratingForm').onsubmit({preventDefault(){}});
 const patch=calls.find(c=>c.options.method==='PATCH');assert.equal(patch.path,'/api/portions/'+r.id);assert.equal(JSON.parse(patch.options.body).name,'Sentier corrigé');assert.equal(JSON.parse(patch.options.body).singleTrack,'yes');assert.ok(!calls.some(c=>c.path==='/api/portions'&&c.options.method==='POST'));
});
test('segments et légende restent visibles lors de la création sans recentrage au filtrage',async()=>{
 const {ctx,elements}=context(),base=ctx.fetch,items=[{id:'a',name:'Existant',rating:4,surface:'Gravier fin',winter:'yes',singleTrack:'yes',owner:'alice',isMine:true,isPublic:true,coordinates:[[50,5],[50.001,5]]}];
 ctx.fetch=async(path,options)=>path==='/api/catalog'?{ok:true,status:200,json:async()=>items}:base(path,options);
 const events={},drawn=[];let fits=0;const map={setView(){return this;},createPane(){},getPane(){return {style:{}};},on(n,fn){events[n]=fn;return this;},invalidateSize(){},fitBounds(){fits++;},hasLayer(){return false;}};
 const layer=()=>({on(){return this;},addTo(){return this;},clearLayers(){},bindTooltip(){return this;}}),tile=()=>layer();tile.wms=tile;
 ctx.L={map:()=>map,tileLayer:tile,layerGroup:layer,polyline:(coordinates,options)=>{drawn.push({coordinates,options});return layer();},latLngBounds:p=>p,control:{layers:()=>({addTo(){return this;}}),zoom:()=>({addTo(){}})}};
 await vm.runInNewContext(`(async()=>{${script}})()`,ctx);const before=drawn.length;elements.get('explore').onclick();assert.ok(drawn.length>before);assert.equal(elements.get('segmentLegend').hidden,false);assert.equal(elements.get('catalogFilters').hidden,false);
 const count=fits;elements.get('singleTrackFilter').value='no';elements.get('singleTrackFilter').onchange();assert.equal(fits,count);assert.equal(elements.get('segmentCount').textContent,'0 segment(s) affiché(s)');
});
test('snapping Worker publie une progression réelle et un résultat tardif annulé ne modifie pas la sélection',async()=>{
 const {ctx,elements}=context(),workers=[];ctx.Worker=class{constructor(url){this.url=url;workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}};
 await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');gpsSelection=[[50,5],[50,5.01]];osmSnapshot={time:Date.now(),data:{bbox:[49,4,51,6],elements:[]}};globalThis.running=snap();})()`,ctx);
 const worker=workers[0];assert.ok(worker.url.includes('osm-worker.js'));assert.equal(worker.data.mode,'route');worker.onmessage({data:{progress:{stage:'match',completed:2,total:4}}});assert.equal(elements.get('osmProgress').value,50);assert.match(elements.get('progressCaption').textContent,/50 %/);
 elements.get('cancelSnap').onclick();await ctx.running;assert.equal(worker.terminated,true);assert.equal(elements.get('snapProgress').hidden,true);worker.onmessage({data:{result:{coordinates:[[0,0],[1,1]]}}});assert.equal(elements.get('snapState').textContent,'À tracer');
});
test('suggestion OSM préremplit le revêtement mais respecte une correction manuelle',async()=>{
 const {ctx,elements,calls}=context(),base=ctx.fetch;ctx.fetch=async(path,options)=>path==='/api/osm'?{ok:true,status:200,json:async()=>({bbox:[49.9,4.9,50.1,5.1],elements:[{id:1,nodes:[1,2],tags:{surface:'sand'},geometry:[{lat:50,lon:5},{lat:50,lon:5.01}]}]})}:base(path,options);
 await vm.runInNewContext(`(async()=>{${script}\nsetView('explore');gpsSelection=[[50,5],[50,5.01]];await snap();})()`,ctx);assert.equal(elements.get('surface').value,'Sable');assert.match(elements.get('surfaceSource').textContent,/100 %/);
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
