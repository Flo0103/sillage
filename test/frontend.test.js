import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {distance,routeLength,matchOSM} from '../dist/geo.js';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,escapeHTML} from '../dist/catalog.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
function element(){return {style:{},value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,children:[],classList:{toggle(){}},setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},reset(){},remove(){},click(){}};}
function context({optionalMissing=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
 if(optionalMissing)for(const id of ['source','modeControls','legacyImport'])elements.delete(id);
 const points=[[50,5],[50.001,5]],ride={id:'00000000-0000-0000-0000-000000000001',name:'Ma sortie',coordinates:points,distance:111};
 const calls=[];
 const document={getElementById:id=>elements.get(id)||null,createElement:()=>element(),createTextNode:text=>({textContent:text}),querySelector:()=>null};
 const fetch=async(path,options={})=>{calls.push({path,options});const data=path==='/api/me'?{username:'alice'}:['/api/portions','/api/catalog','/api/wms'].includes(path)?[]:path==='/api/rides'?options.method==='POST'?{id:ride.id}:[ride]:ride;return {ok:true,status:200,json:async()=>data};};
 const xml={querySelector:()=>null,getElementsByTagNameNS:(ns,tag)=>tag==='trkpt'?points.map(p=>({hasAttribute:()=>true,getAttribute:n=>n==='lat'?String(p[0]):String(p[1])})):[]};
 const ctx={document,fetch,distance,routeLength,matchOSM,visibleSegments,segmentColor,ratingColors,surfaceColors,escapeHTML,location:{replace(){}},localStorage:{getItem:()=>null},AbortController,console,setTimeout:()=>1,clearTimeout(){},innerWidth:1200,Blob,URL,confirm:()=>true,DOMParser:class{parseFromString(){return xml;}}};
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
 elements.get('colorMode').value='surface';elements.get('colorMode').onchange();assert.equal(elements.get('segmentLegend').children[0].textContent,'Revêtement');
});
