import {previewPath,renderPreview} from './preview.js?v=5.0.0';
import {distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds} from './geo.js?v=5.0.0';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,escapeHTML} from './catalog.js?v=5.0.0';
const $=id=>document.getElementById(id);
const setHidden=(id,value)=>{const element=$(id);if(element)element.hidden=value;};
let trace=[],selected=[],gpsSelection=[],records=[],rides=[],first=null,last=null,rating=0,mode='route',snapped=false,busy=false,view='saved',currentRide=null,map,routeLayer,selectionLayer,marks,snapController,snapVersion=0,catalog=[],catalogLayer,layerControl,osmSnapshot=null,editingSegment=null,snapWorker=null,workerReject=null,surfaceTouched=false,geometryChanged=false,endpoints=[],modeDrafts=new Map(),ridePreviewVersion=0,rideLoadVersion=0,stravaActivities=[],stravaPage=0,stravaBusy=false,stravaState={configured:false,connected:false},pickedSegmentId=null;
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
 $('count').textContent=filtered().length;$('routeMode').classList.toggle('active',mode==='route');$('autoMode').classList.toggle('active',mode==='snap');$('manualMode').classList.toggle('active',mode==='manual');
}
function cancelSnap(){snapVersion++;snapController?.abort();snapWorker?.terminate();snapWorker=null;workerReject?.(Error('Calcul annulé.'));workerReject=null;busy=false;setHidden('snapProgress',true);}
function reset(){cancelSnap();editingSegment=null;geometryChanged=false;surfaceTouched=false;endpoints=[];modeDrafts.clear();$('surfaceSource').textContent='';selected=[];gpsSelection=[];first=last=null;snapped=false;rating=0;$('ratingForm').reset();status(mode==='manual'?'Cliquez sur la carte pour tracer point à point.':mode==='route'?'Choisissez un départ et une arrivée sur la carte.':'Choisissez un départ et une arrivée sur la trace GPX.');drawSelection();stars();update();}
function drawSelection(){if(!map)return;selectionLayer.clearLayers();marks.clearLayers();if(selected.length){if(selected.length>1){L.polyline(selected,{pane:'portionPane',color:'#faf8f1',weight:10,opacity:1,interactive:false}).addTo(selectionLayer);L.polyline(selected,{pane:'portionPane',color:'#b5654c',weight:6,opacity:1,interactive:false}).addTo(selectionLayer);}const markerPoints=mode!=='manual'&&endpoints.length?endpoints:selected;for(const[i,p]of markerPoints.entries()){if((mode!=='manual'||view==='saved')&&i!==0&&i!==markerPoints.length-1)continue;L.marker(p,{pane:'markerPane',icon:L.divIcon({className:'endpoint',iconSize:[15,15]})}).bindTooltip(i===0?'Départ':i===markerPoints.length-1?'Arrivée':`Point ${i+1}`).addTo(marks);}}}
function fit(points=trace){if(map)map.invalidateSize({pan:false});if(map&&points.length>1)map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[30,30],paddingBottomRight:[innerWidth>850&&view==='explore'&&!document.fullscreenElement&&!document.body.classList.contains('map-expanded')?370:30,40]});}
function drawRoute(){if(!map)return;routeLayer.clearLayers();if(!trace.length)return;L.polyline(trace,{pane:'gpxPane',color:'#fff',weight:9,opacity:.9}).addTo(routeLayer);L.polyline(trace,{pane:'gpxPane',color:'#607d88',weight:5,opacity:.85}).addTo(routeLayer).on('click',e=>{L.DomEvent.stopPropagation(e);choose(e.latlng);});fit();}
function gpxBetween(points){
 if(points.length<2)return points.map(p=>[...p]);if(!trace.length)throw Error('Choisissez une sortie pour suivre son GPX. Vos points sont conservés.');
 const indices=points.map(point=>{let best=Infinity,index=0;trace.forEach((p,i)=>{const d=distance(p,point);if(d<best){best=d;index=i;}});if(best>200)throw Error('Un point est trop loin du GPX. Vos points sont conservés ; choisissez le routage ou le mode manuel.');return index;});
 if(indices[0]===indices[1])throw Error('Les deux points correspondent au même point du GPX.');
 const range=trace.slice(Math.min(...indices),Math.max(...indices)+1);return indices[1]<indices[0]?range.reverse():range;
}
function choose(latlng){
 if(view!=='explore'||busy)return;
 let point=[latlng.lat,latlng.lng];if(mode==='snap'){if(!trace.length)return toast('Choisissez une sortie GPX / Strava ou le routage entre deux points.');const clicked=point;let best=Infinity;for(const p of trace){const d=distance(p,clicked);if(d<best){best=d;point=p;}}if(best>200)return toast('Cliquez plus près de la trace GPX.');}
 cancelSnap();geometryChanged=true;snapped=false;modeDrafts.clear();
 if(mode==='manual'){selected.push([...point]);endpoints=selected.length>1?[selected[0],selected.at(-1)]:[selected[0]];first=endpoints[0];last=endpoints.length>1?endpoints[1]:null;gpsSelection=[];status('Tracé manuel : ajoutez des points pour suivre le chemin.');drawSelection();update();return;}
 if(endpoints.length!==1){endpoints=[[...point]];first=point;last=null;selected=[[...point]];gpsSelection=[];drawSelection();status('Départ posé. Choisissez l’arrivée.');}
 else{if(distance(endpoints[0],point)<5)return toast('Choisissez une arrivée différente.');endpoints.push([...point]);first=endpoints[0];last=endpoints[1];try{gpsSelection=mode==='snap'?gpxBetween(endpoints):endpoints.map(p=>[...p]);selected=gpsSelection.map(p=>[...p]);drawSelection();void snap();}catch(e){status(e.message);}}
 update();
}
function showProgress(progress){
 const bar=$('osmProgress'),caption=$('progressCaption');setHidden('snapProgress',false);
 if(Number.isFinite(progress.total)&&progress.total>0){const percent=Math.min(100,Math.round(100*progress.completed/progress.total));bar.value=percent;caption.textContent=progress.stage==='match'?`Suivi GPX : ${progress.completed}/${progress.total} points de contrôle (${percent} %)`:`Préparation OSM : ${percent} %`;}
 else{bar.removeAttribute('value');caption.textContent=({download:'Chargement des chemins OSM…',index:'Indexation des chemins OSM…',route:'Routage entre les deux points…'})[progress.stage]||'Calcul OSM…';}
}
function calculateOSM(points,elements,tolerance,version,calculationMode=mode){
 const onProgress=p=>{if(version===snapVersion&&calculationMode!=='surface')showProgress(p);};
 if(typeof Worker==='undefined')return Promise.resolve((calculationMode==='route'?routeOSM:matchOSMDetailed)(points,elements,{tolerance,onProgress}));
 return new Promise((resolve,reject)=>{
  const worker=new Worker('/osm-worker.js?v=5.0.0',{type:'module'});snapWorker=worker;workerReject=reject;
  const finish=()=>{worker.terminate();if(snapWorker===worker){snapWorker=null;workerReject=null;}};
  worker.onmessage=({data})=>{if(version!==snapVersion)return;if(data.progress){onProgress(data.progress);return;}finish();if(data.error)reject(Error(data.error));else resolve(data.result);};
  worker.onerror=()=>{finish();reject(Error('Le calcul OSM a échoué. Réessayez ou utilisez le mode manuel.'));};worker.postMessage({points,elements,tolerance,mode:calculationMode});
 });
}
async function osmData(points,tolerance,version){
 const bbox=selectionBounds(points,tolerance),covers=(a,b)=>a&&a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
 if(osmSnapshot&&Date.now()-osmSnapshot.time<600000&&covers(osmSnapshot.data.bbox,bbox))return osmSnapshot.data;
 const data=await post('/api/osm',{bbox},{signal:snapController.signal});if(version!==snapVersion)throw Error('Calcul annulé.');osmSnapshot={time:Date.now(),data:{...data,bbox:data.bbox||bbox}};return osmSnapshot.data;
}
function surfaceSuggestion(surface){
 if(surface){if(!surfaceTouched)$('surface').value=surface.type;$('surfaceSource').textContent=`Suggestion OSM : ${surface.type} (revêtement renseigné sur ${surface.coverage} % du tracé).${surfaceTouched?' Votre choix est conservé.':' À confirmer sur le terrain.'}`;}
 else $('surfaceSource').textContent='Revêtement OSM non renseigné ou insuffisant : choisissez votre revêtement.';
}
async function routeSurface(points,version){
 try{const data=await osmData(points,75,version);if(version!==snapVersion)return;const result=await calculateOSM(points,data.elements||[],75,version,'surface');if(version!==snapVersion)return;surfaceSuggestion(result.stats.maxOffset<=35?result.surface:null);}
 catch{if(version===snapVersion)$('surfaceSource').textContent='Revêtement OSM indisponible. Vous pouvez le renseigner à la main.';}
}
async function snap(){
 if(gpsSelection.length<2)return;cancelSnap();const version=snapVersion;snapped=false;selected=gpsSelection.map(p=>[...p]);drawSelection();
 if(routeLength(gpsSelection)>15000){status('Calcul limité à 15 km. Réduisez la portion ou passez en manuel.');update();return;}
 busy=true;update();status(mode==='route'?'Calcul d’un itinéraire vélo sur OSM…':'Suivi de la trace GPX sur les chemins OSM…');showProgress({stage:mode==='route'?'route':'download'});snapController=new AbortController();
 try{const tolerance=Number($('snapTolerance')?.value||150);let result;
  if(mode==='route'){const points=endpoints.length===2?endpoints:[gpsSelection[0],gpsSelection.at(-1)];result=await post('/api/route',{points,tolerance},{signal:snapController.signal});}
  else{const data=await osmData(gpsSelection,tolerance,version);if(version!==snapVersion)return;result=await calculateOSM(gpsSelection,data.elements||[],tolerance,version);}
  if(version!==snapVersion)return;selected=result.coordinates;snapped=true;drawSelection();
  if(mode==='route'){surfaceSuggestion(null);void routeSurface(selected,version);}else surfaceSuggestion(result.surface);
  const warning=result.stats.maxOffset>75?` Points décalés du réseau jusqu’à ${result.stats.maxOffset} m : vérifiez le tracé.`:'';
  const ignored=result.stats.ignoredAnchors?` ${result.stats.ignoredAnchors} point(s) GPS isolé(s) écarté(s).`:'';
  status((mode==='route'?'Itinéraire vélo calculé sur OSM. Utilisez le mode manuel pour affiner un passage.':'Trace GPX accrochée aux chemins OSM.')+' Vérifiez le tracé orange avant d’enregistrer.'+warning+ignored);
 }catch(e){if(version!==snapVersion)return;status(`Calcul impossible : ${e.message} Départ et arrivée conservés.`);}
 finally{if(version===snapVersion){busy=false;setHidden('snapProgress',true);update();}}
}
function setMode(next){
 if(next==='auto')next='snap';if(next===mode)return;
 const anchors=endpoints.length?endpoints.map(p=>[...p]):selected.length?[selected[0],...(selected.length>1?[selected.at(-1)]:[])]:[];
 let range=[];try{if(next==='snap'&&anchors.length>1)range=gpxBetween(anchors);}catch(e){toast(e.message);return;}
 modeDrafts.set(mode,{coordinates:selected.map(p=>[...p]),snapped});cancelSnap();mode=next;geometryChanged=true;endpoints=anchors;first=anchors[0]||null;last=anchors[1]||null;
 const previous=modeDrafts.get(mode);selected=previous?.coordinates.map(p=>[...p])||anchors.map(p=>[...p]);snapped=previous?.snapped||false;
 gpsSelection=mode==='snap'?range:mode==='route'?anchors:[];
 status(mode==='manual'?'Mode manuel. Vos points sont conservés ; ajoutez des points sur la carte.':mode==='route'?'Routage vélo OSM. Départ et arrivée conservés.':'Suivi du GPX. Départ et arrivée conservés.');drawSelection();update();
 if(mode!=='manual'&&gpsSelection.length>1&&!snapped)void snap();
}
if(typeof L!=='undefined'){
 map=L.map('map',{zoomControl:false}).setView([50.49,5.86],11);map.createPane('gpxPane');map.getPane('gpxPane').style.zIndex=410;map.createPane('portionPane');map.getPane('portionPane').style.zIndex=450;
 const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{updateWhenIdle:true,keepBuffer:3,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
 const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',maxZoom:19});
 const ign=L.tileLayer('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png',{minNativeZoom:7,maxNativeZoom:17,maxZoom:20,tileSize:256,updateWhenIdle:true,keepBuffer:2,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://ngi.be/">IGN Belgique</a> / TomTom · CartoWeb (non commercial)'});
 const cyclosm=L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:20,updateWhenIdle:true,keepBuffer:2,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.cyclosm.org/">CyclOSM</a> / OSM France'});
 layerControl=L.control.layers({'OpenStreetMap':osm,'Satellite · Esri':satellite,'IGN Belgique · Topo':ign,'CyclOSM · Vélo':cyclosm},null,{position:'topleft'}).addTo(map);
L.control.zoom({position:'topleft'}).addTo(map);
 if(map.attributionControl)map.attributionControl.addAttribution('Routage © OSM · <a href="https://routing.openstreetmap.de/about.html">FOSSGIS / OSRM vélo</a> · <a href="https://www.openstreetmap.org/fixthemap">Corriger la carte</a>');
 const notice=$('mapNotice');let failures=0;
 const showNotice=message=>{if(notice){notice.textContent=message;notice.hidden=false;}};
 let ignFailed=false;ign.on('loading',()=>{ignFailed=false;});ign.on('tileerror',()=>{ignFailed=true;if(map.hasLayer(ign))showNotice('Les tuiles IGN sont indisponibles. Vérifiez la connexion au service CartoWeb ou choisissez un autre fond.');});ign.on('load',()=>{if(!ignFailed&&map.hasLayer(ign))setHidden('mapNotice',true);});
 osm.on('tileerror',()=>{if(!map.hasLayer(osm))return;if(++failures>=3)showNotice('Certaines tuiles OSM ne se chargent pas. Vous pouvez choisir Satellite dans le sélecteur de couches.');});
 osm.on('loading',()=>{failures=0;});
 osm.on('load',()=>{if(failures===0)setHidden('mapNotice',true);});
 cyclosm.on('tileerror',()=>{if(map.hasLayer(cyclosm))showNotice('Le fond CyclOSM est indisponible. Choisissez un autre fond.');});
 satellite.on('tileerror',()=>{if(map.hasLayer(satellite))showNotice('Certaines images satellite sont indisponibles. Vous pouvez revenir à OpenStreetMap.');});
 map.on('baselayerchange',()=>{failures=0;setHidden('mapNotice',true);map.invalidateSize({pan:false});});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('map'));
 const legendElement=$('segmentLegend');if(legendElement&&typeof L.control==='function'){const legendControl=L.control({position:'bottomleft'});legendControl.onAdd=()=>{L.DomEvent.disableClickPropagation(legendElement);L.DomEvent.disableScrollPropagation(legendElement);return legendElement;};legendControl.addTo(map);if(innerWidth<=850)legendElement.open=false;}if(L.control.scale)L.control.scale({position:'bottomleft',imperial:false}).addTo(map);
 catalogLayer=L.layerGroup().addTo(map);routeLayer=L.layerGroup().addTo(map);selectionLayer=L.layerGroup().addTo(map);marks=L.layerGroup().addTo(map);map.on('click',e=>choose(e.latlng));$('mapFallback').remove();
}else $('mapFallback').textContent='Carte indisponible : vérifiez votre connexion Internet puis rechargez.';
function jumpToMap(){if(innerWidth<=850)$('workspace').scrollIntoView?.({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'instant':'smooth',block:'start'});}
async function loadRide(id){const version=++rideLoadVersion,ride=await api(`/api/rides/${id}`);if(version!==rideLoadVersion)return;ridePreviewVersion++;$('ridePreviewStatus').textContent='';reset();currentRide=ride;trace=ride.coordinates;setView('explore');$('mapSubtitle').textContent=ride.name;drawRoute();$('rideSource').value='saved';setHidden('savedRideLibrary',false);setHidden('stravaSidebar',true);$('rideLibraryKind').value='all';$('rideSelect').value=ride.id;renderRides();jumpToMap();}
function renderRides(){
 const select=$('rideSelect'),previous=select.value,available=rides.filter(r=>!$('rideLibraryKind').value||$('rideLibraryKind').value==='all'||(r.source_type||'gpx')===$('rideLibraryKind').value);select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=available.length?'— Choisir une sortie —':'Aucune sortie enregistrée';select.append(placeholder);
 for(const r of available){const option=document.createElement('option');option.value=r.id;option.textContent=`${r.name} · ${(r.distance/1000).toFixed(1)} km`;select.append(option);}
 select.value=available.some(r=>r.id===previous)?previous:available.some(r=>r.id===currentRide?.id)?currentRide.id:'';
 $('rideLibraryCount').textContent=`${available.length} sortie(s)`;
 if(currentRide&&select.value===currentRide.id)renderRidePreview(currentRide);else if(!select.value)renderRidePreview(null);
}
function renderRidePreview(ride){
 renderPreview($('rideList'),ride,{label:ride?.source_type==='strava'?'Import Strava · privé':'Ma sortie GPX',meta:ride?`${((ride.distance||routeLength(ride.coordinates))/1000).toFixed(1)} km` :''});
 $('downloadRide').hidden=!ride;$('deleteRide').disabled=!ride;$('openRide').disabled=!ride;if(ride)$('downloadRide').href=`/api/rides/${ride.id}/gpx`;
}
async function previewRide(){
 const id=$('rideSelect').value,version=++ridePreviewVersion;renderRidePreview(null);if(!id)return;
 $('ridePreviewStatus').textContent='Chargement de l’aperçu…';try{const ride=id===currentRide?.id?currentRide:await api(`/api/rides/${id}`);if(version!==ridePreviewVersion)return;renderRidePreview(ride);$('ridePreviewStatus').textContent='';}catch(e){if(version===ridePreviewVersion)$('ridePreviewStatus').textContent=e.message;}
}
async function loadStravaStatus(){
 try{stravaState=await api('/api/strava/status');$('sidebarStravaStatus').textContent=!stravaState.configured?'Connexion Strava à activer sur le serveur.':stravaState.connected?'Strava connecté · vos sorties privées':'Connectez Strava pour retrouver vos sorties ici.';}
 catch(e){$('sidebarStravaStatus').textContent=e.message;}
 setHidden('sidebarConnectStrava',!stravaState.configured||stravaState.connected);setHidden('stravaPicker',!stravaState.configured||!stravaState.connected);
}
async function changeRideSource(){
 const remote=$('rideSource').value==='strava';setHidden('savedRideLibrary',remote);setHidden('stravaSidebar',!remote);
 if(remote){await loadStravaStatus();if(stravaState.connected&&stravaState.configured&&!stravaPage)await loadSidebarStrava(true);}
}
async function loadSidebarStrava(reset=false){
 if(stravaBusy)return;stravaBusy=true;$('stravaMore').disabled=true;$('stravaKind').disabled=true;
 try{const data=await api(`/api/strava/activities?page=${reset?1:stravaPage+1}&kind=${$('stravaKind').value||'gravel'}`);stravaPage=data.page;stravaActivities=(reset?data.activities:[...stravaActivities,...data.activities]).slice(-300);
  const select=$('stravaRideSelect'),previous=reset?'':select.value;select.replaceChildren();const initial=document.createElement('option');initial.value='';initial.textContent=stravaActivities.length?'— Choisir une sortie Strava —':'Aucune sortie de ce type sur cette page';select.append(initial);
  for(const a of stravaActivities){const o=document.createElement('option');o.value=a.id;o.textContent=`${new Date(a.startDate).toLocaleDateString('fr-BE')} · ${a.name}`;select.append(o);}select.value=previous;
  $('stravaMore').hidden=!data.hasMore;$('sidebarStravaStatus').textContent=`${stravaActivities.length} sortie(s) trouvée(s)${!stravaActivities.length&&data.hasMore?' · cherchez dans les sorties plus anciennes':''}`;previewStrava();
 }catch(e){$('sidebarStravaStatus').textContent=e.message;}
 finally{stravaBusy=false;$('stravaMore').disabled=false;$('stravaKind').disabled=false;previewStrava();}
}
function previewStrava(){const activity=stravaActivities.find(a=>a.id===$('stravaRideSelect').value);renderPreview($('stravaRidePreview'),activity,{label:'Sortie Strava · privée',meta:activity?`${(activity.distance/1000).toFixed(1)} km · ${activity.sportType}`:''});$('openStravaRide').disabled=!activity||stravaBusy;}
$('rideSelect').onchange=previewRide;$('rideLibraryKind').onchange=()=>{renderRides();void previewRide();};$('rideSource').onchange=changeRideSource;
$('stravaRideSelect').onchange=previewStrava;$('stravaKind').onchange=()=>loadSidebarStrava(true);$('stravaMore').onclick=()=>loadSidebarStrava();
$('refreshStrava').onclick=()=>loadSidebarStrava(true);
$('openStravaRide').onclick=async()=>{const id=$('stravaRideSelect').value;if(!id||stravaBusy)return;stravaBusy=true;$('openStravaRide').disabled=true;
 try{const ride=await post('/api/strava/import',{activityId:id});rides=await api('/api/rides');await loadRide(ride.id);$('rideSource').value='saved';$('rideLibraryKind').value='all';renderRides();await changeRideSource();toast('Sortie Strava ouverte sur la carte.');}
 catch(e){$('sidebarStravaStatus').textContent=e.message;}finally{stravaBusy=false;previewStrava();}};
$('deleteRide').onclick=async()=>{const id=$('rideSelect').value;if(!id||!confirm('Supprimer cette sortie et les segments qui lui sont liés ?'))return;
 try{await api(`/api/rides/${id}`,{method:'DELETE'});if(currentRide?.id===id){currentRide=null;trace=[];routeLayer?.clearLayers();reset();}ridePreviewVersion++;rides=await api('/api/rides');$('rideSelect').value='';renderRides();await refreshSegments();renderList();toast('Sortie supprimée.');}catch(e){toast(e.message);}};
function parseGPX(xml){if(xml.querySelector('parsererror'))throw Error('GPX invalide.');const segments=[...xml.getElementsByTagNameNS('*','trkseg')];const read=(root,tag)=>[...root.getElementsByTagNameNS('*',tag)].filter(p=>p.hasAttribute('lat')&&p.hasAttribute('lon')).map(p=>[Number(p.getAttribute('lat')),Number(p.getAttribute('lon'))]).filter(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180);let points=(segments.length?segments:[xml]).map(s=>read(s,'trkpt')).sort((a,b)=>b.length-a.length)[0]||[];if(points.length<2)points=read(xml,'rtept');if(points.length<2||points.length>100000)throw Error('Le GPX doit contenir entre 2 et 100 000 points.');return {points,multi:segments.length>1};}
$('gpx').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>25*1024*1024)throw Error('GPX limité à 25 Mo.');const gpx=await f.text();const xml=new DOMParser().parseFromString(gpx,'application/xml');const {points,multi}=parseGPX(xml),name=xml.getElementsByTagNameNS('*','trk')[0]?.getElementsByTagNameNS('*','name')[0]?.textContent||f.name.replace(/\.gpx$/i,'');const ride=await post('/api/rides',{name,coordinates:points,gpx,fileName:f.name});rides=await api('/api/rides');await loadRide(ride.id);toast(multi?'Segment GPX le plus long enregistré (trace interrompue).':'Sortie enregistrée dans votre compte.');}catch(e){toast(e.message);}finally{e.target.value='';}};
$('ratingForm').onsubmit=async e=>{e.preventDefault();if(selected.length<2||!rating||busy||$('save').disabled)return;const b=$('save');b.disabled=true;
 try{const data={name:$('name').value,rating,difficulty:$('difficulty').value,surface:$('surface').value,winter:$('winter').value,singleTrack:$('singleTrack').value,notes:$('notes').value,coordinates:selected,snapped,isPublic:$('publicSegment').checked,mode,source:currentRide?.name||'Routage ou tracé manuel',rideId:currentRide?.id||null},editing=!!editingSegment;
  if(editing)await api(`/api/portions/${editingSegment.id}`,{method:'PATCH',body:JSON.stringify(data)});else await post('/api/portions',data);
  await refreshSegments();reset();renderList();toast(editing?'Segment modifié.':'Portion enregistrée dans votre compte.');
 }catch(e){toast(e.message);update();}};
