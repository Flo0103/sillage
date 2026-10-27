const steps=[
 {target:'mapCanvas',title:'Votre atlas gravel.',text:'Vos sorties, vos secteurs et vos itinéraires se retrouvent sur cette carte. Voici les repères essentiels.'},
 {target:'appSidebar',title:'Retrouvez vos tracés.',text:'Choisissez une sortie, un secteur ou un itinéraire. [sidebarToggle] replie la bibliothèque ; cliquer sur une vignette de sortie l’affiche sur la carte.'},
 {target:'mapToolbar',title:'Deux outils pour dessiner.',text:'[reset] crée un itinéraire, [drawSegment] un secteur. [undoPlan] et [redoPlan] annulent ou rétablissent. [reversePlan] inverse le sens de l’itinéraire.'},
 {target:'accountLink',title:'Connectez votre Strava.',text:'Dans Mon compte, autorisez Sillage sur Strava. Retrouvez ensuite vos activités dans Sorties → Mes sorties Strava, puis cliquez sur leur vignette.'},
 {target:'mapCanvas',title:'Placez, puis ajustez.',text:'Cliquez pour ajouter un point. Glissez un point ou la ligne pour corriger le tracé. Un clic sur un point permet de le corriger. [manualLegControls] active le mode manuel pour les prochains points. [finishDrawing] confirme l’abandon des modifications non enregistrées.'},
 {target:'segmentLegend',title:'Lisez votre terrain.',text:'[segmentLegend] rassemble fonds de carte, ombrage, secteurs et couleurs. [fit] recentre la carte ; [fullscreenMap] ouvre le plein écran.'},
 {target:'mapCanvas',title:'Gardez le bon chemin.',text:'Le profil sous la carte suit le relief. [mapSaveTrace] (la disquette) ouvre les détails pour enregistrer, aussi sur mobile et en plein écran. Une sortie peut aussi être transformée en itinéraire.'}
];
const iconFallbacks={reset:'<circle cx="4" cy="5" r="2"/><path d="M9 5h7c5 0 4 4 0 6L8 16c-4 2-2 3 1 3h6M19 2v6m-3-3h6"/><circle cx="20" cy="19" r="2"/>',drawSegment:'<circle cx="4" cy="5" r="2"/><path d="m8 8 8 8M19 2v6m-3-3h6"/><circle cx="20" cy="19" r="2"/>',undoPlan:'<path d="m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7"/>',redoPlan:'<path d="m15 5 6 6-6 6m6-6H11a7 7 0 0 0-7 7"/>',reversePlan:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',sidebarToggle:'<path d="M12 5C8 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-6-1-10 1Zm0 0v15"/>',segmentLegend:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',fit:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',fullscreenMap:'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',finishDrawing:'<path d="m6 6 12 12M18 6 6 18"/>',manualLegControls:'<path d="m4 16-1 5 5-1L21 7l-4-4L4 16Zm10-10 4 4M4 16l4 4"/>',mapSaveTrace:'<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>'};
const iconLabels={reset:'Créer un itinéraire',drawSegment:'Créer un secteur',undoPlan:'Annuler',redoPlan:'Rétablir',reversePlan:'Inverser le sens',sidebarToggle:'Bibliothèque',segmentLegend:'Carte et légendes',fit:'Recentrer',fullscreenMap:'Plein écran',finishDrawing:'Arrêter le tracé',manualLegControls:'Mode manuel de tracé',mapSaveTrace:'Enregistrer'};

export function createOnboarding({document,viewport=globalThis,storage=()=>globalThis.localStorage,prepare=()=>{},restore=()=>{}}){
 const $=id=>document.getElementById(id),dialog=$('introTour');let user='',index=0,active=false,version=0,focusBefore=null;
 const seenHere=new Set(),key=()=>`sillage:introduction:v1:${user}`;
 const seen=()=>{if(seenHere.has(user))return true;try{return storage()?.getItem(key())==='seen';}catch{return false;}};
 function persist(){if(!user)return;seenHere.add(user);try{storage()?.setItem(key(),'seen');}catch{/* Browsing still works with storage disabled. */}}
 function finish(){if(!active)return;active=false;version++;persist();viewport.removeEventListener?.('resize',position);viewport.removeEventListener?.('scroll',position,true);viewport.visualViewport?.removeEventListener?.('resize',position);viewport.visualViewport?.removeEventListener?.('scroll',position);$('introTourSpotlight').hidden=true;restore();focusBefore?.focus?.({preventScroll:true});}
 function close(){if(dialog?.open)dialog.close();finish();}
 function target(){if(steps[index].target==='accountLink')return $('accountLink')||$('mapCanvas');if(steps[index].target==='mapToolbar')return document.querySelector('.sillage-map-toolbar')||$('mapTools')||$('mapCanvas');return $(steps[index].target);}
 function position(){
  if(!active)return;const width=viewport.visualViewport?.width||viewport.innerWidth||390,height=viewport.visualViewport?.height||viewport.innerHeight||700,mobile=width<=850,offsetX=viewport.visualViewport?.offsetLeft||0,offsetY=viewport.visualViewport?.offsetTop||0,margin=14,gap=16,cardWidth=Math.min(350,width-2*margin),spot=$('introTourSpotlight');
  dialog.style.width=cardWidth+'px';const maxHeight=mobile?Math.min(height-2*margin,240,Math.max(180,height*.38)):height-2*margin;$('introTourCard').style.maxHeight=maxHeight+'px';
  const bounds=target()?.getBoundingClientRect?.(),card=$('introTourCard').getBoundingClientRect?.(),cardHeight=Math.min(card?.height||310,maxHeight);
  let left=offsetX+(width-cardWidth)/2,top=mobile?offsetY+height-cardHeight-margin:offsetY+(height-cardHeight)/2;
  if(bounds?.width>0&&bounds?.height>0){
   const x=Math.max(offsetX+6,bounds.left-6),y=Math.max(offsetY+6,bounds.top-6),right=Math.min(offsetX+width-6,bounds.right+6),bottom=Math.min(mobile?top-12:offsetY+height-6,bounds.bottom+6);
   spot.hidden=right<=x||bottom<=y;Object.assign(spot.style,{left:x+'px',top:y+'px',width:Math.max(0,right-x)+'px',height:Math.max(0,bottom-y)+'px'});
   if(mobile){/* Keep the explanation below the visible target. */}
   else if(bounds.right+gap+cardWidth<=offsetX+width-margin){left=bounds.right+gap;top=bounds.top;}
   else if(bounds.bottom+gap+cardHeight<=offsetY+height-margin){top=bounds.bottom+gap;left=bounds.left;}
   else if(bounds.top-gap-cardHeight>=offsetY+margin){top=bounds.top-gap-cardHeight;left=bounds.left;}
   else top=offsetY+height-cardHeight-margin;
  }else spot.hidden=true;
  dialog.style.left=Math.max(offsetX+margin,Math.min(offsetX+width-cardWidth-margin,left))+'px';dialog.style.top=Math.max(offsetY+margin,Math.min(offsetY+height-cardHeight-margin,top))+'px';dialog.style.width=cardWidth+'px';
 }
 function renderDescription(text){
  const node=$('introTourText');node.replaceChildren();for(const part of text.split(/(\[[A-Za-z]+\])/)){
   const id=part.startsWith('[')?part.slice(1,-1):null;if(!id||!iconFallbacks[id]){node.append(document.createTextNode(part));continue;}
   const badge=document.createElement('span');badge.className='tour-inline-tool';badge.setAttribute('role','img');badge.setAttribute('aria-label',iconLabels[id]);badge.setAttribute('title',iconLabels[id]);const actual=$(id)?.querySelector?.(id==='sidebarToggle'?'.library-book':'svg');badge.innerHTML=actual?.outerHTML||'<svg viewBox="0 0 24 24" aria-hidden="true">'+iconFallbacks[id]+'</svg>';node.append(badge);
  }
 }
 async function show(){
  const current=++version,step=index;$('introTourTitle').textContent=steps[step].title;renderDescription(steps[step].text);$('introTourStrava').hidden=steps[step].target!=='accountLink';$('introTourStep').textContent=`DÉCOUVRIR SILLAGE · ${step+1} / ${steps.length}`;$('introTourProgress').max=steps.length;$('introTourProgress').value=step+1;$('introTourPrevious').disabled=step===0;$('introTourNext').textContent=step===steps.length-1?'C’est parti':'Suivant';
  await prepare(step);if(!active||current!==version)return;target()?.scrollIntoView?.({block:(viewport.visualViewport?.width||viewport.innerWidth||390)<=850?'start':'center',inline:'nearest',behavior:'auto'});position();
 }
 function start(username=user){
  if(!dialog?.showModal||active)return false;user=String(username||'');index=0;focusBefore=document.activeElement;active=true;
  try{dialog.showModal();}catch{active=false;return false;}
  viewport.addEventListener?.('resize',position);viewport.addEventListener?.('scroll',position,true);viewport.visualViewport?.addEventListener?.('resize',position);viewport.visualViewport?.addEventListener?.('scroll',position);void show();$('introTourNext').focus?.();return true;
 }
 if(dialog){$('introTourStrava').onclick=close;dialog.onclose=()=>{if(!dialog.open)finish();};dialog.oncancel=()=>{persist();};$('introTourNext').onclick=()=>{if(index===steps.length-1)close();else{index++;void show();}};$('introTourPrevious').onclick=()=>{if(index){index--;void show();}};$('introTourSkip').onclick=close;}
 return {start,close,maybeStart(username){if(active)return false;user=String(username||'');return !!user&&!seen()&&start(user);}};
}
