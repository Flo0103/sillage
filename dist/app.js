import {filterPlans,planLibraryStats} from './plan-library.js?v=6.17.0';
import {buildElevationModel,pointAtDistance,elevationAt,slopeAt,routeRenderRuns,kilometreMarkers,renderElevationChart,resizeElevationChart,setChartCursor,elevationColors,slopeBins,routeSurfaceColors} from './elevation.js?v=6.17.0';
import {ItineraryDraft,planSummary} from './planner.js?v=6.17.0';
import {insertionIndex} from './route-edit.js?v=6.17.0';
import {previewPath,renderPreview,disposePreviews} from './preview.js?v=6.17.0';
import {distance,routeLength,routeOSM,matchOSMDetailed,selectionBounds} from './geo.js?v=6.17.0';
import {visibleSegments,segmentColor,ratingColors,surfaceColors,singleTrackLabels,singleTrackColors,difficultyColors,escapeHTML} from './catalog.js?v=6.17.0';
const $=id=>document.getElementById(id);
if(innerWidth<=850){$('rideChooser').open=false;$('segmentBrowser').open=false;}
const setHidden=(id,value)=>{const element=$(id);if(element)element.hidden=value;};
let trace=[],selected=[],gpsSelection=[],records=[],rides=[],first=null,last=null,rating=0,mode='route',snapped=false,busy=false,view='saved',currentRide=null,map,routeLayer,selectionLayer,marks,snapController,snapVersion=0,catalog=[],catalogLayer,layerControl,hillshadeLayer,activeBaseLayer,osmSnapshot=null,editingSegment=null,snapWorker=null,workerReject=null,surfaceTouched=false,geometryChanged=false,endpoints=[],modeDrafts=new Map(),ridePreviewVersion=0,rideLoadVersion=0,stravaActivities=[],stravaPage=0,stravaBusy=false,stravaState={configured:false,connected:false},pickedSegmentId=null,viaPoints=[],routeLegFractions=null,routeDrag=null,independentOsm=false,planRecords=[],editingPlan=null,planReadOnly=false,planLoadVersion=0,importedTraces=null,importedLayer=null,overlayVersion=0,planRecalcTimer=null;
let planDraft=new ItineraryDraft(),planRoutingRunning=false,planMetricsRunning=false,planAnalysisTask=null,planSaving=false,segmentSaving=false,planRouteController=null,planMetricsController=null,planStartController=null,routeClickSuppressed=0,planViewing=false,selectedPlanPoint=null,profileCache=null,mainChartModel=null,previewChartModel=null,previewChartNode=null,previewPercentNode=null,profileCursor=null,kilometreLayer=null,planAnalysisAllowed=new Set(),planKnownLegs=new Set(),planAnalysisTimer=null,accessLayer=null,sidebarCollapsed=false,segmentDraftActive=false,viewedSegment=null;
const baseLayers=new Map();let planPreviewRecord=null,ridePreviewRecord,stravaPreviewRecord=null,sectorLibraryStamp=null;
const surfaceOnlyReview=new Set(),surfaceReviewed=new WeakSet(),surfaceRetries=new WeakMap(),surfaceRetryTimers=new Map();
const pointSettingsElement=$('pointSettings'),segmentPast=[],segmentFuture=[];
const draftActive=()=>view==='planner'||view==='explore'&&mode==='route'&&segmentDraftActive;
const profileActive=()=>view==='planner'||view==='explore'&&segmentDraftActive||view==='saved'&&!!viewedSegment;
const accessMidpoints=new WeakMap();let selectionStamp=[];
const canDraw=()=> (view==='explore'||view==='planner')&&!(view==='planner'&&(planReadOnly||planViewing));
const pointLimit=()=>draftActive()?200:12;
const winterLabels={unknown:'Hiver non renseigné',yes:'Roulable en hiver',no:'Non roulable en hiver',conditions:'Hiver selon conditions'};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});if(res.status===401){location.replace('/login.html');throw Error('Session expirée.');}const data=await res.json();if(!res.ok)throw Error(data.error||'Le serveur ne répond pas.');return data;}
const post=(path,data,options={})=>api(path,{method:'POST',body:JSON.stringify(data),...options});
function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',6000);}
function status(t){$('status').textContent=t;}
function stars(){ $('stars').replaceChildren();for(let i=1;i<=5;i++){const b=document.createElement('button');b.type='button';b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';b.className=i<=rating?'on':'';b.setAttribute('aria-label',`${i} sur 5`);b.setAttribute('aria-pressed',String(rating===i));b.onclick=()=>{rating=i;stars();update();};$('stars').append(b);}}
function update(){
 setHidden('drawSegment',false);setHidden('finishDrawing',view==='saved');setHidden('loadedRideControl',!trace.length);$('drawSegment').disabled=false;setHidden('hideRide',!trace.length);
 $('distance').innerHTML=selected.length>1?`${(routeLength(selected)/1000).toFixed(2)} <em>km</em>`:'— <em>km</em>';
 $('snapState').textContent=busy?'OSM en cours…':snapped?(mode==='route'?'Routage OSM':'Suivi GPX sur OSM'):mode==='manual'?'Manuel':mode==='snap'&&selected.length>1?'GPS d’origine':'À tracer';
 $('editorTitle').textContent=view==='planner'?(planViewing?editingPlan?.name||'Itinéraire':editingPlan?'Modifier l’itinéraire':'Tracer un itinéraire'):editingSegment?'Modifier le secteur':'Créer un secteur';
 $('savePlan').disabled=view!=='planner'||planReadOnly||planViewing||planSaving||selected.length<2||busy||!planDraft.complete()||!$('planName').value.trim();$('savePlan').textContent=planSaving?'Analyse avant enregistrement…':editingPlan?'Enregistrer les modifications':'Enregistrer l’itinéraire';setHidden('planReadOnlyNotice',!planReadOnly);$('planName').disabled=planReadOnly;$('planNotes').disabled=planReadOnly;$('publicPlan').disabled=planReadOnly;setHidden('plannerTools',!canDraw()||!draftActive());setHidden('undoPlan',view!=='planner'&&(!canDraw()||!(draftActive()||mode==='manual'||mode==='route')));setHidden('redoPlan',view!=='planner'&&(!canDraw()||!(draftActive()||mode==='manual'||mode==='route')));setHidden('manualLegControls',planViewing||planReadOnly);setHidden('planForm',view!=='planner'||planViewing);setHidden('planViewActions',view!=='planner'||!planViewing);setHidden('editPlan',!editingPlan?.isMine);setHidden('planMapControls',view!=='planner');setHidden('elevationPanel',!profileActive());const createLabel='Créer un nouvel itinéraire';$('reset').classList.toggle('is-plan',true);const creatingPlan=view==='planner'&&!editingPlan&&!planViewing&&!planReadOnly,creatingSector=view==='explore'&&segmentDraftActive&&!editingSegment;for(const [id,active]of [['reset',creatingPlan],['drawSegment',creatingSector]]){$(id).classList.toggle('is-creating',active);$(id).setAttribute('aria-pressed',String(active));}$('reset').setAttribute('aria-label',createLabel);$('reset').setAttribute('title',createLabel);$('reset').disabled=false;setHidden('reset',false);$('planViewInfo').textContent=planViewing?`${editingPlan?.isMine?'Mon itinéraire':`Itinéraire de ${editingPlan?.owner||'membre'}`} · ${editingPlan?.isPublic?'Public':'Privé'}${editingPlan?.notes?' · '+editingPlan.notes:''}`:'';setHidden('plannerStats',view!=='planner');$('manualLeg').disabled=planReadOnly;$('undoPlan').disabled=draftActive()?!planDraft.past.length:!segmentPast.length;$('redoPlan').disabled=draftActive()?!planDraft.future.length:!segmentFuture.length;updatePlanStats();$('save').textContent=editingSegment?'Enregistrer les modifications':'Enregistrer le secteur';setHidden('editingNotice',!editingSegment);setHidden('cancelSnap',!busy||view==='planner');setHidden('independentOsmNotice',!independentOsm);renderWaypoints();
 if($('publicSegment')){$('publicSegment').disabled=((currentRide?.source_type==='strava'&&!independentOsm)||editingSegment?.fromStrava===true);if($('publicSegment').disabled)$('publicSegment').checked=false;}setHidden('stravaPrivateNotice',!((currentRide?.source_type==='strava'&&!independentOsm)||editingSegment?.fromStrava===true));
 $('save').disabled=segmentSaving||selected.length<2||!rating||busy||view!=='explore'||(mode==='route'&&!snapped&&(geometryChanged||!editingSegment));$('snap').disabled=!gpsSelection.length||busy;setHidden('snap',true);setHidden('undo',true);$('undo').disabled=!selected.length;setHidden('toleranceControls',true);
 if(draftActive()){const manual=planDraft.legs.filter(l=>l.mode==='manual').length;$('snapState').textContent=busy?'OSM en cours…':manual===planDraft.legs.length&&manual?'Manuel':manual?'OSM + manuel':snapped?'Routage OSM':'À tracer';setHidden('retryPlanRoute',planDraft.complete()||planDraft.points.length<2||planRoutingRunning);$('retryPlanRoute').disabled=planReadOnly;}
 const routingWarning=draftActive()?planDraft.legs.find(l=>l.routingWarning)?.routingWarning:null;$('routingSourceNotice').textContent=routingWarning||'';setHidden('routingSourceNotice',!routingWarning);updateMapControlLayout();
}
function cancelSnap(){clearTimeout(planAnalysisTimer);planAnalysisTimer=null;clearTimeout(planRecalcTimer);planRecalcTimer=null;cancelRouteDrag();snapVersion++;snapController?.abort();snapWorker?.terminate();snapWorker=null;workerReject?.(Error('Calcul annulé.'));workerReject=null;busy=false;setHidden('snapProgress',true);}
function reset(){viewedSegment=null;for(const timer of surfaceRetryTimers.values())clearTimeout(timer);surfaceRetryTimers.clear();surfaceOnlyReview.clear();$('manualLeg').checked=false;closePointSettings(false);segmentDraftActive=false;segmentPast.length=0;segmentFuture.length=0;cancelSnap();planRouteController?.abort();planMetricsController?.abort();planStartController?.abort();planViewing=false;selectedPlanPoint=null;profileCache=null;mainChartModel=null;clearElevationCursor();planDraft=new ItineraryDraft();planAnalysisAllowed=new Set();planKnownLegs=new Set();editingSegment=null;geometryChanged=false;surfaceTouched=false;independentOsm=false;endpoints=[];viaPoints=[];routeLegFractions=null;modeDrafts.clear();$('surfaceSource').textContent='';selected=[];gpsSelection=[];first=last=null;snapped=false;rating=0;$('ratingForm').reset();status(mode==='manual'?'Cliquez sur la carte pour tracer point à point.':mode==='route'?'Choisissez un départ et une arrivée sur la carte.':'Choisissez un départ et une arrivée sur la trace GPX.');if(view==='explore'&&mode==='route')ensureSegmentDraft();drawSelection();stars();update();}
function routeControls(){return endpoints.length>1?[endpoints[0],...viaPoints,endpoints[1]]:endpoints.map(p=>[...p]);}
function renderWaypoints(){
 const list=$('waypointList');if(!list)return;list.replaceChildren();setHidden('routeEditControls',mode!=='route'||!canDraw());setHidden('pointSettings',!draftActive()||!canDraw()||selectedPlanPoint===null||selectedPlanPoint>=planDraft.points.length);
 if(!$('waypointDetails').open)return;
 const controls=routeControls();for(let i=0;i<controls.length;i++){const row=document.createElement('li'),label=document.createElement('span');label.textContent=i===0?'A · Départ':i===controls.length-1?'B · Arrivée':`Passage ${i}`;row.append(label);if(draftActive()&&i>0){const toggle=document.createElement('input'),choice=document.createElement('label');choice.className='checklabel waypoint-mode';toggle.type='checkbox';toggle.checked=planDraft.legs[i-1]?.mode==='manual';toggle.onchange=()=>setPointMode(i,toggle.checked);choice.append(toggle,document.createTextNode('Sans routage depuis le précédent'));row.append(choice);}if(i>0&&i<controls.length-1){const remove=document.createElement('button');remove.type='button';remove.className='textbutton';remove.textContent='Retirer';remove.setAttribute('aria-label',`Retirer le passage ${i}`);remove.onclick=()=>removeVia(i-1);row.append(remove);}list.append(row);}
}
function validMapPoint(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;}
async function recalculateRoute(){
 cancelSnap();geometryChanged=true;snapped=false;modeDrafts.clear();routeLegFractions=null;gpsSelection=routeControls();first=endpoints[0]||null;last=endpoints[1]||null;
 if(gpsSelection.length>1)await snap();else if(gpsSelection.length===1)await snapFirstPoint();else{selected=[];drawSelection();update();}
}
async function moveRouteControl(index,point){
 if(mode!=='route'||!canDraw()||!validMapPoint(point))return false;
 if(draftActive()){try{planDraft.move(index,point);plannerChanged();return true;}catch(e){toast(e.message);syncPlanner();return false;}}
 const controls=routeControls();if(index<0||index>=controls.length)return false;
 if(index===0)endpoints[0]=[...point];else if(index===controls.length-1)endpoints[1]=[...point];else viaPoints[index-1]=[...point];await recalculateRoute();return true;
}
async function insertVia(index,point){
 if(mode!=='route'||!canDraw()||endpoints.length<2||!validMapPoint(point))return false;
 if(draftActive()){closePointSettings(false);try{planDraft.insert(index,point,$('manualLeg').checked);plannerChanged();return true;}catch(e){toast(e.message);return false;}}
 if(viaPoints.length>=pointLimit()-2){toast(`Maximum ${pointLimit()-2} points de passage.`);return false;}viaPoints.splice(Math.max(0,Math.min(viaPoints.length,index-1)),0,[...point]);await recalculateRoute();return true;
}
async function removeVia(index){if(draftActive()){removeDraftPoint(index+1);return;}if(index<0||index>=viaPoints.length)return;viaPoints.splice(index,1);await recalculateRoute();}
function cancelRouteDrag(){
 if(!routeDrag)return;const drag=routeDrag;routeDrag=null;window.removeEventListener('pointermove',drag.move);window.removeEventListener('pointerup',drag.up);window.removeEventListener('pointercancel',drag.cancel);window.removeEventListener('blur',drag.blur);drag.ghost?.remove();drag.guide?.remove();if(drag.mapWasDraggable)map.dragging?.enable();
}
function startRouteDrag(event){
 if(mode!=='route'||!canDraw()||!snapped||endpoints.length<2||event.button!==undefined&&event.button!==0||event.isPrimary===false)return;
 closePointSettings(false);if(viaPoints.length>=pointLimit()-2)return toast(`Maximum ${pointLimit()-2} points de passage.`);
 event.preventDefault();event.stopPropagation();const at=map.mouseEventToLatLng(event),point=[at.lat,at.lng],controls=routeControls(),index=insertionIndex(selected,controls,point,routeLegFractions);cancelSnap();
 const mapWasDraggable=map.dragging?.enabled?.()===true;map.dragging?.disable();
 const ghost=L.marker(point,{interactive:false,icon:L.divIcon({className:'route-control route-via route-ghost',html:'+',iconSize:[22,22]})}).addTo(map);
 const guide=L.polyline([controls[index-1],point,controls[index]],{pane:'portionPane',interactive:false,color:'#b5654c',weight:3,dashArray:'5 6'}).addTo(map);
 const drag={pointerId:event.pointerId,index,point,start:[event.clientX,event.clientY],moved:false,mapWasDraggable,ghost,guide};routeDrag=drag;
 drag.move=e=>{if(e.pointerId!==drag.pointerId)return;e.preventDefault();const p=map.mouseEventToLatLng(e);drag.point=[p.lat,p.lng];drag.moved=drag.moved||Math.hypot(e.clientX-drag.start[0],e.clientY-drag.start[1])>5;ghost.setLatLng(p);guide.setLatLngs([controls[index-1],drag.point,controls[index]]);};
 drag.up=e=>{if(e.pointerId!==drag.pointerId)return;e.preventDefault();const p=map.mouseEventToLatLng(e),moved=drag.moved||Math.hypot(e.clientX-drag.start[0],e.clientY-drag.start[1])>5;cancelRouteDrag();if(moved)routeClickSuppressed=Date.now()+400;if(moved)void insertVia(index,[p.lat,p.lng]);};
 drag.cancel=e=>{if(e.pointerId===drag.pointerId)cancelRouteDrag();};window.addEventListener('pointermove',drag.move,{passive:false});window.addEventListener('pointerup',drag.up);window.addEventListener('pointercancel',drag.cancel);drag.blur=cancelRouteDrag;window.addEventListener('blur',drag.blur);
}
function drawSelection(){
 if(view!=='planner')renderMapLegend();if(!map)return;const color=$('planColorMode').value||'simple',runs=view==='planner'?routeRenderRuns(planDraft.legs,color,currentProfile()):null,stamp=[view,mode,canDraw(),...(view==='planner'?[color,runs,...planDraft.points]:selected)],redraw=stamp.length!==selectionStamp.length||stamp.some((v,i)=>v!==selectionStamp[i]);if(redraw){selectionLayer.clearLayers();selectionStamp=stamp;}marks.clearLayers();accessLayer?.clearLayers();kilometreLayer?.clearLayers();if(!profileActive())clearElevationCursor();
 if(redraw&&selected.length>1){L.polyline(selected,{pane:'portionPane',color:'#faf8f1',weight:10,opacity:1,interactive:false}).addTo(selectionLayer);
  if(view==='planner'){if(color==='slope')L.polyline(selected,{pane:'portionPane',color:'#53625c',weight:8,opacity:.65,interactive:false}).addTo(selectionLayer);for(const run of runs)L.polyline(run.coordinates,{pane:'portionPane',color:run.color,weight:6,opacity:1,dashArray:run.dashArray,interactive:false}).addTo(selectionLayer);}else L.polyline(selected,{pane:'portionPane',color:'#b5654c',weight:6,opacity:1,interactive:false}).addTo(selectionLayer);
  if(mode==='route'&&canDraw()){const line=L.polyline(selected,{pane:'portionPane',color:'#b5654c',weight:20,opacity:0,interactive:true,className:'routing-draggable'}).addTo(selectionLayer);line.on('click',e=>{L.DomEvent.stopPropagation(e);if(Date.now()>routeClickSuppressed){const point=[e.latlng.lat,e.latlng.lng];void insertVia(insertionIndex(selected,routeControls(),point,routeLegFractions),point);}});const path=line.getElement?.();if(path)path.addEventListener('pointerdown',startRouteDrag,{passive:false});}
 }
 if(draftActive())drawAccessWarnings();
 if(view==='planner'&&planViewing){drawKilometres();renderMapLegend();return;}kilometreLayer?.clearLayers();
 const markerPoints=mode==='route'&&endpoints.length?routeControls():mode!=='manual'&&endpoints.length?endpoints:selected;
 for(const[i,p]of markerPoints.entries()){
  if(!(canDraw()&&(mode==='manual'||mode==='route'&&endpoints.length))&&i!==0&&i!==markerPoints.length-1)continue;
  const editable=mode==='route'&&canDraw()&&endpoints.length>0,via=editable&&i>0&&i<markerPoints.length-1,label=i===0?'A':i===markerPoints.length-1?'B':String(i),title=i===0?'Départ':i===markerPoints.length-1?'Arrivée':`Passage ${i}`;
  const marker=L.marker(p,{pane:'markerPane',draggable:editable,title:editable?`${title} · glisser pour déplacer`:title,alt:title,autoPan:editable,icon:L.divIcon({className:editable?`route-control ${via?'route-via':i?'route-finish':'route-start'}${selectedPlanPoint===i?' route-selected':''}`:'endpoint',html:editable?label:'',iconSize:editable?[24,24]:[15,15]})}).bindTooltip(editable?`${title} · glisser${via?' · double-clic pour retirer':''}`:title).addTo(marks);
  if(editable){marker.on('click',e=>{L.DomEvent.stopPropagation(e);openPointSettings(i);});marker.on('dragstart',()=>{closePointSettings(false);cancelSnap();geometryChanged=true;snapped=false;update();});marker.on('dragend',e=>{const q=e.target.getLatLng();if(validMapPoint([q.lat,q.lng]))void moveRouteControl(i,[q.lat,q.lng]);else{marker.setLatLng(p);drawSelection();}});
   if(via){marker.on('dblclick',e=>{L.DomEvent.stopPropagation(e);void removeVia(i-1);});marker.on('contextmenu',e=>{L.DomEvent.stopPropagation(e);void removeVia(i-1);});marker.getElement?.()?.addEventListener('keydown',e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();void removeVia(i-1);}});}
  }
 }
}
function drawAccessWarnings(){
 if(!accessLayer)return;accessLayer.clearLayers();let count=0;const pixels=[];for(const leg of planDraft.legs)for(const run of leg.analysis?.accessRuns||[]){if(count>=100)return;if(run.coordinates?.length<2)continue;let point=accessMidpoints.get(run);if(!point){const model=buildElevationModel([{coordinates:run.coordinates}]);point=pointAtDistance(model,model.total/2);if(point)accessMidpoints.set(run,point);}if(!point||map.getBounds&&!map.getBounds().contains(point))continue;const pixel=map.latLngToContainerPoint?.(point);if(pixel){if(pixels.some(p=>Math.hypot(p.x-pixel.x,p.y-pixel.y)<30))continue;pixels.push(pixel);}
 const marker=L.marker(point,{pane:'markerPane',title:run.label,alt:'Accès limité',bubblingMouseEvents:false,icon:L.divIcon({className:'access-warning',html:'!',iconSize:[18,18]})}).bindTooltip(escapeHTML(run.label)).addTo(accessLayer);marker.on('click',e=>{L.DomEvent.stopPropagation(e);if(canDraw())choose(e.latlng);});count++;}
}
function fit(points=trace){if(map)map.invalidateSize({pan:false});if(map&&points.length>1)map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[30,30],paddingBottomRight:[innerWidth>850&&canDraw()&&!document.fullscreenElement&&!document.body.classList.contains('map-expanded')?370:30,40]});}
function drawRoute(recenter=true){renderMapLegend();if(!map)return;routeLayer.clearLayers();if(!trace.length||$('showLoadedRide').checked===false)return;L.polyline(trace,{pane:'gpxPane',color:'#fff',weight:9,opacity:.9}).addTo(routeLayer);L.polyline(trace,{pane:'gpxPane',color:'#607d88',weight:5,opacity:.85}).addTo(routeLayer).on('click',e=>{L.DomEvent.stopPropagation(e);choose(e.latlng);});if(recenter)fit();}
function gpxBetween(points){
 if(points.length<2)return points.map(p=>[...p]);if(!trace.length)throw Error('Choisissez une sortie pour suivre son GPX. Vos points sont conservés.');
 const indices=points.map(point=>{let best=Infinity,index=0;trace.forEach((p,i)=>{const d=distance(p,point);if(d<best){best=d;index=i;}});if(best>200)throw Error('Un point est trop loin du GPX. Vos points sont conservés ; choisissez le routage ou le mode manuel.');return index;});
 if(indices[0]===indices[1])throw Error('Les deux points correspondent au même point du GPX.');
 const range=trace.slice(Math.min(...indices),Math.max(...indices)+1);return indices[1]<indices[0]?range.reverse():range;
}
function choose(latlng){
 if(!canDraw()||busy&&!draftActive()&&!(mode==='route'&&endpoints.length===1))return;
 if(view==='planner'||mode==='route'){if(view!=='planner')ensureSegmentDraft();choosePlanPoint([latlng.lat,latlng.lng]);return;}
 let point=[latlng.lat,latlng.lng];if(mode==='snap'){if(!trace.length)return toast('Choisissez une sortie GPX / Strava ou le routage entre deux points.');const clicked=point;let best=Infinity;for(const p of trace){const d=distance(p,clicked);if(d<best){best=d;point=p;}}if(best>200)return toast('Cliquez plus près de la trace GPX.');}
 cancelSnap();geometryChanged=true;snapped=false;modeDrafts.clear();viaPoints=[];routeLegFractions=null;
 if(mode==='manual'){rememberSegment();selected.push([...point]);endpoints=selected.length>1?[selected[0],selected.at(-1)]:[selected[0]];first=endpoints[0];last=endpoints.length>1?endpoints[1]:null;gpsSelection=[];status('Tracé manuel : ajoutez des points pour suivre le chemin.');drawSelection();update();return;}
 if(endpoints.length!==1){endpoints=[[...point]];first=point;last=null;selected=[[...point]];gpsSelection=[];drawSelection();status('Accrochage du départ au réseau OSM…');if(mode==='route')void snapFirstPoint();}
 else{if(distance(endpoints[0],point)<5)return toast('Choisissez une arrivée différente.');endpoints.push([...point]);first=endpoints[0];last=endpoints[1];try{gpsSelection=mode==='snap'?gpxBetween(endpoints):endpoints.map(p=>[...p]);selected=gpsSelection.map(p=>[...p]);drawSelection();void snap();}catch(e){status(e.message);}}
 update();
}
async function snapFirstPoint(){
 if(mode!=='route'||endpoints.length!==1)return;cancelSnap();const version=snapVersion;snapController=new AbortController();busy=true;update();
 try{const result=await post('/api/route/nearest',{point:endpoints[0],allowRestricted:true,tolerance:Number($('snapTolerance').value||150)},{signal:snapController.signal});if(version!==snapVersion||endpoints.length!==1)return;endpoints=[[...result.point]];first=endpoints[0];selected=endpoints.map(p=>[...p]);status('Départ accroché à OSM. Choisissez la suite du parcours.');drawSelection();}
 catch(e){if(version===snapVersion)status(`Départ non accroché : ${e.message}`);}
 finally{if(version===snapVersion){busy=false;update();}}
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
  const worker=new Worker('/osm-worker.js?v=6.17.0',{type:'module'});snapWorker=worker;workerReject=reject;
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
 if(routeLength(gpsSelection)>(view==='planner'?500000:15000)){status(view==='planner'?'Itinéraire limité à 500 km.':'Calcul limité à 15 km. Rapprochez les points ou passez en manuel.');update();return;}
 busy=true;update();status(mode==='route'?'Calcul d’un itinéraire vélo sur OSM…':'Suivi de la trace GPX sur les chemins OSM…');showProgress({stage:mode==='route'?'route':'download'});snapController=new AbortController();
 try{const tolerance=Number($('snapTolerance')?.value||150);let result;
  if(mode==='route'){const points=endpoints.length===2?routeControls():gpsSelection;result=await post('/api/route',{points,tolerance,allowRestricted:true,...(view==='planner'?{purpose:'itinerary'}:{})},{signal:snapController.signal});}
  else{const data=await osmData(gpsSelection,tolerance,version);if(version!==snapVersion)return;result=await calculateOSM(gpsSelection,data.elements||[],tolerance,version);}
  if(version!==snapVersion)return;selected=result.coordinates;snapped=true;if(mode==='route'){routeLegFractions=result.legFractions||null;const snappedPoints=result.snappedPoints;if(snappedPoints?.length===routeControls().length){endpoints=[[...snappedPoints[0]],[...snappedPoints.at(-1)]];viaPoints=snappedPoints.slice(1,-1).map(p=>[...p]);first=endpoints[0];last=endpoints[1];gpsSelection=routeControls();}else if(endpoints.length===2&&viaPoints.length===0){endpoints=[[...selected[0]],[...selected.at(-1)]];first=endpoints[0];last=endpoints[1];gpsSelection=routeControls();}}drawSelection();
  if(mode==='route'&&view!=='planner'){surfaceSuggestion(null);void routeSurface(selected,version);}else surfaceSuggestion(result.surface);
  const warning=result.stats.maxOffset>75?` Points décalés du réseau jusqu’à ${result.stats.maxOffset} m : vérifiez le tracé.`:'';
  const ignored=result.stats.ignoredAnchors?` ${result.stats.ignoredAnchors} point(s) GPS isolé(s) écarté(s).`:'';
  status((mode==='route'?'Itinéraire vélo calculé sur OSM. Glissez A ou B pour les déplacer ; glissez la ligne pour ajouter un passage.':'Trace GPX accrochée aux chemins OSM.')+' Vérifiez le tracé orange avant d’enregistrer.'+warning+ignored);
 }catch(e){if(version!==snapVersion)return;status(`Calcul impossible : ${e.message} Départ et arrivée conservés.`);}
 finally{if(version===snapVersion){busy=false;setHidden('snapProgress',true);update();}}
}
function setMode(next){
 if(next==='auto')next='snap';closePointSettings(false);if(view==='planner'){if(next==='snap')return;next==='manual'?$('manualLeg').checked=true:$('manualLeg').checked=false;$('manualLeg').onchange();return;}if(next===mode)return;if(next==='snap'&&(independentOsm||view==='planner')){toast('Le dessin OSM indépendant ne suit pas le GPX. Choisissez le routage ou le mode manuel.');return;}
 const anchors=endpoints.length?endpoints.map(p=>[...p]):selected.length?[selected[0],...(selected.length>1?[selected.at(-1)]:[])]:[];
 let range=[];try{if(next==='snap'&&anchors.length>1)range=gpxBetween(anchors);}catch(e){toast(e.message);return;}
 modeDrafts.set(mode,{draft:segmentDraftActive?planDraft:null,coordinates:selected.map(p=>[...p]),snapped,viaPoints:viaPoints.map(p=>[...p]),legFractions:routeLegFractions});cancelSnap();mode=next;geometryChanged=true;endpoints=anchors;first=anchors[0]||null;last=anchors[1]||null;
 const previous=modeDrafts.get(mode);segmentDraftActive=mode==='route'&&!!previous?.draft;if(segmentDraftActive)planDraft=previous.draft;if(mode==='route'&&previous){viaPoints=previous.viaPoints||[];routeLegFractions=previous.legFractions||null;}selected=previous?.coordinates.map(p=>[...p])||anchors.map(p=>[...p]);snapped=previous?.snapped||false;
 gpsSelection=mode==='snap'?range:mode==='route'?routeControls():[];
 status(mode==='manual'?'Mode manuel. Vos points sont conservés ; ajoutez des points sur la carte.':mode==='route'?'Routage vélo OSM. Départ et arrivée conservés.':'Suivi du GPX. Départ et arrivée conservés.');drawSelection();update();
 if(segmentDraftActive&&mode==='route'){syncPlanner();if(!planDraft.complete())void calculatePlanLegs();return;}if(mode!=='manual'&&gpsSelection.length>1&&!snapped)void snap();
}
function updateMapControlLayout(){
 const root=$('map'),attribution=map?.attributionControl?.getContainer?.(),toolbar=root?.querySelector?.('.sillage-map-toolbar');
 root?.style.setProperty('--map-attribution-height',Math.ceil(attribution?.getBoundingClientRect?.().height||0)+'px');
 if(toolbar)root.style.setProperty('--map-toolbar-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px');
}
if(typeof L!=='undefined'){
 map=L.map('map',{zoomControl:false}).setView([50.49,5.86],11);map.createPane('importsPane');map.getPane('importsPane').style.zIndex=390;map.createPane('gpxPane');map.getPane('gpxPane').style.zIndex=410;map.createPane('portionPane');map.getPane('portionPane').style.zIndex=450;
 const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{updateWhenIdle:true,keepBuffer:3,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
 const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',maxZoom:19});
 const ign=L.tileLayer('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png',{minNativeZoom:7,maxNativeZoom:17,maxZoom:20,tileSize:256,updateWhenIdle:true,keepBuffer:2,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://ngi.be/">IGN Belgique</a> / TomTom · CartoWeb (non commercial)'});
 const cyclosm=L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:20,updateWhenIdle:true,keepBuffer:2,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.cyclosm.org/">CyclOSM</a> / OSM France'});
 activeBaseLayer=osm;layerControl={addBaseLayer(layer,name){const id='base-'+baseLayers.size;baseLayers.set(id,layer);const option=document.createElement('option');option.value=id;option.textContent=name;$('baseMapSelect').append(option);}};for(const [name,layer]of Object.entries({'OpenStreetMap':osm,'Satellite · Esri':satellite,'IGN Belgique · Topo':ign,'CyclOSM · Vélo':cyclosm}))layerControl.addBaseLayer(layer,name);$('baseMapSelect').value='base-0';
 map.createPane('reliefPane');Object.assign(map.getPane('reliefPane').style,{zIndex:350,pointerEvents:'none',mixBlendMode:'multiply'});
 hillshadeLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',{pane:'reliefPane',opacity:1,maxNativeZoom:16,maxZoom:20,updateWhenIdle:true,keepBuffer:2,attribution:'<a href="https://goto.arcgisonline.com/maps/Elevation/World_Hillshade" title="Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, N Robinson, NCEAS, NLS, OS, NMA, Geodatastyrelsen, Rijkswaterstaat, GSA, Geoland, FEMA, Intermap et la communauté SIG">Relief © Esri et contributeurs</a>'});
 if($('showHillshade').checked)hillshadeLayer.addTo(map);
 let reliefFailed=false;hillshadeLayer.on('loading',()=>{reliefFailed=false;});hillshadeLayer.on('tileerror',()=>{reliefFailed=true;if($('showHillshade').checked)$('hillshadeStatus').textContent='Relief indisponible : le fond choisi reste affiché.';});hillshadeLayer.on('load',()=>{if(!reliefFailed&&$('showHillshade').checked)$('hillshadeStatus').textContent='';});
const zoomControl=L.control.zoom({position:'topleft',zoomInTitle:'Zoom avant',zoomOutTitle:'Zoom arrière',zoomInText:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12"/></svg>',zoomOutText:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12"/></svg>'}).addTo(map),toolbar=zoomControl?.getContainer?.();if(toolbar){for(const id of ['sidebarToggle','fit','fullscreenMap','undoPlan','redoPlan','reset','drawSegment','finishDrawing'])toolbar.append($(id));toolbar.classList.add('sillage-map-toolbar');L.DomEvent.disableClickPropagation(toolbar);L.DomEvent.disableScrollPropagation(toolbar);$('mapTools').remove();}
 if(typeof ResizeObserver!=='undefined'){const controlObserver=new ResizeObserver(updateMapControlLayout);for(const node of [toolbar,map.attributionControl?.getContainer?.()])if(node)controlObserver.observe(node);}
 map.on('resize',updateMapControlLayout);
 if(map.attributionControl)map.attributionControl.addAttribution('Routage © OSM · <a href="https://routing.openstreetmap.de/about.html">FOSSGIS / OSRM vélo</a> · <a href="https://www.openstreetmap.org/fixthemap">Corriger la carte</a>');
 const notice=$('mapNotice');let failures=0;
 const showNotice=message=>{if(notice){notice.textContent=message;notice.hidden=false;}};
 let ignFailed=false;ign.on('loading',()=>{ignFailed=false;});ign.on('tileerror',()=>{ignFailed=true;if(map.hasLayer(ign))showNotice('Les tuiles IGN sont indisponibles. Vérifiez la connexion au service CartoWeb ou choisissez un autre fond.');});ign.on('load',()=>{if(!ignFailed&&map.hasLayer(ign))setHidden('mapNotice',true);});
 osm.on('tileerror',()=>{if(!map.hasLayer(osm))return;if(++failures>=3)showNotice('Certaines tuiles OSM ne se chargent pas. Vous pouvez choisir Satellite dans « Carte et légendes ».');});
 osm.on('loading',()=>{failures=0;});
 osm.on('load',()=>{if(failures===0)setHidden('mapNotice',true);});
 cyclosm.on('tileerror',()=>{if(map.hasLayer(cyclosm))showNotice('Le fond CyclOSM est indisponible. Choisissez un autre fond.');});
 satellite.on('tileerror',()=>{if(map.hasLayer(satellite))showNotice('Certaines images satellite sont indisponibles. Vous pouvez revenir à OpenStreetMap.');});
 map.on('baselayerchange',()=>{failures=0;setHidden('mapNotice',true);map.invalidateSize({pan:false});});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{const height=$('mapCanvas').getBoundingClientRect?.().height;if(height)$('workspace').style.setProperty('--mapcanvas-height',height+'px');map.invalidateSize({pan:false});}).observe($('map'));
 const legendElement=$('segmentLegend');if(legendElement&&typeof L.control==='function'){const legendControl=L.control({position:'bottomleft'});legendControl.onAdd=()=>{L.DomEvent.disableClickPropagation(legendElement);L.DomEvent.disableScrollPropagation(legendElement);return legendElement;};legendControl.addTo(map);if(innerWidth<=850)legendElement.open=false;}if(L.control.scale)L.control.scale({position:'bottomright',imperial:false}).addTo(map);
 updateMapControlLayout();
 const help=$('drawingHelp');L.DomEvent?.disableClickPropagation?.(help);L.DomEvent?.disableScrollPropagation?.(help);
 importedLayer=L.layerGroup().addTo(map);catalogLayer=L.layerGroup().addTo(map);routeLayer=L.layerGroup().addTo(map);selectionLayer=L.layerGroup().addTo(map);marks=L.layerGroup().addTo(map);kilometreLayer=L.layerGroup().addTo(map);accessLayer=L.layerGroup().addTo(map);map.on('zoomend moveend',()=>{positionPointSettings();if(draftActive())drawAccessWarnings();if(view==='planner'&&planViewing)drawKilometres();if(($('planMapFilter').value||'all')!=='all')renderLibrary();});map.on('click',e=>{closePointSettings(false);choose(e.latlng);});$('mapFallback').remove();
}else $('mapFallback').textContent='Carte indisponible : vérifiez votre connexion Internet puis rechargez.';
function jumpToMap(){if(innerWidth<=850)$('workspace').scrollIntoView?.({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'instant':'smooth',block:'start'});}
async function loadRide(id){planLoadVersion++;const version=++rideLoadVersion,ride=await api(`/api/rides/${id}`);if(version!==rideLoadVersion)return;ridePreviewVersion++;$('ridePreviewStatus').textContent='';planReadOnly=false;editingPlan=null;reset();$('libraryType').value='rides';$('rideChooser').open=true;currentRide=ride;trace=ride.coordinates;$('showLoadedRide').checked=true;setView('saved');$('mapSubtitle').textContent=ride.name;drawRoute();$('rideSource').value='saved';setHidden('savedRideLibrary',false);setHidden('stravaSidebar',true);$('rideLibraryKind').value='all';$('rideSelect').value=ride.id;renderRides();jumpToMap();}
function renderRides(){
 const select=$('rideSelect'),previous=select.value,available=filterPlans(rides.filter(r=>!$('rideLibraryKind').value||$('rideLibraryKind').value==='all'||(r.source_type||'gpx')===$('rideLibraryKind').value),{...libraryFilters(),scope:'all'});select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=available.length?'— Choisir une sortie —':'Aucune sortie enregistrée';select.append(placeholder);
 for(const r of available){const option=document.createElement('option');option.value=r.id;option.textContent=`${r.name} · ${(r.distance/1000).toFixed(1)} km`;select.append(option);}
 select.value=available.some(r=>r.id===previous)?previous:available.some(r=>r.id===currentRide?.id)?currentRide.id:'';if(select.value!==previous)ridePreviewVersion++;
 $('rideLibraryCount').textContent=`${available.length} sortie(s)`;
 if(currentRide&&select.value===currentRide.id)renderRidePreview(currentRide);else if(!select.value)renderRidePreview(null);
}
function renderRidePreview(ride){
 if(ride===ridePreviewRecord)return;ridePreviewRecord=ride;renderPreview($('rideList'),ride,{label:ride?.source_type==='strava'?'Import Strava · privé':'Ma sortie GPX',meta:ride?`${((ride.distance||routeLength(ride.coordinates))/1000).toFixed(1)} km` :''});
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
 if(remote){await loadStravaStatus();if(stravaState.connected&&stravaState.configured&&!stravaPage)await loadSidebarStrava(true);}renderLibrary();
}
async function loadSidebarStrava(reset=false){
 if(stravaBusy)return;stravaBusy=true;$('stravaMore').disabled=true;$('stravaKind').disabled=true;
 try{const data=await api(`/api/strava/activities?page=${reset?1:stravaPage+1}&kind=${$('stravaKind').value||'gravel'}`);stravaPage=data.page;stravaActivities=(reset?data.activities:[...stravaActivities,...data.activities]).slice(-300);
  renderStravaLibrary(reset);
  $('stravaMore').hidden=!data.hasMore;$('sidebarStravaStatus').textContent=`${stravaActivities.length} sortie(s) chargée(s)${!stravaActivities.length&&data.hasMore?' · cherchez dans les sorties plus anciennes':''}`;previewStrava();
 }catch(e){$('sidebarStravaStatus').textContent=e.message;}
 finally{stravaBusy=false;$('stravaMore').disabled=false;$('stravaKind').disabled=false;renderLibrary();}
}
function renderStravaLibrary(reset=false){
 const select=$('stravaRideSelect'),previous=reset?'':select.value,items=filterPlans(stravaActivities,{...libraryFilters(),scope:'all'});select.replaceChildren();const initial=document.createElement('option');initial.value='';initial.textContent=items.length?'— Choisir une sortie Strava —':'Aucune sortie Strava avec ces filtres';select.append(initial);for(const a of items){const option=document.createElement('option');option.value=a.id;option.textContent=`${new Date(a.startDate).toLocaleDateString('fr-BE')} · ${a.name}`;select.append(option);}select.value=items.some(a=>a.id===previous)?previous:'';previewStrava();
}
function previewStrava(){const activity=stravaActivities.find(a=>a.id===$('stravaRideSelect').value);if(activity!==stravaPreviewRecord){stravaPreviewRecord=activity;renderPreview($('stravaRidePreview'),activity,{label:'Sortie Strava · privée',meta:activity?`${(activity.distance/1000).toFixed(1)} km · ${activity.sportType}`:''});}$('openStravaRide').disabled=!activity||stravaBusy;}
$('rideSelect').onchange=previewRide;$('rideLibraryKind').onchange=()=>{renderLibrary();void previewRide();};$('rideSource').onchange=changeRideSource;
$('stravaRideSelect').onchange=previewStrava;$('stravaKind').onchange=()=>loadSidebarStrava(true);$('stravaMore').onclick=()=>loadSidebarStrava();
$('refreshStrava').onclick=()=>loadSidebarStrava(true);
$('openStravaRide').onclick=async()=>{const id=$('stravaRideSelect').value;if(!id||stravaBusy)return;stravaBusy=true;$('openStravaRide').disabled=true;
 try{const ride=await post('/api/strava/import',{activityId:id});rides=await api('/api/rides');importedTraces=null;if($('showImportedTraces').checked)void loadImportedTraces();await loadRide(ride.id);$('rideSource').value='saved';$('rideLibraryKind').value='all';renderRides();await changeRideSource();toast('Sortie Strava ouverte sur la carte.');}
 catch(e){$('sidebarStravaStatus').textContent=e.message;}finally{stravaBusy=false;previewStrava();}};
$('deleteRide').onclick=async()=>{const id=$('rideSelect').value;if(!id||!confirm('Supprimer cette sortie et les secteurs qui lui sont liés ?'))return;
 try{await api(`/api/rides/${id}`,{method:'DELETE'});if(currentRide?.id===id){currentRide=null;trace=[];routeLayer?.clearLayers();reset();}ridePreviewVersion++;rides=await api('/api/rides');importedTraces=null;if($('showImportedTraces').checked)void loadImportedTraces();$('rideSelect').value='';renderRides();await refreshSegments();renderList();toast('Sortie supprimée.');}catch(e){toast(e.message);}};
function parseGPX(xml){if(xml.querySelector('parsererror'))throw Error('GPX invalide.');const segments=[...xml.getElementsByTagNameNS('*','trkseg')];const read=(root,tag)=>[...root.getElementsByTagNameNS('*',tag)].filter(p=>p.hasAttribute('lat')&&p.hasAttribute('lon')).map(p=>[Number(p.getAttribute('lat')),Number(p.getAttribute('lon'))]).filter(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180);let points=(segments.length?segments:[xml]).map(s=>read(s,'trkpt')).sort((a,b)=>b.length-a.length)[0]||[];if(points.length<2)points=read(xml,'rtept');if(points.length<2||points.length>100000)throw Error('Le GPX doit contenir entre 2 et 100 000 points.');return {points,multi:segments.length>1};}
$('gpx').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>25*1024*1024)throw Error('GPX limité à 25 Mo.');const gpx=await f.text();const xml=new DOMParser().parseFromString(gpx,'application/xml');const {points,multi}=parseGPX(xml),name=xml.getElementsByTagNameNS('*','trk')[0]?.getElementsByTagNameNS('*','name')[0]?.textContent||f.name.replace(/\.gpx$/i,'');const ride=await post('/api/rides',{name,coordinates:points,gpx,fileName:f.name});rides=await api('/api/rides');importedTraces=null;if($('showImportedTraces').checked)void loadImportedTraces();await loadRide(ride.id);toast(multi?'Segment GPX le plus long enregistré (trace interrompue).':'Sortie enregistrée dans votre compte.');}catch(e){toast(e.message);}finally{e.target.value='';}};
$('ratingForm').onsubmit=async e=>{e.preventDefault();if(view!=='explore'||segmentSaving)return;if(selected.length<2||!rating||busy||$('save').disabled)return;const b=$('save');b.disabled=true;segmentSaving=true;const draft=planDraft,signature=JSON.stringify(selected);
 try{if(draftActive())await analysePlanLegs();if(view!=='explore'||draft!==planDraft||JSON.stringify(selected)!==signature)throw Error('Le tracé a changé pendant l’analyse. Enregistrez à nouveau.');const data={name:$('name').value,rating,difficulty:$('difficulty').value,surface:$('surface').value,winter:$('winter').value,singleTrack:$('singleTrack').value,notes:$('notes').value,coordinates:selected,snapped,isPublic:$('publicSegment').checked,mode,routePoints:mode==='route'?routeControls():undefined,legs:segmentDraftActive&&mode==='route'?planDraft.serialise():null,independentOsm,source:independentOsm?'Dessin OSM indépendant':currentRide?.name||'Routage ou tracé manuel',rideId:independentOsm?null:currentRide?.id||null},editing=!!editingSegment;
  if(editing)await api(`/api/portions/${editingSegment.id}`,{method:'PATCH',body:JSON.stringify(data)});else await post('/api/portions',data);
  const keepIndependent=independentOsm;await refreshSegments();reset();if(keepIndependent){independentOsm=true;$('publicSegment').checked=true;update();}renderList();toast(editing?'Secteur modifié.':'Secteur enregistré dans votre compte.');
 }catch(e){toast(e.message);}finally{segmentSaving=false;update();}};
$('independentSegment').onclick=()=>{rideLoadVersion++;ridePreviewVersion++;reset();independentOsm=true;$('publicSegment').checked=true;mode='route';setView('explore');drawRoute();renderRides();status('Dessin OSM indépendant : placez de nouveaux points sur la carte. La sortie Strava reste un repère privé, sans accrochage au GPX.');};
$('surface').onchange=()=>{surfaceTouched=true;};
function filtered(){return visibleSegments(catalog,{mine:$('showMine')?.checked!==false,others:$('showOthers')?.checked!==false,winter:$('winterOnly')?.checked?'yes':$('winterFilter')?.value||'all'});}
function showSegment(r){
 planLoadVersion++;rideLoadVersion++;planReadOnly=false;editingPlan=null;pickedSegmentId=r.id;
 if(r.isMine){reset();editingSegment=r;currentRide=null;trace=[];routeLayer?.clearLayers();mode='route';setView('explore');
  selected=r.coordinates.map(p=>[...p]);const controls=r.mode==='route'&&r.routePoints?.length>=2?r.routePoints:r.mode==='manual'&&selected.length<=200?selected:[selected[0],selected.at(-1)];endpoints=[controls[0],controls.at(-1)];viaPoints=controls.slice(1,-1).map(p=>[...p]);first=endpoints[0];last=endpoints[1];snapped=r.snapped;rating=r.rating;surfaceTouched=true;
  for(const key of ['name','difficulty','surface','winter','singleTrack','notes'])$(key).value=r[key]??(['winter','singleTrack'].includes(key)?'unknown':'');
  segmentDraftActive=false;ensureSegmentDraft();snapped=planDraft.complete(); $('publicSegment').checked=r.isPublic;stars();$('mapSubtitle').textContent=`Modifier : ${r.name}`;status('Modifiez les attributs et enregistrez. Pour changer le tracé, utilisez « Redessiner ».');renderRides();
 }else{reset();setView('saved');viewedSegment=r;planDraft.load(r);selected=r.coordinates;snapped=r.snapped;status(`Secteur public de ${r.owner} : ${r.name}`);toast(`${r.name} · ${r.rating}/5 · ${r.surface} · ${singleTrackLabels[r.singleTrack||'unknown']}`);}
 for(const l of planDraft.legs)if(needsElevation(l))planAnalysisAllowed.add(l.id);
 drawSelection();fit(selected);update();schedulePlanAnalysis();jumpToMap();
}
$('redraw').onclick=()=>{closePointSettings(false);segmentDraftActive=false;planDraft=new ItineraryDraft();cancelSnap();geometryChanged=true;selected=[];endpoints=[];viaPoints=[];routeLegFractions=null;modeDrafts.clear();gpsSelection=[];first=last=null;snapped=false;mode='route';ensureSegmentDraft();status('Placez le départ, puis les points suivants. Les attributs sont conservés.');drawSelection();update();};
function segmentTooltip(segment){
 const rows=[['Plaisir',`${segment.rating}/5`],['Technicité',segment.difficulty||'Non renseignée'],['Revêtement',segment.surface||'Non renseigné'],['Sentier',singleTrackLabels[segment.singleTrack||'unknown']],['Hiver',winterLabels[segment.winter||'unknown']],['Distance',`${((segment.distance||routeLength(segment.coordinates))/1000).toFixed(2)} km`],['Auteur',segment.owner||'Membre'],['Visibilité',segment.isPublic?'Public':'Privé']];
 return `<strong>${escapeHTML(segment.name||'Secteur')}</strong><dl>${rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>${segment.notes?`<p>${escapeHTML(segment.notes)}</p>`:''}`;
}
function drawCatalog({recenter=false}={}){
 if(catalogLayer)catalogLayer.clearLayers();const items=filtered(),colorMode=$('colorMode')?.value||'rating';
 for(const r of items){if(catalogLayer)L.polyline(r.coordinates,{pane:'portionPane',color:segmentColor(r,colorMode),weight:6,opacity:.9,dashArray:r.singleTrack==='yes'?'5 6':null,interactive:true,bubblingMouseEvents:false}).bindTooltip(segmentTooltip(r),{className:'segment-tooltip',sticky:true,direction:'auto'}).on('click',e=>{L.DomEvent.stopPropagation(e);if(canDraw())choose(e.latlng);else showSegment(r);}).addTo(catalogLayer);}
 if($('segmentCount'))$('segmentCount').textContent=`${items.length} secteur(s) affiché(s)`;
 renderMapLegend();
 const framed=[...items,...($('showImportedTraces').checked&&importedTraces?importedTraces:[])];if(recenter&&map&&framed.length){const bounds=L.latLngBounds(framed[0].coordinates);for(const r of framed.slice(1))bounds.extend(r.coordinates);map.invalidateSize({pan:false});map.fitBounds(bounds,{padding:[35,35]});}update();
}
async function refreshSegments(){[records,catalog]=await Promise.all([api('/api/portions'),api('/api/catalog')]);drawCatalog();renderLibrary();}
function renderList(){
 const list=$('savedList'),select=$('segmentSelect'),items=filterPlans(filtered(),libraryFilters());const picked=items.some(s=>s.id===pickedSegmentId)?pickedSegmentId:items[0]?.id||null;pickedSegmentId=picked;if(sectorLibraryStamp?.picked===picked&&sectorLibraryStamp.items.length===items.length&&items.every((item,i)=>item===sectorLibraryStamp.items[i]))return;sectorLibraryStamp={picked,items:items.slice()};disposePreviews(list);list.replaceChildren();select.replaceChildren();
 if(!items.some(s=>s.id===pickedSegmentId))pickedSegmentId=items[0]?.id||null;
 if(!items.length){const o=document.createElement('option');o.value='';o.textContent='Aucun secteur avec ces filtres';select.append(o);return;}
 for(const r of items){const o=document.createElement('option');o.value=r.id;o.textContent=`${r.name} · ${r.owner} · ${r.rating}/5`;select.append(o);}select.value=pickedSegmentId;
 const r=items.find(r=>r.id===pickedSegmentId),div=document.createElement('div');div.className='saveditem preview-card';renderPreview(div,r,{label:r.isMine?'Mon secteur':`Secteur de ${r.owner}`,meta:`${'★'.repeat(r.rating)} · ${(r.distance/1000).toFixed(2)} km · ${r.surface}`});
 const attributes=document.createElement('p');attributes.className='preview-meta';attributes.textContent=`${r.isPublic?'Public':'Privé'} · ${winterLabels[r.winter]||winterLabels.unknown} · ${singleTrackLabels[r.singleTrack||'unknown']}`;div.append(attributes);
 if(r.notes){const notes=document.createElement('p');notes.className='preview-note';notes.textContent=r.notes;div.append(notes);}
 const show=document.createElement('button');show.className='outline';show.textContent=r.isMine?'Modifier sur la carte':'Afficher sur la carte';show.onclick=()=>showSegment(r);div.append(show);
 if(r.isMine){const del=document.createElement('button');del.className='textbutton danger';del.textContent='Supprimer ce secteur';del.onclick=async()=>{if(!confirm(`Supprimer « ${r.name} » ?`))return;try{await api(`/api/portions/${r.id}`,{method:'DELETE'});reset();await refreshSegments();renderList();}catch(e){toast(e.message);}};div.append(del);}list.append(div);
}
$('segmentSelect').onchange=()=>{pickedSegmentId=$('segmentSelect').value;renderList();};
function applySidebarState(){
 document.body.classList.toggle('sidebar-collapsed',sidebarCollapsed);const button=$('sidebarToggle'),label=sidebarCollapsed?'Déplier la bibliothèque':'Replier la bibliothèque';button.setAttribute('aria-expanded',String(!sidebarCollapsed));button.setAttribute('aria-label',label);button.setAttribute('title',label);button.classList.toggle('is-collapsed',sidebarCollapsed);map?.invalidateSize({pan:false});
}
$('sidebarToggle').onclick=()=>{sidebarCollapsed=!sidebarCollapsed;applySidebarState();};
function setView(v){
 view=v;const saved=v==='saved',planning=v==='planner',exploring=v==='explore';
 setHidden('rideList',false);setHidden('stravaSidebar',$('rideSource').value!=='strava');setHidden('catalogFilters',false);setHidden('editorPanel',saved);setHidden('gpxLegend',true);setHidden('segmentLegend',false);
 $('listTitle').textContent='Votre bibliothèque';setHidden('source',false);setHidden('ratingForm',!exploring);setHidden('planForm',!planning);
 if(saved){drawRoute(false);$('mapSubtitle').textContent=currentRide?.name||'Secteurs personnels et publics';drawCatalog();}else{drawCatalog();$('mapSubtitle').textContent=planning?'Préparez votre prochaine sortie':currentRide?.name||'Deux points sur la carte, ou une sortie GPX';}
 if(exploring&&mode==='route')ensureSegmentDraft();applySidebarState();drawImportedTraces();renderLibrary();drawRoute(false);update();
}
$('undo').onclick=()=>{geometryChanged=true;selected.pop();viaPoints=[];routeLegFractions=null;endpoints=selected.length>1?[selected[0],selected.at(-1)]:selected.map(p=>[...p]);first=endpoints[0]||null;last=endpoints[1]||null;modeDrafts.clear();drawSelection();update();};$('snap').onclick=()=>draftActive()?calculatePlanLegs():snap();$('snapTolerance').onchange=()=>{if(draftActive()){planDraft.invalidateRoutes();plannerChanged();return;}if(gpsSelection.length>1&&mode!=='manual'&&canDraw())void snap();};$('reset').onclick=()=>{if(view==='planner'){clearCurrentPlan();return;}newPlan();};$('cancelSnap').onclick=()=>{cancelSnap();status('Calcul annulé. Choisissez le mode manuel ou réessayez OSM.');update();};
$('finishDrawing').onclick=()=>{planLoadVersion++;planReadOnly=false;rideLoadVersion++;reset();setView('saved');};
$('drawSegment').onclick=()=>{sidebarCollapsed=true;planLoadVersion++;rideLoadVersion++;planReadOnly=false;editingPlan=null;reset();mode='route';setView('explore');drawRoute(false);};
$('hideRide').onclick=()=>{rideLoadVersion++;currentRide=null;trace=[];drawRoute(false);if(mode==='snap')reset();update();};$('openRide').onclick=()=>{const id=$('rideSelect').value;if(id)loadRide(id).catch(e=>toast(e.message));else toast('Choisissez une sortie enregistrée.');};
for(const id of ['showMine','showOthers','winterOnly','winterFilter','colorMode'])$(id).onchange=()=>{$('winterFilter').disabled=$('winterOnly').checked;if(view==='saved'){viewedSegment=null;selected=[];drawSelection();}drawCatalog();renderList();};$('fit').onclick=()=>{if(view==='saved'&&!trace.length)drawCatalog({recenter:true});else fit(selected.length>1?selected:trace);};

$('logout').onclick=async()=>{try{await post('/api/logout',{});location.replace('/login.html');}catch(e){toast(e.message);}};
function drawImportedTraces(){
 renderMapLegend();importedLayer?.clearLayers();if(!$('showImportedTraces').checked||!importedTraces||!importedLayer)return;
 for(const ride of importedTraces)L.polyline(ride.coordinates,{pane:'importsPane',color:'#71848b',weight:3,opacity:.55,interactive:!canDraw()}).bindTooltip(escapeHTML(ride.name)).on('click',e=>{L.DomEvent.stopPropagation(e);toast(ride.name);}).addTo(importedLayer);
}
async function loadImportedTraces(){
 const version=++overlayVersion;drawImportedTraces();if(!$('showImportedTraces').checked){$('importedTracesStatus').textContent='';return;}
 $('importedTracesStatus').textContent='Chargement de vos traces…';
 try{const items=importedTraces||await api('/api/rides/overlay');if(version!==overlayVersion||!$('showImportedTraces').checked)return;importedTraces=items;drawImportedTraces();$('importedTracesStatus').textContent=`${items.length} trace(s) personnelle(s) affichée(s)`;if(view==='saved')drawCatalog({recenter:true});}
 catch(e){if(version===overlayVersion)$('importedTracesStatus').textContent=e.message;}
}
$('showImportedTraces').onchange=loadImportedTraces;
$('showLoadedRide').onchange=()=>drawRoute(false);
$('baseMapSelect').onchange=()=>{const next=baseLayers.get($('baseMapSelect').value);if(!map||!next||next===activeBaseLayer)return;activeBaseLayer?.remove();next.addTo(map);activeBaseLayer=next;setHidden('mapNotice',true);map.invalidateSize({pan:false});};
$('showHillshade').onchange=()=>{const enabled=$('showHillshade').checked;$('hillshadeStatus').textContent='';if(!hillshadeLayer)return;if(enabled)hillshadeLayer.addTo(map);else hillshadeLayer.remove();};


function ensureSegmentDraft(){
 if(segmentDraftActive)return;segmentDraftActive=true;planDraft=new ItineraryDraft();if(selected.length>=2){planDraft.load({coordinates:selected,routePoints:routeControls(),mode:editingSegment?.mode==='manual'?'manual':'route',legs:editingSegment?.legs});}else if(endpoints.length)planDraft.append(endpoints[0]);planKnownLegs=new Set(planDraft.legs.map(l=>l.id));
}
function rememberSegment(){segmentPast.push({selected:selected.map(p=>[...p]),endpoints:endpoints.map(p=>[...p])});if(segmentPast.length>60)segmentPast.shift();segmentFuture.length=0;}
function manualSegmentHistory(redo){const from=redo?segmentFuture:segmentPast,to=redo?segmentPast:segmentFuture;if(!from.length)return;to.push({selected:selected.map(p=>[...p]),endpoints:endpoints.map(p=>[...p])});const state=from.pop();selected=state.selected;endpoints=state.endpoints;first=endpoints[0]||null;last=endpoints[1]||null;geometryChanged=true;drawSelection();update();}
function syncPlanner(){
 selected=planDraft.coordinates();const points=planDraft.points;endpoints=points.length>1?[points[0],points.at(-1)]:points.map(p=>[...p]);viaPoints=points.slice(1,-1);routeLegFractions=planDraft.fractions();first=endpoints[0]||null;last=endpoints[1]||null;gpsSelection=points.map(p=>[...p]);snapped=planDraft.complete();busy=planDraft.legs.some(l=>!l.coordinates);mode='route';drawSelection();update();positionPointSettings();
}
function plannerChanged(){for(const l of planDraft.legs)if(!planKnownLegs.has(l.id))planAnalysisAllowed.add(l.id);planKnownLegs=new Set(planDraft.legs.map(l=>l.id));planViewing=false;geometryChanged=true;profileCache=null;mainChartModel=null;clearElevationCursor();modeDrafts.clear();syncPlanner();if(selectedPlanPoint!==null&&selectedPlanPoint>=planDraft.points.length)closePointSettings(false);status('Tracé modifié. Seules les étapes concernées sont recalculées.');clearTimeout(planRecalcTimer);planRecalcTimer=setTimeout(()=>{planRecalcTimer=null;void calculatePlanLegs();},100);}
async function calculatePlanLegs(){
 if(planRoutingRunning||!draftActive()||!canDraw())return;planRoutingRunning=true;let failed=false;
 try{for(;;){if(!draftActive()||!canDraw())break;const draft=planDraft,i=draft.legs.findIndex(l=>!l.coordinates);if(i<0)break;const edge=draft.legs[i];planRouteController=new AbortController();busy=true;update();status(`Routage de l’étape ${i+1} / ${draft.legs.length}…`);
  try{const result=await post('/api/route',{points:[draft.points[i],draft.points[i+1]],purpose:'itinerary',tolerance:150,allowRestricted:true},{signal:planRouteController.signal});if(draft!==planDraft||!draftActive()||!canDraw())continue;if(draft.resolve(edge.id,result)){syncPlanner();if(result.warning)toast(result.warning);}}
  catch(e){if(draft!==planDraft||e.name==='AbortError')continue;if(!draft.legs.some(l=>l.id===edge.id))continue;status(`Cette étape ne peut pas être routée : ${e.message} Annulez-la puis activez « Sans routage » pour la dessiner localement, ou réessayez.`);failed=true;break;}
 }}finally{planRoutingRunning=false;if(draftActive()){busy=false;syncPlanner();if(!failed&&planDraft.complete())status(planDraft.legs.find(l=>l.routingWarning)?.routingWarning||'Itinéraire calculé. Glissez les points ou la ligne pour ajuster localement le parcours.');updateSegmentSurfaceSuggestion();schedulePlanAnalysis();}}
}
const needsElevation=l=>!!l.coordinates&&(!l.analysis||!Object.hasOwn(l.analysis,'elevation'));
const surfaceUncertain=l=>!Array.isArray(l.analysis?.surfaces)||!Array.isArray(l.analysis?.surfaceRuns)||l.analysis.surfaces.length===0||l.analysis.surfaces.some(s=>s.type==='Inconnu'&&s.distance>1)||(l.analysis.errors||[]).some(e=>e.toLowerCase().includes('revêtement'));
const needsSurface=l=>!!l.coordinates&&surfaceUncertain(l)&&!surfaceReviewed.has(l.analysis);
const knownSurfaceMeters=a=>(a?.surfaces||[]).reduce((n,s)=>n+(s.type==='Inconnu'?0:s.distance),0);
// Enrichment fills unknown intervals, keeping the explicit tags of routed ways.
function mergeSurfaceResult(edge,data){
 const previous=edge.analysis||{},path=edge.coordinates,total=routeLength(path),spans=analysis=>{
  if(!analysis?.surfaceRuns?.length)return null;let at=0,previousPoint=path[0];const out=[];
  for(const run of analysis.surfaceRuns){if(!run.coordinates?.length||distance(previousPoint,run.coordinates[0])>.5)return null;const length=routeLength(run.coordinates);out.push({start:at,end:at+length,run});at+=length;previousPoint=run.coordinates.at(-1);}
  if(Math.abs(at-total)>2||distance(previousPoint,path.at(-1))>.5)return null;out.at(-1).end=total;return out;
 },a=spans(previous),b=spans(data),errors=[...(previous.errors||[]).filter(e=>!e.toLowerCase().includes('revêtement')),...(data.errors||[])];
 if(data.errors?.length)return {...previous,surfaces:previous.surfaces||[],surfaceRuns:previous.surfaceRuns||[],errors};
 if(!a||!b){const chosen=knownSurfaceMeters(data)>=knownSurfaceMeters(previous)?data:previous;return {...previous,...chosen,errors};}
 const cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative.at(-1)+distance(path[i-1],path[i]));
 const locate=at=>{let lo=0,hi=path.length-2;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(cumulative[mid]<=at)lo=mid;else hi=mid-1;}return lo;},atPoint=at=>{const i=locate(at),length=cumulative[i+1]-cumulative[i],t=length?Math.max(0,Math.min(1,(at-cumulative[i])/length)):0;return path[i].map((v,k)=>v+(path[i+1][k]-v)*t);};
 const cuts=[...new Set([0,total,...a.map(s=>Math.min(total,s.end)),...b.map(s=>Math.min(total,s.end))])].sort((x,y)=>x-y),runs=[],lengths=new Map();let ai=0,bi=0;
 for(let i=1;i<cuts.length;i++){const start=cuts[i-1],end=cuts[i];if(end-start<.00001)continue;while(ai<a.length-1&&a[ai].end<=start+.00001)ai++;while(bi<b.length-1&&b[bi].end<=start+.00001)bi++;const info=a[ai].run.type==='Inconnu'?b[bi].run:a[ai].run,coordinates=[atPoint(start)];for(let j=locate(start)+1;j<path.length&&cumulative[j]<end-.00001;j++)coordinates.push(path[j]);coordinates.push(atPoint(end));const previousRun=runs.at(-1);if(previousRun?.type===info.type&&previousRun.unpaved===info.unpaved)previousRun.coordinates.push(...coordinates.slice(1));else runs.push({type:info.type,unpaved:info.unpaved,coordinates});lengths.set(info.type,(lengths.get(info.type)||0)+end-start);}
 return {...previous,...data,surfaceRuns:runs,surfaces:[...lengths].map(([type,distance])=>({type,distance})),accessRuns:previous.accessRuns?.length?previous.accessRuns:data.accessRuns||[],errors};
}
function updateSegmentSurfaceSuggestion(){
 if(view!=='explore'||!draftActive()||!planDraft.complete())return;const summary=planSummary(planDraft.legs),types={'Asphalte / bitume':'Asphalte','Béton':'Asphalte','Revêtu (non précisé)':'Asphalte','Gravier fin':'Gravier fin','Gravier':'Gravier fin','Gravier compacté':'Gravier fin','Terre':'Chemin de terre','Boue':'Chemin de terre','Herbe':'Chemin de terre','Non revêtu':'Chemin de terre','Non revêtu (tracktype)':'Chemin de terre','Sable':'Sable','Pierres':'Cailloux / pierres','Roches':'Grosses pierres / blocs','Pavés':'Cailloux / pierres'},totals={};let known=0;for(const [type,meters]of Object.entries(summary.surfaces)){if(type==='Inconnu')continue;known+=meters;const label=types[type]||'Mixte';totals[label]=(totals[label]||0)+meters;}const top=Object.entries(totals).sort((a,b)=>b[1]-a[1])[0];surfaceSuggestion(top?{type:top[1]>=known*.6?top[0]:'Mixte',coverage:summary.surfaceCoverage}:null);if(!top&&summary.failures)$('surfaceSource').textContent='Revêtements OSM temporairement indisponibles. Vous pouvez les renseigner ou laisser la nouvelle tentative automatique se faire.';
}
function retryUncertainSurface(draft,edge){
 const current=draft.legs.find(l=>l.id===edge.id);if(!current||!surfaceUncertain(current)||surfaceRetries.has(edge.coordinates))return;surfaceRetries.set(edge.coordinates,1);surfaceRetryTimers.set(edge.coordinates,setTimeout(()=>{surfaceRetryTimers.delete(edge.coordinates);const live=draft.legs.find(l=>l.id===edge.id);if(draft!==planDraft||!draftActive()||!canDraw()||live?.coordinates!==edge.coordinates)return;if(live.analysis)surfaceReviewed.delete(live.analysis);planAnalysisAllowed.add(edge.id);void analysePlanLegs(true);},65000));
} 
function schedulePlanAnalysis(){clearTimeout(planAnalysisTimer);if(!planDraft.legs.some(l=>planAnalysisAllowed.has(l.id)&&(needsElevation(l)&&!surfaceOnlyReview.has(l.id)||draftActive()&&needsSurface(l))))return;planAnalysisTimer=setTimeout(()=>{planAnalysisTimer=null;void analysePlanLegs();},300);}
function analysePlanLegs(retry=false){clearTimeout(planAnalysisTimer);planAnalysisTimer=null;if(planAnalysisTask)return planAnalysisTask;planAnalysisTask=runPlanAnalysis(retry).finally(()=>{planAnalysisTask=null;});return planAnalysisTask;}
function updateAnalysisDisplay(kind){if(view!=='planner'){if(kind==='surface'&&view==='explore'){updateSegmentSurfaceSuggestion();drawAccessWarnings();}updateElevationPanel();return;}if(kind==='surface'||['slope','altitude'].includes($('planColorMode').value))drawSelection();updatePlanStats();}
async function runPlanAnalysis(retry=false){
 if(planMetricsRunning||!profileActive())return;planMetricsRunning=true;updatePlanStats();
 try{for(;;){if(!profileActive())break;const draft=planDraft,eligible=draft.legs.filter(l=>planAnalysisAllowed.has(l.id)&&l.coordinates),batch=eligible.filter(l=>needsElevation(l)&&!surfaceOnlyReview.has(l.id));planMetricsController=new AbortController();
  if(batch.length){try{const data=await post('/api/plan-elevations',{paths:batch.map(l=>l.coordinates),retry},{signal:planMetricsController.signal});if(draft!==planDraft)continue;if(!Array.isArray(data)||data.length!==batch.length)throw Error('Réponse d’altitude invalide.');batch.forEach((edge,i)=>{const current=draft.legs.find(l=>l.id===edge.id);if(current?.coordinates!==edge.coordinates)return;const result=data[i],errors=(current.analysis?.errors||[]).filter(e=>!e.toLowerCase().includes('altitude'));if(result.error)errors.push(result.error);draft.analyse(edge.id,{...current.analysis,elevation:result.elevation||null,errors});});}
   catch(e){if(draft!==planDraft||e.name==='AbortError')continue;for(const edge of batch){const current=draft.legs.find(l=>l.id===edge.id);if(current?.coordinates===edge.coordinates)draft.analyse(edge.id,{...current.analysis,elevation:null,errors:[...(current.analysis?.errors||[]),'Altitudes indisponibles.']});}}
   if(profileActive()&&draft===planDraft)updateAnalysisDisplay('elevation');continue;
  }
  const edge=draftActive()?eligible.find(needsSurface):null;if(!edge)break;if(view==='explore'&&!surfaceTouched)$('surfaceSource').textContent='Recherche du revêtement OSM…';
  try{const data=await post('/api/plan-metrics',{coordinates:edge.coordinates,kind:'surface',retry},{signal:planMetricsController.signal});if(draft!==planDraft)continue;const current=draft.legs.find(l=>l.id===edge.id);if(current?.coordinates===edge.coordinates)draft.analyse(edge.id,mergeSurfaceResult(current,data));}
  catch(e){if(draft!==planDraft||e.name==='AbortError')continue;const current=draft.legs.find(l=>l.id===edge.id);if(current?.coordinates===edge.coordinates)draft.analyse(edge.id,mergeSurfaceResult(current,{errors:['Revêtements OSM indisponibles.']}));}
  if(draftActive()&&draft===planDraft){const live=draft.legs.find(l=>l.id===edge.id);if(live?.coordinates===edge.coordinates&&live.analysis)surfaceReviewed.add(live.analysis);updateAnalysisDisplay('surface');retryUncertainSurface(draft,edge);}
 }}finally{planMetricsRunning=false;updatePlanStats();}
}
async function refreshPlanSurfaces(){
 if(view!=='planner'||planMetricsRunning||planAnalysisTask)return;clearTimeout(planAnalysisTimer);planAnalysisTimer=null;const draft=planDraft;planMetricsRunning=true;updatePlanStats();
 const job=(async()=>{for(const edge of draft.legs.slice()){
  if(draft!==planDraft||view!=='planner')break;if(!edge.coordinates)continue;planMetricsController=new AbortController();
  try{const data=await post('/api/plan-metrics',{coordinates:edge.coordinates,kind:'surface',retry:true},{signal:planMetricsController.signal});if(data.errors?.length&&!data.surfaceRuns?.length)throw Error('Revêtements OSM indisponibles.');const current=draft.legs.find(l=>l.id===edge.id);if(draft===planDraft&&current?.coordinates===edge.coordinates){const errors=(current.analysis?.errors||[]).filter(e=>!e.toLowerCase().includes('revêtement'));draft.analyse(edge.id,{...current.analysis,surfaces:data.surfaces||[],surfaceRuns:data.surfaceRuns||[],accessRuns:data.accessRuns||[],surfaceVersion:data.surfaceVersion,errors:[...errors,...(data.errors||[])]});}}
  catch(e){if(e.name==='AbortError')break;if(draft===planDraft)toast('Revêtements indisponibles : les données précédentes sont conservées.');break;}
  if(draft===planDraft&&view==='planner')updateAnalysisDisplay('surface');
 }})();planAnalysisTask=job;try{await job;}finally{if(planAnalysisTask===job)planAnalysisTask=null;planMetricsRunning=false;updatePlanStats();}
}
function requestMissingAnalysis(){
 if(!profileActive()||planMetricsRunning)return;for(const l of planDraft.legs){if(!l.coordinates)continue;let a=l.analysis?{...l.analysis}:{};if(a.elevation===null)delete a.elevation;surfaceOnlyReview.delete(l.id);if(surfaceUncertain(l)&&l.analysis)surfaceReviewed.delete(l.analysis);if(!Object.hasOwn(a,'elevation')||surfaceUncertain(l)){a.errors=(a.errors||[]).filter(e=>!e.toLowerCase().includes('altitude')&&!e.toLowerCase().includes('revêtement'));planDraft.analyse(l.id,a);planAnalysisAllowed.add(l.id);}}
 void analysePlanLegs(true);
}
function updatePlanStats(){
 if(!$('planElevation'))return;updateElevationPanel();if(view==='planner')renderMapLegend();const summary=planSummary(planDraft.legs);$('planElevation').textContent=summary.elevationCoverage?`D+ ${summary.ascent} m · D− ${summary.descent} m${summary.elevationCoverage<100?' (partiel)':''}`:'Dénivelé indisponible';
 const missing=planDraft.legs.some(l=>needsElevation(l)||surfaceUncertain(l)),pending=planDraft.legs.some(l=>planAnalysisAllowed.has(l.id)&&(needsElevation(l)&&!surfaceOnlyReview.has(l.id)||needsSurface(l)));$('planAnalysisStatus').textContent=(pending||planMetricsRunning?'Analyse des altitudes et des revêtements… ':summary.failures?'Analyse incomplète. ':missing?'Données manquantes : utilisez « Compléter les données ». ':(planDraft.legs.length?'Profil disponible. ':'Placez les points pour obtenir le profil. '))+`Altitudes : ${summary.elevationCoverage} % du tracé · revêtement OSM renseigné : ${summary.surfaceCoverage} %. Estimations à confirmer sur le terrain.`;
 $('planUnpaved').textContent=unpavedLabel(summary);const list=$('planSurfaces');list.replaceChildren();let unknown=summary.surfaces.Inconnu||0;const analysed=Object.values(summary.surfaces).reduce((a,b)=>a+b,0);unknown+=Math.max(0,summary.total-analysed);for(const [type,meters]of Object.entries({...summary.surfaces,Inconnu:unknown})){if(meters<.1)continue;const row=document.createElement('li');row.textContent=`${type} · ${summary.total?Math.round(100*meters/summary.total):0} % · ${(meters/1000).toFixed(1)} km`;row.style.setProperty('--surface-share',(summary.total?Math.min(100,100*meters/summary.total):0)+'%');row.style.setProperty('--surface-color',routeSurfaceColors[type]||routeSurfaceColors.Inconnu);list.append(row);}setHidden('retryAnalysis',!missing&&!summary.failures);$('retryAnalysis').disabled=planMetricsRunning;$('retryAnalysis').textContent='Compléter les données';$('refreshSurfaces').disabled=planMetricsRunning||planDraft.legs.every(l=>!l.coordinates);
}
function choosePlanPoint(point){
 if(!canDraw()||!validMapPoint(point))return;try{planDraft.append(point,$('manualLeg').checked?'manual':'route');plannerChanged();if(planDraft.points.length===1&&!$('manualLeg').checked)void snapPlanStart(planDraft,point);}catch(e){toast(e.message);}
}
async function snapPlanStart(draft,point){
 planStartController=new AbortController();try{const result=await post('/api/route/nearest',{point,tolerance:150,allowRestricted:true},{signal:planStartController.signal});if(draftActive()&&draft===planDraft&&draft.points.length===1&&JSON.stringify(draft.points[0])===JSON.stringify(point)){draft.points[0]=[...result.point];syncPlanner();status('Départ accroché à OSM. Ajoutez la suite du parcours.');}}catch(e){if(draftActive()&&draft===planDraft&&draft.points.length===1&&e.name!=='AbortError')status('Aucun chemin OSM à proximité. Déplacez le départ ou activez la correction sans routage.');}
}
function planHistory(redo=false){if(!draftActive()){if(view==='explore'&&mode==='manual')manualSegmentHistory(redo);return;}closePointSettings(false);cancelRouteDrag();const oldContext=planDraft.context;if(redo?planDraft.redo():planDraft.undo()){if(planDraft.context&&planDraft.context!==oldContext)restorePlanContext(planDraft.context);selectedPlanPoint=null;profileCache=null;mainChartModel=null;clearElevationCursor();syncPlanner();status(redo?'Opération rétablie.':'Dernière opération annulée.');void calculatePlanLegs();}}
$('undoPlan').onclick=()=>planHistory();$('redoPlan').onclick=()=>planHistory(true);$('planName').oninput=update;
$('manualLeg').onchange=()=>status($('manualLeg').checked?'Correction locale sans routage : les prochains points seront reliés directement. Décochez pour reprendre le routage OSM.':'Routage OSM activé pour les prochains points. Les corrections manuelles sont conservées.');
$('retryPlanRoute').onclick=()=>calculatePlanLegs();$('retryAnalysis').onclick=requestMissingAnalysis;$('retryProfile').onclick=requestMissingAnalysis;$('refreshSurfaces').onclick=refreshPlanSurfaces;
document.addEventListener('keydown',e=>{if(view!=='planner'&&!canDraw()||!e.ctrlKey&&!e.metaKey||e.altKey||e.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||''))return;const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();planHistory(key==='y'||e.shiftKey);}});
function newPlan(){
 sidebarCollapsed=true;$('surfaceDetails').open=false;rideLoadVersion++;planLoadVersion++;planReadOnly=false;planViewing=false;editingPlan=null;reset();mode='route';$('planSelect').value='';previewPlan();$('planForm').reset();$('planName').value='';$('planNotes').value='';$('publicPlan').checked=false;$('manualLeg').checked=false;$('waypointDetails').open=false;setView('planner');status('Cliquez pour poser le départ, puis les étapes de votre itinéraire. Chaque clic prolonge le parcours.');
}
async function refreshPlans(){planRecords=await api('/api/plans');syncPlanRangeLimits();renderLibrary();}
function renderPlanLibrary(){
 const select=$('planSelect'),previous=select.value,items=filterPlans(planRecords,{scope:$('planScope').value||'mine',search:$('planSearch').value,...planRangeFilters(),mapFilter:$('planMapFilter').value||'all',bounds:map?.getBounds?.()});select.replaceChildren();
 $('planFilterStatus').textContent=`${items.length} itinéraire(s) sur ${planRecords.length}`;
 const initial=document.createElement('option');initial.value='';initial.textContent=items.length?'— Choisir un itinéraire —':'Aucun itinéraire avec ces filtres';select.append(initial);for(const p of items){const stats=planLibraryStats(p),o=document.createElement('option');o.value=p.id;o.textContent=`${p.name} · ${(stats.distance/1000).toFixed(1)} km${stats.ascent===null?'':` · D+ ${stats.ascent} m`} · ${p.owner}`;select.append(o);}
 select.value=items.some(p=>p.id===previous)?previous:items.some(p=>p.id===editingPlan?.id)?editingPlan.id:'';previewPlan();
}
function libraryFilters(){return {scope:$('planScope').value||'mine',search:$('planSearch').value,...planRangeFilters(),mapFilter:$('planMapFilter').value||'all',bounds:map?.getBounds?.()};}
function renderLibrary(){
 const kind=$('libraryType').value||'plans';$('scopeMineOption').textContent=kind==='segments'?'Mes secteurs':'Mes itinéraires';setHidden('rideChooser',kind!=='rides');setHidden('segmentBrowser',kind!=='segments');setHidden('planLibrary',kind!=='plans');setHidden('planScope',kind==='rides');setHidden('planScopeLabel',kind==='rides');
 renderRides();renderList();renderPlanLibrary();renderStravaLibrary();
 const count=kind==='rides'?filterPlans($('rideSource').value==='strava'?stravaActivities:rides.filter(r=>!$('rideLibraryKind').value||$('rideLibraryKind').value==='all'||(r.source_type||'gpx')===$('rideLibraryKind').value),{...libraryFilters(),scope:'all'}).length:kind==='segments'?filterPlans(filtered(),libraryFilters()).length:filterPlans(planRecords,libraryFilters()).length;
 $('planFilterStatus').textContent=`${count} ${kind==='rides'?'sortie(s)':kind==='segments'?'secteur(s)':'itinéraire(s)'} trouvé(s)`;
}
$('planScope').value='mine';$('libraryType').value='plans';$('libraryType').onchange=()=>{renderLibrary();if($('libraryType').value==='rides')$('rideChooser').open=true;if($('libraryType').value==='segments')$('segmentBrowser').open=true;};
function previewPlan(){
 const p=planRecords.find(p=>p.id===$('planSelect').value);if(p===planPreviewRecord)return;planPreviewRecord=p;renderPreview($('planPreview'),p,{label:p?.isMine?'Mon itinéraire':p?`Itinéraire de ${p.owner}`:'',meta:p?`${(p.distance/1000).toFixed(1)} km · ${p.isPublic?'Public':'Privé'}`:''});
 $('deletePlan').disabled=!p?.isMine;$('exportPlan').hidden=!p;$('copyPlan').disabled=!p;if(p)$('exportPlan').href=`/api/plans/${p.id}/gpx`;renderPlanMiniProfile(p);
}
const planRanges=[{prefix:'planDistance',unit:'km',cap:500,step:1},{prefix:'planAscent',unit:'m',cap:5000,step:10}];let planRangeInitialised=false;
function updatePlanRange(range,changed){
 const lower=$(range.prefix+'Min'),upper=$(range.prefix+'Max');let low=Math.max(0,Math.min(range.cap,Number(lower.value)||0)),high=Math.max(0,Math.min(range.cap,Number(upper.value)||0));if(low>high){if(changed===range.prefix+'Min')low=high;else high=low;}lower.value=String(low);upper.value=String(high);
 const label=low===0&&high===range.cap?(range.unit==='km'?'Toutes les distances':'Tous les dénivelés'):high===range.cap?`≥ ${low} ${range.unit}`:low===0?`≤ ${high} ${range.unit}`:`${low}–${high} ${range.unit}`;$(range.prefix+'Value').textContent=label;$(range.prefix+'Limit').textContent=range.cap+' '+range.unit;$(range.prefix+'Range').style.setProperty('--range-start',100*low/range.cap+'%');$(range.prefix+'Range').style.setProperty('--range-end',100*high/range.cap+'%');lower.setAttribute('aria-valuetext',low+' '+range.unit);upper.setAttribute('aria-valuetext',high===range.cap?'Sans limite':high+' '+range.unit);
}
function syncPlanRangeLimits(){
 for(const range of planRanges){const stats=[...planRecords,...catalog,...rides].map(planLibraryStats),values=stats.map(s=>range.unit==='km'?s.distance/1000:s.ascent).filter(v=>v!==null&&Number.isFinite(v)),round=range.unit==='km'?10:500,newCap=values.length?Math.max(round,Math.ceil(Math.max(...values)/round)*round):range.cap,cap=planRangeInitialised?Math.max(range.cap,newCap):newCap,upper=$(range.prefix+'Max'),wasAll=Number(upper.value)===range.cap;range.cap=cap;for(const suffix of ['Min','Max'])$(range.prefix+suffix).max=String(cap);if(wasAll)upper.value=String(cap);updatePlanRange(range);}
 planRangeInitialised=true;
}
function planRangeFilters(){const out={};for(const range of planRanges){const key=range.unit==='km'?'distance':'ascent',low=Number($(range.prefix+'Min').value),high=Number($(range.prefix+'Max').value);if(low>0)out[key+'Min']=low;if(high<range.cap)out[key+'Max']=high;}return out;}
for(const range of planRanges){$(range.prefix+'Min').value='0';$(range.prefix+'Max').value=String(range.cap);updatePlanRange(range);for(const suffix of ['Min','Max']){const id=range.prefix+suffix;$(id).oninput=()=>{updatePlanRange(range,id);renderLibrary();};}}
$('planSearch').oninput=()=>renderLibrary();
$('planMapFilter').onchange=()=>renderLibrary();
$('resetPlanFilters').onclick=()=>{$('planSearch').value='';for(const range of planRanges){$(range.prefix+'Min').value='0';$(range.prefix+'Max').value=String(range.cap);updatePlanRange(range);}$('planMapFilter').value='all';$('planScope').value='mine';renderLibrary();};
async function loadPlan(id,{copy=false}={}){
 if(!copy&&view==='planner'&&planViewing&&editingPlan?.id===id)return;$('surfaceDetails').open=false;const version=++planLoadVersion,p=await api(`/api/plans/${id}`);if(version!==planLoadVersion)return;rideLoadVersion++;currentRide=null;trace=[];routeLayer?.clearLayers();planReadOnly=false;reset();editingPlan=copy?null:p;planReadOnly=!copy&&!p.isMine;planViewing=!copy;mode='route';planDraft.load(p);planKnownLegs=new Set(planDraft.legs.map(l=>l.id));selected=planDraft.coordinates();const controls=planDraft.points;endpoints=[controls[0],controls.at(-1)].map(q=>[...q]);viaPoints=controls.slice(1,-1);routeLegFractions=planDraft.fractions();snapped=planDraft.complete();first=endpoints[0];last=endpoints[1];$('manualLeg').checked=false;$('waypointDetails').open=false;if(copy)sidebarCollapsed=true;$('planName').value=copy?'Copie de '+p.name:p.name;$('planNotes').value=p.notes||'';$('publicPlan').checked=copy?false:p.isPublic;setView('planner');drawSelection();fit(selected);status(planViewing?'Déplacez le curseur du profil pour suivre l’itinéraire sur la carte.':`Cliquez pour prolonger le parcours ou glissez les marqueurs pour le modifier.`);jumpToMap();
}

