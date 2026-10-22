import {distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds} from './geo.js?v=4.1.0';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,escapeHTML} from './catalog.js?v=4.1.0';
const $=id=>document.getElementById(id);
const setHidden=(id,value)=>{const element=$(id);if(element)element.hidden=value;};
let trace=[],selected=[],gpsSelection=[],records=[],rides=[],first=null,last=null,rating=0,mode='route',snapped=false,busy=false,view='saved',currentRide=null,map,routeLayer,selectionLayer,marks,snapController,snapVersion=0,catalog=[],catalogLayer,layerControl,osmSnapshot=null,editingSegment=null,snapWorker=null,workerReject=null,surfaceTouched=false,geometryChanged=false;
const winterLabels={unknown:'Hiver non renseigné',yes:'Roulable en hiver',no:'Non roulable en hiver',conditions:'Hiver selon conditions'};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});if(res.status===401){location.replace('/login.html');throw Error('Session expirée.');}const data=await res.json();if(!res.ok)throw Error(data.error||'Le serveur ne répond pas.');return data;}
const post=(path,data,options={})=>api(path,{method:'POST',body:JSON.stringify(data),...options});
function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',6000);}
function status(t){$('status').textContent=t;}
function stars(){ $('stars').replaceChildren();for(let i=1;i<=5;i++){const b=document.createElement('button');b.type='button';b.textContent='★';b.className=i<=rating?'on':'';b.setAttribute('aria-label',`${i} sur 5`);b.setAttribute('aria-pressed',String(rating===i));b.onclick=()=>{rating=i;stars();update();};$('stars').append(b);}}
function update(){
 $('distance').innerHTML=selected.length>1?`${(routeLength(selected)/1000).toFixed(2)} <em>km</em>`:'— <em>km</em>';
 $('snapState').textContent=busy?'OSM en cours…':snapped?(mode==='route'?'Routage OSM':'Suivi GPX sur OSM'):mode==='manual'?'Manuel':mode==='snap'&&selected.length>1?'GPS d’origine':'À tracer';
 $('editorTitle').textContent=editingSegment?'Modifier la portion':'Créer une portion';$('save').textContent=editingSegment?'Enregistrer les modifications':'Enregistrer la portion ↗';setHidden('editingNotice',!editingSegment);setHidden('cancelSnap',!busy);
 if($('publicSegment')){$('publicSegment').disabled=(currentRide?.source_type==='strava'||editingSegment?.fromStrava===true);if($('publicSegment').disabled)$('publicSegment').checked=false;}setHidden('stravaPrivateNotice',!(currentRide?.source_type==='strava'||editingSegment?.fromStrava===true));
 $('save').disabled=selected.length<2||!rating||busy||view!=='explore'||(mode==='route'&&!snapped&&(geometryChanged||!editingSegment));$('snap').disabled=!gpsSelection.length||busy;setHidden('snap',mode==='manual'||view==='saved');setHidden('undo',mode!=='manual'||view==='saved');$('undo').disabled=!selected.length;setHidden('toleranceControls',mode==='manual'||view==='saved');
 $('count').textContent=view==='saved'?filtered().length:records.length;$('routeMode').classList.toggle('active',mode==='route');$('autoMode').classList.toggle('active',mode==='snap');$('manualMode').classList.toggle('active',mode==='manual');
}
function cancelSnap(){snapVersion++;snapController?.abort();snapWorker?.terminate();snapWorker=null;workerReject?.(Error('Calcul annulé.'));workerReject=null;busy=false;setHidden('snapProgress',true);}
function reset(){cancelSnap();editingSegment=null;geometryChanged=false;surfaceTouched=false;$('surfaceSource').textContent='';selected=[];gpsSelection=[];first=last=null;snapped=false;rating=0;$('ratingForm').reset();status(mode==='manual'?'Cliquez sur la carte pour tracer point à point.':mode==='route'?'Choisissez un départ et une arrivée sur la carte.':'Choisissez un départ et une arrivée sur la trace GPX.');drawSelection();stars();update();}
function drawSelection(){if(!map)return;selectionLayer.clearLayers();marks.clearLayers();if(selected.length){if(selected.length>1){L.polyline(selected,{pane:'portionPane',color:'#fff8df',weight:10,opacity:1,interactive:false}).addTo(selectionLayer);L.polyline(selected,{pane:'portionPane',color:'#d28a24',weight:6,opacity:1,interactive:false}).addTo(selectionLayer);}for(const[i,p]of selected.entries()){if((mode!=='manual'||view==='saved')&&i!==0&&i!==selected.length-1)continue;L.marker(p,{pane:'markerPane',icon:L.divIcon({className:'endpoint',iconSize:[15,15]})}).bindTooltip(i===0?'Départ':i===selected.length-1?'Arrivée':`Point ${i+1}`).addTo(marks);}}}
function fit(points=trace){if(map)map.invalidateSize({pan:false});if(map&&points.length>1)map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[30,30],paddingBottomRight:[innerWidth>850&&view==='explore'&&!document.fullscreenElement&&!document.body.classList.contains('map-expanded')?370:30,40]});}
function drawRoute(){if(!map)return;routeLayer.clearLayers();if(!trace.length)return;L.polyline(trace,{pane:'gpxPane',color:'#fff',weight:9,opacity:.9}).addTo(routeLayer);L.polyline(trace,{pane:'gpxPane',color:'#496975',weight:5,opacity:.85}).addTo(routeLayer).on('click',e=>{L.DomEvent.stopPropagation(e);choose(e.latlng);});fit();}
function choose(latlng){
 if(view!=='explore'||busy)return;geometryChanged=true;
 if(mode==='manual'){cancelSnap();selected.push([latlng.lat,latlng.lng]);snapped=false;drawSelection();status('Tracé manuel en segments droits. Ajoutez des points pour suivre le chemin.');update();return;}
 if(mode==='route'){
  const point=[latlng.lat,latlng.lng];if(first===null||last!==null){cancelSnap();first=point;last=null;selected=[point];gpsSelection=[];snapped=false;drawSelection();status('Départ posé. Choisissez l’arrivée sur la carte.');}
  else{if(distance(first,point)<5)return toast('Choisissez une arrivée différente.');last=point;gpsSelection=[first,last];void snap();}update();return;
 }
 if(!trace.length)return toast('Choisissez un GPX pour suivre la sortie, ou utilisez le routage entre deux points.');
 let idx=0,best=Infinity;trace.forEach((p,i)=>{const d=distance(p,[latlng.lat,latlng.lng]);if(d<best){idx=i;best=d;}});if(best>200)return toast('Cliquez plus près de la trace GPX.');
 if(first===null||last!==null){cancelSnap();first=idx;last=null;gpsSelection=[];selected=[trace[idx]];snapped=false;drawSelection();status('Départ posé. Choisissez l’arrivée sur le GPX.');}
 else{if(idx===first)return toast('Choisissez une arrivée différente.');last=idx;gpsSelection=trace.slice(Math.min(first,last),Math.max(first,last)+1);if(last<first)gpsSelection.reverse();selected=gpsSelection.map(p=>[...p]);drawSelection();void snap();}update();
}
function showProgress(progress){
 const bar=$('osmProgress'),caption=$('progressCaption');setHidden('snapProgress',false);
 if(Number.isFinite(progress.total)&&progress.total>0){const percent=Math.min(100,Math.round(100*progress.completed/progress.total));bar.value=percent;caption.textContent=progress.stage==='match'?`Suivi GPX : ${progress.completed}/${progress.total} points de contrôle (${percent} %)`:`Préparation OSM : ${percent} %`;}
 else{bar.removeAttribute('value');caption.textContent=({download:'Chargement des chemins OSM…',index:'Indexation des chemins OSM…',route:'Routage entre les deux points…'})[progress.stage]||'Calcul OSM…';}
}
function calculateOSM(points,elements,tolerance,version){
 const onProgress=p=>{if(version===snapVersion)showProgress(p);};
 if(typeof Worker==='undefined')return Promise.resolve((mode==='route'?routeOSM:matchOSMDetailed)(points,elements,{tolerance,onProgress}));
 return new Promise((resolve,reject)=>{
  const worker=new Worker('/osm-worker.js?v=4.1.0',{type:'module'});snapWorker=worker;workerReject=reject;
  const finish=()=>{worker.terminate();if(snapWorker===worker){snapWorker=null;workerReject=null;}};
  worker.onmessage=({data})=>{if(version!==snapVersion)return;if(data.progress){onProgress(data.progress);return;}finish();if(data.error)reject(Error(data.error));else resolve(data.result);};
  worker.onerror=()=>{finish();reject(Error('Le calcul OSM a échoué. Réessayez ou utilisez le mode manuel.'));};worker.postMessage({points,elements,tolerance,mode});
 });
}
async function snap(){
 if(gpsSelection.length<2)return;cancelSnap();const version=snapVersion;snapped=false;selected=gpsSelection.map(p=>[...p]);drawSelection();
 if(routeLength(gpsSelection)>15000){status('Calcul limité à 15 km. Réduisez la portion ou passez en manuel.');update();return;}
 busy=true;update();status(mode==='route'?'Routage OSM entre le départ et l’arrivée…':'Suivi de la trace GPX sur les chemins OSM…');showProgress({stage:'download'});snapController=new AbortController();
 try{const tolerance=Number($('snapTolerance')?.value||150),bbox=selectionBounds(gpsSelection,mode==='route'?Math.max(500,tolerance):tolerance),covers=(a,b)=>a&&a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];let data;
  if(osmSnapshot&&Date.now()-osmSnapshot.time<600000&&covers(osmSnapshot.data.bbox,bbox))data=osmSnapshot.data;
  else{data=await post('/api/osm',{bbox},{signal:snapController.signal});if(version!==snapVersion)return;osmSnapshot={time:Date.now(),data:{...data,bbox:data.bbox||bbox}};data=osmSnapshot.data;}
  if(version!==snapVersion)return;const result=await calculateOSM(gpsSelection,data.elements||[],tolerance,version);if(version!==snapVersion)return;
  selected=result.coordinates;snapped=true;drawSelection();
  if(result.surface){if(!surfaceTouched)$('surface').value=result.surface.type;$('surfaceSource').textContent=`Suggestion OSM : ${result.surface.type} (revêtement renseigné sur ${result.surface.coverage} % du tracé).${surfaceTouched?' Votre choix est conservé.':' À confirmer sur le terrain.'}`;}
  else $('surfaceSource').textContent='OSM ne renseigne pas assez le revêtement de ce tracé : choisissez-le ci-dessous.';
  const warning=result.stats.maxOffset>75?` Écart GPS jusqu’à ${result.stats.maxOffset} m : vérifiez le tracé.`:'';
  const ignored=result.stats.ignoredAnchors?` ${result.stats.ignoredAnchors} point(s) GPS isolé(s) écarté(s).`:'';
  status((mode==='route'?'Routage OSM le plus court dans la zone chargée : il peut différer de la sortie.':'Trace GPX accrochée aux chemins OSM.')+' Tracé orange au-dessus du GPX bleu.'+warning+ignored);
 }catch(e){if(version!==snapVersion)return;status(`Calcul impossible : ${e.message} Le mode manuel reste disponible.`);}
 finally{if(version===snapVersion){busy=false;setHidden('snapProgress',true);update();}}
}
function setMode(next){
 if(next==='auto')next='snap';if(next===mode)return;cancelSnap();mode=next;geometryChanged=true;snapped=false;gpsSelection=[];first=last=null;
 if(mode==='manual'){selected=selected.length>1?[selected[0],selected.at(-1)]:selected;status('Mode manuel : ajoutez des points sur la carte. Annulez le dernier point si nécessaire.');}
 else{selected=[];status(mode==='route'?'Choisissez deux points sur la carte pour le routage OSM.':'Choisissez deux points sur le GPX : le snapping suit les points intermédiaires.');}
 drawSelection();update();
}
if(typeof L!=='undefined'){
 map=L.map('map',{zoomControl:false}).setView([50.49,5.86],11);map.createPane('gpxPane');map.getPane('gpxPane').style.zIndex=410;map.createPane('portionPane');map.getPane('portionPane').style.zIndex=450;
 const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{updateWhenIdle:true,keepBuffer:3,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
 const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',maxZoom:19});
 const ign=L.tileLayer('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png',{minNativeZoom:7,maxNativeZoom:17,maxZoom:20,tileSize:256,updateWhenIdle:true,keepBuffer:2,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://ngi.be/">IGN Belgique</a> / TomTom · CartoWeb (non commercial)'});
 layerControl=L.control.layers({'OpenStreetMap':osm,'Satellite · Esri':satellite,'IGN Belgique · Topo':ign},null,{position:'topleft'}).addTo(map);
L.control.zoom({position:'topleft'}).addTo(map);
 const notice=$('mapNotice');let failures=0;
 const showNotice=message=>{if(notice){notice.textContent=message;notice.hidden=false;}};
 let ignFailed=false;ign.on('loading',()=>{ignFailed=false;});ign.on('tileerror',()=>{ignFailed=true;if(map.hasLayer(ign))showNotice('Les tuiles IGN sont indisponibles. Vérifiez la connexion au service CartoWeb ou choisissez un autre fond.');});ign.on('load',()=>{if(!ignFailed&&map.hasLayer(ign))setHidden('mapNotice',true);});
 osm.on('tileerror',()=>{if(!map.hasLayer(osm))return;if(++failures>=3)showNotice('Certaines tuiles OSM ne se chargent pas. Vous pouvez choisir Satellite dans le sélecteur de couches.');});
 osm.on('loading',()=>{failures=0;});
 osm.on('load',()=>{if(failures===0)setHidden('mapNotice',true);});
 satellite.on('tileerror',()=>{if(map.hasLayer(satellite))showNotice('Certaines images satellite sont indisponibles. Vous pouvez revenir à OpenStreetMap.');});
 map.on('baselayerchange',()=>{failures=0;setHidden('mapNotice',true);map.invalidateSize({pan:false});});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('map'));
 const legendElement=$('segmentLegend');if(legendElement&&typeof L.control==='function'){const legendControl=L.control({position:'bottomleft'});legendControl.onAdd=()=>{L.DomEvent.disableClickPropagation(legendElement);L.DomEvent.disableScrollPropagation(legendElement);return legendElement;};legendControl.addTo(map);if(innerWidth<=850)legendElement.open=false;}if(L.control.scale)L.control.scale({position:'bottomleft',imperial:false}).addTo(map);
 catalogLayer=L.layerGroup().addTo(map);routeLayer=L.layerGroup().addTo(map);selectionLayer=L.layerGroup().addTo(map);marks=L.layerGroup().addTo(map);map.on('click',e=>choose(e.latlng));$('mapFallback').remove();
}else $('mapFallback').textContent='Carte indisponible : vérifiez votre connexion Internet puis rechargez.';
async function loadRide(id){const ride=await api(`/api/rides/${id}`);reset();currentRide=ride;trace=ride.coordinates;setView('explore');$('mapSubtitle').textContent=ride.name;drawRoute();renderRides();}
function renderRides(){const select=$('rideSelect');if(select){select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='— Choisir une sortie GPX —';select.append(placeholder);for(const r of rides){const option=document.createElement('option');option.value=r.id;option.textContent=r.name;select.append(option);}select.value=currentRide?.id||'';}const list=$('rideList');list.replaceChildren();if(!rides.length){const p=document.createElement('p');p.className='empty';p.textContent='Aucune sortie. Importez votre premier GPX.';list.append(p);}for(const r of rides){const b=document.createElement('button');b.className='ridebutton'+(currentRide?.id===r.id?' chosen':'');const title=document.createElement('strong'),small=document.createElement('small');title.textContent=r.name;small.textContent=`${(r.distance/1000).toFixed(1)} km · ${r.source_type==='strava'?'Strava':'GPX'}`;b.append(title,small);b.onclick=()=>loadRide(r.id).catch(e=>toast(e.message));const row=document.createElement('div'),download=document.createElement('a');row.className='riderow';download.className='ridedownload';download.textContent='↓ GPX';download.href=`/api/rides/${r.id}/gpx`;download.title=r.gpx_available?'Télécharger le GPX original':'Télécharger la trace GPX reconstruite';row.append(b,download);list.append(row);}}
function parseGPX(xml){if(xml.querySelector('parsererror'))throw Error('GPX invalide.');const segments=[...xml.getElementsByTagNameNS('*','trkseg')];const read=(root,tag)=>[...root.getElementsByTagNameNS('*',tag)].filter(p=>p.hasAttribute('lat')&&p.hasAttribute('lon')).map(p=>[Number(p.getAttribute('lat')),Number(p.getAttribute('lon'))]).filter(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180);let points=(segments.length?segments:[xml]).map(s=>read(s,'trkpt')).sort((a,b)=>b.length-a.length)[0]||[];if(points.length<2)points=read(xml,'rtept');if(points.length<2||points.length>100000)throw Error('Le GPX doit contenir entre 2 et 100 000 points.');return {points,multi:segments.length>1};}
$('gpx').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>25*1024*1024)throw Error('GPX limité à 25 Mo.');const gpx=await f.text();const xml=new DOMParser().parseFromString(gpx,'application/xml');const {points,multi}=parseGPX(xml),name=xml.getElementsByTagNameNS('*','trk')[0]?.getElementsByTagNameNS('*','name')[0]?.textContent||f.name.replace(/\.gpx$/i,'');const ride=await post('/api/rides',{name,coordinates:points,gpx,fileName:f.name});rides=await api('/api/rides');await loadRide(ride.id);toast(multi?'Segment GPX le plus long enregistré (trace interrompue).':'Sortie enregistrée dans votre compte.');}catch(e){toast(e.message);}finally{e.target.value='';}};
$('ratingForm').onsubmit=async e=>{e.preventDefault();if(selected.length<2||!rating||busy||$('save').disabled)return;const b=$('save');b.disabled=true;
 try{const data={name:$('name').value,rating,difficulty:$('difficulty').value,surface:$('surface').value,winter:$('winter').value,singleTrack:$('singleTrack').value,notes:$('notes').value,coordinates:selected,snapped,isPublic:$('publicSegment').checked,mode,source:currentRide?.name||'Routage ou tracé manuel',rideId:currentRide?.id||null},editing=!!editingSegment;
  if(editing)await api(`/api/portions/${editingSegment.id}`,{method:'PATCH',body:JSON.stringify(data)});else await post('/api/portions',data);
  await refreshSegments();reset();renderList();toast(editing?'Segment modifié.':'Portion enregistrée dans votre compte.');
 }catch(e){toast(e.message);update();}};