$('independentSegment').onclick=()=>{rideLoadVersion++;ridePreviewVersion++;currentRide=null;trace=[];routeLayer?.clearLayers();reset();mode='route';setView('explore');renderRides();status('Nouveau segment indépendant : choisissez ses points sur la carte OSM.');};
$('surface').onchange=()=>{surfaceTouched=true;};
function filtered(){return visibleSegments(catalog,{mine:$('showMine')?.checked!==false,others:$('showOthers')?.checked!==false,winter:$('winterOnly')?.checked?'yes':$('winterFilter')?.value||'all',singleTrack:$('singleTrackFilter')?.value||'all'});}
function showSegment(r){
 rideLoadVersion++;pickedSegmentId=r.id;
 if(r.isMine){reset();editingSegment=r;currentRide=null;trace=[];routeLayer?.clearLayers();mode=['route','snap','manual'].includes(r.mode)?r.mode:'route';setView('explore');
  selected=r.coordinates.map(p=>[...p]);endpoints=[selected[0],selected.at(-1)];first=endpoints[0];last=endpoints[1];snapped=r.snapped;rating=r.rating;surfaceTouched=true;
  for(const key of ['name','difficulty','surface','winter','singleTrack','notes'])$(key).value=r[key]??(['winter','singleTrack'].includes(key)?'unknown':'');
  $('publicSegment').checked=r.isPublic;stars();$('mapSubtitle').textContent=`Modifier : ${r.name}`;status('Modifiez les attributs et enregistrez. Pour changer le tracé, utilisez « Redessiner ».');renderRides();
 }else{reset();if(view==='explore')setView('saved');selected=r.coordinates;snapped=r.snapped;status(`Segment public de ${r.owner} : ${r.name}`);toast(`${r.name} · ${r.rating}/5 · ${r.surface} · ${singleTrackLabels[r.singleTrack||'unknown']}`);}
 drawSelection();fit(selected);update();jumpToMap();
}
$('redraw').onclick=()=>{cancelSnap();geometryChanged=true;selected=[];endpoints=[];modeDrafts.clear();gpsSelection=[];first=last=null;snapped=false;mode='route';status('Choisissez deux points pour remplacer le tracé. Les attributs sont conservés.');drawSelection();update();};
function drawCatalog({recenter=false}={}){
 if(catalogLayer)catalogLayer.clearLayers();const items=filtered(),colorMode=$('colorMode')?.value||'rating';
 for(const r of items){if(catalogLayer)L.polyline(r.coordinates,{pane:'portionPane',color:segmentColor(r,colorMode),weight:6,opacity:.9}).bindTooltip(`${escapeHTML(r.name)} · ${r.rating}/5 · ${escapeHTML(r.owner)} · ${escapeHTML(winterLabels[r.winter]||winterLabels.unknown)} · ${escapeHTML(singleTrackLabels[r.singleTrack||'unknown'])}`).on('click',e=>{L.DomEvent.stopPropagation(e);showSegment(r);}).addTo(catalogLayer);}
 if($('segmentCount'))$('segmentCount').textContent=`${items.length} segment(s) affiché(s)`;
 const legend=$('legendContent')||$('segmentLegend');if(legend){legend.replaceChildren();const title=document.createElement('strong');title.textContent=colorMode==='rating'?'Plaisir de rouler':colorMode==='singleTrack'?'Single track':'Revêtement';legend.append(title);const entries=colorMode==='rating'?ratingColors.map((color,i)=>[`${i+1}/5`,color]):colorMode==='singleTrack'?Object.entries(singleTrackColors).map(([key,color])=>[singleTrackLabels[key],color]):Object.entries(surfaceColors);for(const[label,color]of entries){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;item.append(swatch,document.createTextNode(label));legend.append(item);}
 if(view==='explore'){const title=document.createElement('strong');title.textContent='Traces';legend.append(title);for(const[label,color]of [...(trace.length?[['GPX','#607d88']]:[]),['Portion en cours','#b5654c']]){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;item.append(swatch,document.createTextNode(label));legend.append(item);}}}
 if(recenter&&map&&items.length){const bounds=L.latLngBounds(items[0].coordinates);for(const r of items.slice(1))bounds.extend(r.coordinates);map.invalidateSize({pan:false});map.fitBounds(bounds,{padding:[35,35]});}update();
}
async function refreshSegments(){[records,catalog]=await Promise.all([api('/api/portions'),api('/api/catalog')]);drawCatalog();}
function renderList(){
 const list=$('savedList'),select=$('segmentSelect'),items=filtered();list.replaceChildren();select.replaceChildren();setHidden('segmentBrowser',view!=='saved');if(view!=='saved')return;
 if(!items.some(s=>s.id===pickedSegmentId))pickedSegmentId=items[0]?.id||null;
 if(!items.length){const o=document.createElement('option');o.value='';o.textContent='Aucun segment avec ces filtres';select.append(o);return;}
 for(const r of items){const o=document.createElement('option');o.value=r.id;o.textContent=`${r.name} · ${r.owner} · ${r.rating}/5`;select.append(o);}select.value=pickedSegmentId;
 const r=items.find(r=>r.id===pickedSegmentId),div=document.createElement('div');div.className='saveditem preview-card';renderPreview(div,r,{label:r.isMine?'Mon segment':`Segment de ${r.owner}`,meta:`${'★'.repeat(r.rating)} · ${(r.distance/1000).toFixed(2)} km · ${r.surface}`});
 const attributes=document.createElement('p');attributes.className='preview-meta';attributes.textContent=`${r.isPublic?'Public':'Privé'} · ${winterLabels[r.winter]||winterLabels.unknown} · ${singleTrackLabels[r.singleTrack||'unknown']}`;div.append(attributes);
 if(r.notes){const notes=document.createElement('p');notes.className='preview-note';notes.textContent=r.notes;div.append(notes);}
 const show=document.createElement('button');show.className='outline';show.textContent=r.isMine?'Modifier sur la carte ↗':'Afficher sur la carte ↗';show.onclick=()=>showSegment(r);div.append(show);
 if(r.isMine){const del=document.createElement('button');del.className='textbutton danger';del.textContent='Supprimer ce segment';del.onclick=async()=>{if(!confirm(`Supprimer « ${r.name} » ?`))return;try{await api(`/api/portions/${r.id}`,{method:'DELETE'});reset();await refreshSegments();renderList();}catch(e){toast(e.message);}};div.append(del);}list.append(div);
}
$('segmentSelect').onchange=()=>{pickedSegmentId=$('segmentSelect').value;renderList();};
function setView(v){view=v;const saved=v==='saved';$('explore').classList.toggle('active',!saved);$('savedTab').classList.toggle('active',saved);setHidden('rideList',saved);setHidden('rideChooser',saved);setHidden('stravaSidebar',saved||$('rideSource').value!=='strava');setHidden('catalogFilters',false);setHidden('editorPanel',saved);setHidden('gpxLegend',true);setHidden('segmentLegend',false);$('listTitle').textContent=saved?'Les segments':'Vos sorties';setHidden('source',saved);setHidden('ratingForm',saved);setHidden('modeControls',saved);if(saved){routeLayer?.clearLayers();$('mapSubtitle').textContent='Segments personnels et publics';drawCatalog({recenter:true});}else{drawCatalog();$('mapSubtitle').textContent=currentRide?.name||'Deux points sur la carte, ou une sortie GPX';}renderList();update();}
$('routeMode').onclick=()=>setMode('route');$('autoMode').onclick=()=>setMode('snap');$('manualMode').onclick=()=>setMode('manual');$('undo').onclick=()=>{geometryChanged=true;selected.pop();endpoints=selected.length>1?[selected[0],selected.at(-1)]:selected.map(p=>[...p]);first=endpoints[0]||null;last=endpoints[1]||null;modeDrafts.clear();drawSelection();update();};$('snap').onclick=snap;$('snapTolerance').onchange=()=>{if(gpsSelection.length>1&&mode!=='manual'&&view==='explore')void snap();};$('reset').onclick=reset;$('cancelSnap').onclick=()=>{cancelSnap();status('Calcul annulé. Choisissez le mode manuel ou réessayez OSM.');update();};
$('savedTab').onclick=()=>{rideLoadVersion++;reset();setView('saved');};
$('hideRide').onclick=()=>{rideLoadVersion++;reset();setView('saved');};$('openRide').onclick=()=>{const id=$('rideSelect').value;if(id)loadRide(id).catch(e=>toast(e.message));else toast('Choisissez une sortie enregistrée.');};
for(const id of ['showMine','showOthers','winterOnly','winterFilter','singleTrackFilter','colorMode'])$(id).onchange=()=>{$('winterFilter').disabled=$('winterOnly').checked;if(view==='saved'){selected=[];drawSelection();}drawCatalog();renderList();};$('explore').onclick=()=>{reset();setView('explore');drawRoute();};$('fit').onclick=()=>{if(view==='saved')drawCatalog({recenter:true});else fit(selected.length>1?selected:trace);};
$('export').onclick=()=>{if(!records.length)return toast('Aucune portion à exporter.');const data={type:'FeatureCollection',features:records.map(r=>({type:'Feature',geometry:{type:'LineString',coordinates:r.coordinates.map(p=>[p[1],p[0]])},properties:{...r,coordinates:undefined}}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download='sillage-portions.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('logout').onclick=async()=>{try{await post('/api/logout',{});location.replace('/login.html');}catch(e){toast(e.message);}};
try{const me=await api('/api/me');$('username').textContent=me.username;setHidden('adminLink',!me.isAdmin);[records,rides,catalog]=await Promise.all([api('/api/portions'),api('/api/rides'),api('/api/catalog')]);renderRides();void loadStravaStatus();
 if(map){const layers=await api('/api/wms');for(const w of layers){const layer=L.tileLayer.wms(w.url,{layers:w.layers,version:w.version,styles:w.styles,format:'image/png',transparent:false,referrerPolicy:'strict-origin-when-cross-origin',attribution:escapeHTML(w.attribution),maxZoom:20});layer.on('tileerror',()=>{if(map.hasLayer(layer))toast('Le fond '+w.name+' est indisponible.');});layerControl.addBaseLayer(layer,escapeHTML(w.name));}}
 const requested=new URLSearchParams(location.search||'').get('ride');if(requested&&/^[a-f0-9-]{36}$/.test(requested))await loadRide(requested);else if(new URLSearchParams(location.search||'').get('source')==='strava'){setView('explore');$('rideSource').value='strava';await loadStravaStatus();await changeRideSource();}else setView('saved');}catch(e){toast(e.message);}stars();update();

function resizeMap(){if(map)map.invalidateSize({pan:false});}
function updateFullscreen(){const expanded=!!document.fullscreenElement||document.body.classList.contains('map-expanded');$('fullscreenMap').textContent=expanded?'⛶ Quitter plein écran':'⛶ Plein écran';$('fullscreenMap').setAttribute('aria-pressed',String(expanded));resizeMap();}
$('fullscreenMap').onclick=async()=>{const workspace=$('workspace');try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.body.classList.contains('map-expanded'))document.body.classList.remove('map-expanded');else if(workspace.requestFullscreen)await workspace.requestFullscreen();else document.body.classList.add('map-expanded');}catch{document.body.classList.toggle('map-expanded');}updateFullscreen();};
document.addEventListener('fullscreenchange',updateFullscreen);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('map-expanded')){document.body.classList.remove('map-expanded');updateFullscreen();}});
const header=document.querySelector('body.app-page>header');if(header&&typeof ResizeObserver!=='undefined'){new ResizeObserver(()=>{document.body.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');resizeMap();}).observe(header);}

const mapHead=document.querySelector('.maphead');if(mapHead&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{$('workspace').style.setProperty('--maphead-height',mapHead.getBoundingClientRect().height+'px');resizeMap();}).observe(mapHead);