$('planSelect').onchange=()=>{previewPlan();const id=$('planSelect').value;if(id)void loadPlan(id).catch(e=>toast(e.message));};$('planScope').onchange=()=>renderLibrary();
$('copyPlan').onclick=()=>{const id=$('planSelect').value;if(id)loadPlan(id,{copy:true}).catch(e=>toast(e.message));};
$('deletePlan').onclick=async()=>{const id=$('planSelect').value;if(!id||!confirm('Supprimer cet itinéraire ?'))return;try{await api(`/api/plans/${id}`,{method:'DELETE'});if(editingPlan?.id===id)newPlan();await refreshPlans();toast('Itinéraire supprimé.');}catch(e){toast(e.message);}};
$('planForm').onsubmit=async e=>{
 e.preventDefault();if(view!=='planner'||planReadOnly||planViewing||planSaving||selected.length<2||busy||!planDraft.complete())return;if(!$('planName').value.trim()){toast('Donnez un nom à votre itinéraire.');$('planName').focus?.();return;}planSaving=true;update();const draft=planDraft,signature=JSON.stringify(selected);
 try{await analysePlanLegs();if(view!=='planner'||draft!==planDraft||JSON.stringify(selected)!==signature)throw Error('Le tracé a changé pendant l’analyse. Enregistrez à nouveau.');const data={name:$('planName').value,notes:$('planNotes').value,isPublic:$('publicPlan').checked,coordinates:selected,routePoints:planDraft.points,legs:planDraft.serialise(),mode:'route',snapped:true};const p=editingPlan?await api(`/api/plans/${editingPlan.id}`,{method:'PATCH',body:JSON.stringify(data)}):await post('/api/plans',data);if(view==='planner'&&draft===planDraft&&JSON.stringify(selected)===signature){editingPlan=p;planViewing=true;planReadOnly=false;selectedPlanPoint=null;$('waypointDetails').open=false;syncPlanner();status('Itinéraire enregistré. Cliquez sur Modifier pour retrouver les points de passage.');}await refreshPlans();if(view==='planner'&&editingPlan?.id===p.id){$('planSelect').value=p.id;previewPlan();}toast('Itinéraire enregistré. Le GPX est disponible dans la bibliothèque.');}
 catch(e){toast(e.message);}finally{planSaving=false;update();}
};