$('surface').onchange=()=>{surfaceTouched=true;};
function filtered(){return visibleSegments(catalog,{mine:$('showMine')?.checked!==false,others:$('showOthers')?.checked!==false,winter:$('winterOnly')?.checked?'yes':$('winterFilter')?.value||'all',singleTrack:$('singleTrackFilter')?.value||'all'});}
function showSegment(r){
 if(r.isMine){reset();editingSegment=r;currentRide=null;trace=[];routeLayer?.clearLayers();mode=['route','snap','manual'].includes(r.mode)?r.mode:'route';setView('explore');
  selected=r.coordinates.map(p=>[...p]);snapped=r.snapped;rating=r.rating;surfaceTouched=true;
  for(const key of ['name','difficulty','surface','winter','singleTrack','notes'])$(key).value=r[key]??(['winter','singleTrack'].includes(key)?'unknown':'');
  $('publicSegment').checked=r.isPublic;stars();$('mapSubtitle').textContent=`Modifier : ${r.name}`;status('Modifiez les attributs et enregistrez. Pour changer le tracé, utilisez « Redessiner ».');renderRides();
 }else{reset();if(view==='explore')setView('saved');selected=r.coordinates;snapped=r.snapped;status(`Segment public de ${r.owner} : ${r.name}`);toast(`${r.name} · ${r.rating}/5 · ${r.surface} · ${singleTrackLabels[r.singleTrack||'unknown']}`);}
 drawSelection();fit(selected);update();
}
$('redraw').onclick=()=>{cancelSnap();geometryChanged=true;selected=[];gpsSelection=[];first=last=null;snapped=false;mode='route';status('Choisissez deux points pour remplacer le tracé. Les attributs sont conservés.');drawSelection();update();};
function drawCatalog({recenter=false}={}){
 if(catalogLayer)catalogLayer.clearLayers();const items=filtered(),colorMode=$('colorMode')?.value||'rating';
 for(const r of items){if(catalogLayer)L.polyline(r.coordinates,{pane:'portionPane',color:segmentColor(r,colorMode),weight:6,opacity:.9}).bindTooltip(`${escapeHTML(r.name)} · ${r.rating}/5 · ${escapeHTML(r.owner)} · ${escapeHTML(winterLabels[r.winter]||winterLabels.unknown)} · ${escapeHTML(singleTrackLabels[r.singleTrack||'unknown'])}`).on('click',e=>{L.DomEvent.stopPropagation(e);showSegment(r);}).addTo(catalogLayer);}
 if($('segmentCount'))$('segmentCount').textContent=`${items.length} segment(s) affiché(s)`;
 const legend=$('legendContent')||$('segmentLegend');if(legend){legend.replaceChildren();const title=document.createElement('strong');title.textContent=colorMode==='rating'?'Plaisir de rouler':colorMode==='singleTrack'?'Single track':'Revêtement';legend.append(title);const entries=colorMode==='rating'?ratingColors.map((color,i)=>[`${i+1}/5`,color]):colorMode==='singleTrack'?Object.entries(singleTrackColors).map(([key,color])=>[singleTrackLabels[key],color]):Object.entries(surfaceColors);for(const[label,color]of entries){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;item.append(swatch,document.createTextNode(label));legend.append(item);}
 if(view==='explore'){const title=document.createElement('strong');title.textContent='Traces';legend.append(title);for(const[label,color]of [...(trace.length?[['GPX','#496975']]:[]),['Portion en cours','#d28a24']]){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;item.append(swatch,document.createTextNode(label));legend.append(item);}}}
 if(recenter&&map&&items.length){const bounds=L.latLngBounds(items[0].coordinates);for(const r of items.slice(1))bounds.extend(r.coordinates);map.invalidateSize({pan:false});map.fitBounds(bounds,{padding:[35,35]});}update();
}
async function refreshSegments(){[records,catalog]=await Promise.all([api('/api/portions'),api('/api/catalog')]);drawCatalog();}
function renderList(){
 const list=$('savedList');list.replaceChildren();if(view!=='saved')return;const items=filtered();if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='Aucun segment avec ces filtres.';list.append(p);}
 for(const r of items){const div=document.createElement('div');div.className='saveditem';const name=document.createElement('strong'),meta=document.createElement('small'),winter=document.createElement('small'),notes=document.createElement('p'),show=document.createElement('button');name.textContent=r.name;meta.textContent=`${'★'.repeat(r.rating)} · ${(r.distance/1000).toFixed(2)} km · ${r.surface} · ${singleTrackLabels[r.singleTrack||'unknown']}`;winter.textContent=`${r.owner} · ${r.isPublic?'Public':'Privé'} · ${winterLabels[r.winter]||winterLabels.unknown}`;notes.textContent=r.notes;show.textContent=r.isMine?'Modifier sur la carte ↗':'Voir sur la carte ↗';show.onclick=()=>showSegment(r);div.append(name,meta,winter,notes,show);
 if(r.isMine){const del=document.createElement('button');del.textContent='Supprimer';del.onclick=async()=>{if(!confirm(`Supprimer « ${r.name} » ?`))return;try{await api(`/api/portions/${r.id}`,{method:'DELETE'});reset();await refreshSegments();renderList();}catch(e){toast(e.message);}};div.append(del);}list.append(div);}
}
function setView(v){view=v;const saved=v==='saved';$('explore').classList.toggle('active',!saved);$('savedTab').classList.toggle('active',saved);setHidden('rideList',saved);setHidden('rideChooser',saved);setHidden('catalogFilters',false);setHidden('editorPanel',saved);setHidden('gpxLegend',true);setHidden('segmentLegend',false);$('listTitle').textContent=saved?'Les segments':'Vos sorties';setHidden('source',saved);setHidden('ratingForm',saved);setHidden('modeControls',saved);if(saved){routeLayer?.clearLayers();$('mapSubtitle').textContent='Segments personnels et publics';drawCatalog({recenter:true});}else{drawCatalog();$('mapSubtitle').textContent=currentRide?.name||'Deux points sur la carte, ou une sortie GPX';}renderList();update();}
$('routeMode').onclick=()=>setMode('route');$('autoMode').onclick=()=>setMode('snap');$('manualMode').onclick=()=>setMode('manual');$('undo').onclick=()=>{geometryChanged=true;selected.pop();drawSelection();update();};$('snap').onclick=snap;$('snapTolerance').onchange=()=>{if(gpsSelection.length>1&&mode!=='manual'&&view==='explore')void snap();};$('reset').onclick=reset;$('cancelSnap').onclick=()=>{cancelSnap();status('Calcul annulé. Choisissez le mode manuel ou réessayez OSM.');update();};
$('savedTab').onclick=()=>{reset();setView('saved');};
$('hideRide').onclick=()=>{reset();setView('saved');};$('openRide').onclick=()=>{const id=$('rideSelect').value;if(id)loadRide(id).catch(e=>toast(e.message));else toast('Choisissez une sortie enregistrée.');};
for(const id of ['showMine','showOthers','winterOnly','winterFilter','singleTrackFilter','colorMode'])$(id).onchange=()=>{$('winterFilter').disabled=$('winterOnly').checked;if(view==='saved'){selected=[];drawSelection();}drawCatalog();renderList();};$('explore').onclick=()=>{reset();setView('explore');drawRoute();};$('fit').onclick=()=>{if(view==='saved')drawCatalog({recenter:true});else fit(selected.length>1?selected:trace);};
$('export').onclick=()=>{if(!records.length)return toast('Aucune portion à exporter.');const data={type:'FeatureCollection',features:records.map(r=>({type:'Feature',geometry:{type:'LineString',coordinates:r.coordinates.map(p=>[p[1],p[0]])},properties:{...r,coordinates:undefined}}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download='sillage-portions.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('logout').onclick=async()=>{try{await post('/api/logout',{});location.replace('/login.html');}catch(e){toast(e.message);}};
if($('legacyImport'))$('legacyImport').onclick=async()=>{if(!confirm('Transférer les anciennes notes de ce navigateur vers le compte actuellement connecté ?'))return;try{const old=JSON.parse(localStorage.getItem('sillage-portions')||'[]');let imported=0;for(let i=0;i<old.length;i+=500){const result=await post('/api/import-legacy',old.slice(i,i+500));imported+=result.imported;}await refreshSegments();renderList();update();toast(`${imported} portion(s) transférée(s). Les copies locales sont conservées.`);}catch(e){toast(e.message);}};
try{const me=await api('/api/me');$('username').textContent=me.username;setHidden('adminLink',!me.isAdmin);[records,rides,catalog]=await Promise.all([api('/api/portions'),api('/api/rides'),api('/api/catalog')]);renderRides();try{setHidden('legacyImport',!JSON.parse(localStorage.getItem('sillage-portions')||'[]').length);}catch{}
 if(map){const layers=await api('/api/wms');for(const w of layers){const layer=L.tileLayer.wms(w.url,{layers:w.layers,version:w.version,styles:w.styles,format:'image/png',transparent:false,referrerPolicy:'strict-origin-when-cross-origin',attribution:escapeHTML(w.attribution),maxZoom:20});layer.on('tileerror',()=>{if(map.hasLayer(layer))toast('Le fond '+w.name+' est indisponible.');});layerControl.addBaseLayer(layer,escapeHTML(w.name));}}
 const requested=new URLSearchParams(location.search||'').get('ride');if(requested&&/^[a-f0-9-]{36}$/.test(requested))await loadRide(requested);else setView('saved');}catch(e){toast(e.message);}stars();update();

function resizeMap(){if(map)map.invalidateSize({pan:false});}
function updateFullscreen(){const expanded=!!document.fullscreenElement||document.body.classList.contains('map-expanded');$('fullscreenMap').textContent=expanded?'⛶ Quitter plein écran':'⛶ Plein écran';$('fullscreenMap').setAttribute('aria-pressed',String(expanded));resizeMap();}
$('fullscreenMap').onclick=async()=>{const workspace=$('workspace');try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.body.classList.contains('map-expanded'))document.body.classList.remove('map-expanded');else if(workspace.requestFullscreen)await workspace.requestFullscreen();else document.body.classList.add('map-expanded');}catch{document.body.classList.toggle('map-expanded');}updateFullscreen();};
document.addEventListener('fullscreenchange',updateFullscreen);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('map-expanded')){document.body.classList.remove('map-expanded');updateFullscreen();}});
const header=document.querySelector('body.app-page>header');if(header&&typeof ResizeObserver!=='undefined'){new ResizeObserver(()=>{document.body.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');resizeMap();}).observe(header);}

const mapHead=document.querySelector('.maphead');if(mapHead&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{$('workspace').style.setProperty('--maphead-height',mapHead.getBoundingClientRect().height+'px');resizeMap();}).observe(mapHead);