function currentProfile(){
 if(!profileCache||profileCache.draft!==planDraft||profileCache.legs.length!==planDraft.legs.length||profileCache.legs.some((l,i)=>l!==planDraft.legs[i]))profileCache={draft:planDraft,legs:planDraft.legs.slice(),model:buildElevationModel(planDraft.legs)};return profileCache.model;
}
function updateElevationPanel(){
 if(!profileActive())return;const model=currentProfile();if(mainChartModel!==model){renderElevationChart($('elevationGraph'),model,{onSeek:seekElevation,showExtrema:$('profileExtrema').checked});mainChartModel=model;$('elevationSeek').max=Math.max(1,Math.round(model.total));$('elevationSeek').disabled=model.min===null;$('elevationSeek').value='0';$('elevationReadout').textContent=model.min===null?'Altitudes indisponibles ou en cours de calcul.':'Survolez le graphe ou déplacez le curseur.';clearElevationCursor();if(planViewing&&editingPlan?.id===$('planSelect').value&&previewChartNode){previewChartModel=model;renderElevationChart(previewChartNode,model,{compact:true,onSeek:seekElevation});if(previewPercentNode)previewPercentNode.textContent=unpavedLabel(planSummary(planDraft.legs));}}
 if(planViewing&&editingPlan?.id===$('planSelect').value&&previewPercentNode)previewPercentNode.textContent=unpavedLabel(planSummary(planDraft.legs));
 setHidden('retryProfile',!planDraft.legs.some(l=>needsElevation(l)||l.analysis?.elevation===null));$('retryProfile').disabled=planMetricsRunning;const summary=planSummary(planDraft.legs);$('profileSummary').textContent=`${(model.total/1000).toFixed(1)} km${summary.elevationCoverage?` · D+ ${summary.ascent} m · D− ${summary.descent} m`:''}`;
}
function clearElevationCursor(){profileCursor?.remove?.();profileCursor=null;setChartCursor($('elevationGraph'),null);if(previewChartNode)setChartCursor(previewChartNode,null);}
function seekElevation(value){
 if(!profileActive())return;const model=currentProfile(),at=Math.max(0,Math.min(model.total,Number(value))),point=pointAtDistance(model,at),altitude=elevationAt(model,at),slope=slopeAt(model,at);$('elevationSeek').value=String(Math.round(at));$('elevationReadout').textContent=`${(at/1000).toFixed(2)} km · ${altitude===null?'Altitude inconnue':Math.round(altitude)+' m'}${slope===null?'':' · pente '+slope.toFixed(1)+' %'}`;setChartCursor($('elevationGraph'),at);if(previewChartNode&&planViewing&&editingPlan?.id===$('planSelect').value)setChartCursor(previewChartNode,at);
 if(!map||!point)return;if(profileCursor)profileCursor.setLatLng(point);else profileCursor=L.marker(point,{interactive:false,keyboard:false,zIndexOffset:1000,icon:L.divIcon({className:'elevation-map-cursor',html:'',iconSize:[16,16]})}).addTo(map);
}
function drawKilometres(){
 kilometreLayer?.clearLayers();if(!map||!kilometreLayer||view!=='planner'||!planViewing)return;const bounds=map.getBounds?.(),placed=[];for(const mark of kilometreMarkers(currentProfile(),map.getZoom?.()??11)){if(bounds&&!bounds.contains(mark.point))continue;const pixel=map.latLngToContainerPoint?.(mark.point);if(pixel&&placed.some(p=>Math.hypot(pixel.x-p.x,pixel.y-p.y)<48))continue;if(pixel)placed.push(pixel);L.marker(mark.point,{interactive:false,keyboard:false,icon:L.divIcon({className:'kilometre-marker',html:String(mark.km)+' km',iconSize:[42,20],iconAnchor:[21,10]})}).addTo(kilometreLayer);if(placed.length>=60)break;}
}
function renderPlanMiniProfile(p){
 previewChartNode=null;previewChartModel=null;previewPercentNode=null;const container=$('planPreview');container.onclick=null;container.onkeydown=null;container.removeAttribute('role');container.removeAttribute('tabindex');if(!p)return;const mini=document.createElement('div');mini.className='mini-elevation';let legs=p.legs;if(!legs?.length){const draft=new ItineraryDraft();draft.load(p);legs=draft.legs;}previewChartModel=buildElevationModel(legs);previewChartNode=mini;renderElevationChart(mini,previewChartModel,{compact:true,onSeek:at=>{if(planViewing&&editingPlan?.id===p.id)seekElevation(at);}});container.insertBefore(mini,container.children[1]||null);
 const summary=planSummary(legs),types=document.createElement('p');types.className='preview-meta surface-percentages';previewPercentNode=types;types.textContent=unpavedLabel(summary);container.append(types);container.setAttribute('role','button');container.setAttribute('tabindex','0');container.setAttribute('aria-label','Afficher '+p.name);container.onclick=e=>{if(e?.target?.closest?.('a'))return;void loadPlan(p.id).catch(e=>toast(e.message));};container.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();void loadPlan(p.id).catch(e=>toast(e.message));}};
}
function unpavedLabel(summary){return !summary.total||summary.unpavedKnown===0?'Non asphalté non renseigné':`${summary.unpavedKnown<summary.total-.1?'≥ ':''}${Math.round(100*summary.unpaved/summary.total)} % non asphalté`;}
function surfacePercentages(summary){const surfaces={...summary.surfaces},knownTotal=Object.values(surfaces).reduce((n,v)=>n+v,0);surfaces.Inconnu=(surfaces.Inconnu||0)+Math.max(0,summary.total-knownTotal);return Object.entries(surfaces).filter(([,n])=>n>.1).sort((a,b)=>b[1]-a[1]).map(([name,n])=>[`${name} · ${summary.total?Math.round(100*n/summary.total):0} %`,routeSurfaceColors[name]||routeSurfaceColors.Inconnu]);}
function renderMapLegend(){
 const legend=$('legendContent');if(!legend)return;legend.replaceChildren();const title=text=>{const el=document.createElement('strong');el.textContent=text;legend.append(el);},entry=(label,color,dashed=false)=>{const el=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;if(dashed){swatch.style.background='none';swatch.style.borderTop='3px dashed '+color;}el.append(swatch,document.createTextNode(label));legend.append(el);};
 if(view==='planner'&&planDraft.legs.length){const style=$('planColorMode').value||'simple',model=currentProfile();title('Itinéraire · '+({simple:'Ligne simple',surface:'Surface',slope:'Pente estimée',altitude:'Altitude'}[style]));if(style==='surface')for(const [label,color]of surfacePercentages(planSummary(planDraft.legs)))entry(label,color);else if(style==='slope')for(const [,,label,color]of slopeBins)entry(label,color);else if(style==='altitude'&&model.min!==null)for(let i=0;i<elevationColors.length;i++){const a=model.min+(model.max-model.min)*i/elevationColors.length,b=model.min+(model.max-model.min)*(i+1)/elevationColors.length;entry(`${Math.round(a)}–${Math.round(b)} m`,elevationColors[i]);}else entry(style==='simple'?'Itinéraire':'Altitudes inconnues',style==='simple'?'#b5654c':'#9b9b91');entry('Non asphalté renseigné','#b5654c',true);if(planDraft.legs.some(l=>l.analysis?.accessRuns?.length))entry('! Accès limité · vérifier les conditions','#a86932');}
 if(trace.length&&$('showLoadedRide').checked!==false){title('Sortie chargée');entry(currentRide?.name||'GPX','#607d88');}if($('showImportedTraces').checked){title('Sorties importées');entry('Mes traces personnelles','#71848b');}if(view!=='planner'&&selected.length>1){title('Secteur sélectionné');entry(editingSegment?.name||(view==='saved'?'Secteur consulté':'Dessin en cours'),'#b5654c');}
 if(view!=='planner'&&draftActive()&&planDraft.legs.some(l=>l.analysis?.accessRuns?.length))entry('! Accès limité · vérifier les conditions','#a86932');
 const colorMode=$('colorMode')?.value||'rating';title('Secteurs · '+(colorMode==='rating'?'Plaisir de rouler':colorMode==='difficulty'?'Technicité':'Revêtement'));const entries=colorMode==='rating'?ratingColors.map((color,i)=>[`${i+1}/5`,color]):Object.entries(colorMode==='difficulty'?difficultyColors:surfaceColors);for(const[label,color]of entries)entry(label,color);entry('Single track','#58655c',true);

}
function positionPointSettings(){
 if(selectedPlanPoint===null||!draftActive()||!planDraft.points[selectedPlanPoint]||!map)return;const point=map.latLngToContainerPoint?.(planDraft.points[selectedPlanPoint]),canvas=$('mapCanvas').getBoundingClientRect?.();if(!point||!canvas)return;const width=Math.min(250,canvas.width-24),height=pointSettingsElement.getBoundingClientRect().height||185,editor=$('editorPanel').getBoundingClientRect(),right=innerWidth>850&&!$('editorPanel').hidden&&!document.fullscreenElement&&!document.body.classList.contains('map-expanded')?Math.min(canvas.width,editor.left-canvas.left-12):canvas.width;let left=point.x+18;if(left+width>right)left=point.x-width-18;left=Math.max(12,Math.min(canvas.width-width-12,left));pointSettingsElement.style.left=left+'px';pointSettingsElement.style.top=Math.max(12,Math.min(canvas.height-height-12,point.y-35))+'px';
}
function closePointSettings(redraw=true){
 selectedPlanPoint=null;setHidden('pointSettings',true);if(redraw){drawSelection();update();}
}
function openPointSettings(index){
 if(!canDraw()||mode!=='route')return;if(view==='explore'&&!segmentDraftActive)ensureSegmentDraft();if(!draftActive()||!planDraft.points[index])return;selectedPlanPoint=index;$('pointSettingsTitle').textContent=index===0?'Départ':index===planDraft.points.length-1?'Arrivée':`Point de passage ${index}`;$('pointIncomingManual').disabled=index===0;$('pointIncomingManual').checked=index>0&&planDraft.legs[index-1]?.mode==='manual';setHidden('pointSettings',false);drawSelection();positionPointSettings();
}
function removeDraftPoint(index){if(!canDraw()||!draftActive()||!planDraft.points[index])return;closePointSettings(false);planDraft.remove(index);plannerChanged();}
function setPointMode(index,manual){if(!canDraw()||!draftActive())return;if(planDraft.setIncomingMode(index,manual?'manual':'route')){plannerChanged();openPointSettings(index);}}
function capturePlanContext(){return {editingPlan,planReadOnly,planViewing,name:$('planName').value,notes:$('planNotes').value,isPublic:$('publicPlan').checked,manual:$('manualLeg').checked};}
function restorePlanContext(context){editingPlan=context.editingPlan;planReadOnly=context.planReadOnly;planViewing=context.planViewing;$('planName').value=context.name;$('planNotes').value=context.notes;$('publicPlan').checked=context.isPublic;$('manualLeg').checked=context.manual===true;}
function clearCurrentPlan(){
 if(view!=='planner')return;planLoadVersion++;cancelSnap();planRouteController?.abort();planMetricsController?.abort();planStartController?.abort();planDraft.context=capturePlanContext();const empty={editingPlan:null,planReadOnly:false,planViewing:false,name:'',notes:'',isPublic:false,manual:false};planDraft.clear(empty);restorePlanContext(empty);selectedPlanPoint=null;sidebarCollapsed=true;applySidebarState();$('surfaceDetails').open=false;$('planSelect').value='';previewPlan();syncPlanner();status('Nouvel itinéraire : indiquez son nom et placez le départ sur la carte. Utilisez ↶ Annuler pour retrouver le tracé précédent.');
}
$('waypointDetails').ontoggle=()=>renderWaypoints();$('pointIncomingManual').onchange=()=>{if(selectedPlanPoint!==null)setPointMode(selectedPlanPoint,$('pointIncomingManual').checked);};$('closePointSettings').onclick=e=>{e?.stopPropagation?.();closePointSettings();};$('deletePoint').onclick=e=>{e?.stopPropagation?.();if(selectedPlanPoint!==null)removeDraftPoint(selectedPlanPoint);};
$('profileExtrema').onchange=()=>{if(profileActive())renderElevationChart($('elevationGraph'),currentProfile(),{onSeek:seekElevation,showExtrema:$('profileExtrema').checked});};$('elevationSeek').oninput=()=>seekElevation($('elevationSeek').value);$('planColorMode').onchange=()=>{drawSelection();renderMapLegend();};$('elevationPanel').ontoggle=()=>resizeElevationPanel();
$('editPlan').onclick=()=>{if(view!=='planner'||!editingPlan?.isMine)return;sidebarCollapsed=true;applySidebarState();planViewing=false;planReadOnly=false;for(const l of planDraft.legs)if(surfaceUncertain(l)){surfaceOnlyReview.add(l.id);planAnalysisAllowed.add(l.id);}schedulePlanAnalysis();drawSelection();update();status('Glissez un point pour le corriger. Cliquez dessus pour choisir le routage depuis le précédent.');};
function resizeElevationPanel(){resizeElevationChart($('elevationGraph'));resizeElevationChart(previewChartNode);const height=$('elevationPanel').hidden?0:$('elevationPanel').getBoundingClientRect?.().height||0;$('workspace').style.setProperty('--profile-height',height+'px');map?.invalidateSize({pan:false});}
if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(resizeElevationPanel);observer.observe($('elevationPanel'));observer.observe($('planPreview'));}

try{const me=await api('/api/me');$('username').textContent=me.username;setHidden('adminLink',!me.isAdmin);[records,rides,catalog,planRecords]=await Promise.all([api('/api/portions'),api('/api/rides'),api('/api/catalog'),api('/api/plans')]);syncPlanRangeLimits();renderLibrary();void loadStravaStatus();
 if(map){const layers=await api('/api/wms');for(const w of layers){const layer=L.tileLayer.wms(w.url,{layers:w.layers,version:w.version,styles:w.styles,format:'image/png',transparent:false,referrerPolicy:'strict-origin-when-cross-origin',attribution:escapeHTML(w.attribution),maxZoom:20});layer.on('tileerror',()=>{if(map.hasLayer(layer))toast('Le fond '+w.name+' est indisponible.');});layerControl.addBaseLayer(layer,w.name);}}
 const requested=new URLSearchParams(location.search||'').get('ride');if(requested&&/^[a-f0-9-]{36}$/.test(requested))await loadRide(requested);else if(new URLSearchParams(location.search||'').get('source')==='strava'){$('libraryType').value='rides';setView('saved');$('rideSource').value='strava';await loadStravaStatus();await changeRideSource();}else setView('saved');}catch(e){toast(e.message);}stars();update();

function resizeMap(){if(map)map.invalidateSize({pan:false});}
function updateFullscreen(){const expanded=!!document.fullscreenElement||document.body.classList.contains('map-expanded');setHidden('sidebarToggle',expanded);const label=expanded?'Quitter le plein écran':'Afficher la carte en plein écran';$('fullscreenMap').setAttribute('aria-label',label);$('fullscreenMap').setAttribute('title',label);$('fullscreenMap').classList.toggle('is-expanded',expanded);$('fullscreenMap').setAttribute('aria-pressed',String(expanded));resizeMap();}
$('fullscreenMap').onclick=async()=>{const workspace=$('workspace');try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.body.classList.contains('map-expanded'))document.body.classList.remove('map-expanded');else if(workspace.requestFullscreen)await workspace.requestFullscreen();else document.body.classList.add('map-expanded');}catch{document.body.classList.toggle('map-expanded');}updateFullscreen();};
document.addEventListener('fullscreenchange',updateFullscreen);document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelRouteDrag();if(e.key==='Escape'&&document.body.classList.contains('map-expanded')){document.body.classList.remove('map-expanded');updateFullscreen();}});
const header=document.querySelector('body.app-page>header');if(header&&typeof ResizeObserver!=='undefined'){new ResizeObserver(()=>{document.body.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');resizeMap();}).observe(header);}


