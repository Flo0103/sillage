const steps=[
 {target:'mapCanvas',title:'Bienvenue dans votre atlas gravel.',text:'Sillage réunit vos sorties, vos secteurs favoris et vos itinéraires sur une même carte. Prenons une minute pour découvrir votre terrain de jeu.'},
 {target:'appSidebar',title:'Votre bibliothèque, au même endroit.',text:'Cherchez une sortie GPX ou Strava, un secteur ou un itinéraire. Les filtres de distance, de relief, de visibilité et de zone vous aident à retrouver le bon tracé. Le bouton de bibliothèque permet de replier ce panneau.'},
 {target:'mapToolbar',title:'Deux outils pour prendre la route.',text:'Le chemin courbe avec un + crée un itinéraire ; le trait avec deux bornes et un + crée un secteur à noter. Les flèches annulent ou rétablissent une opération. La cible recentre la carte et les quatre coins ouvrent le plein écran.'},
 {target:'mapCanvas',title:'Un clic, puis le chemin se dessine.',text:'Placez le départ vert, puis les points suivants : Sillage les accroche à OSM. Glissez un point ou la ligne pour ajuster le parcours. Cliquez sur un point pour le retirer ou corriger localement sans routage. La croix arrête le tracé après confirmation.'},
 {target:'segmentLegend',title:'Une carte à votre mesure.',text:'Choisissez IGN, OSM, le satellite, CyclOSM ou vos fonds WMS. La légende rassemble le relief, les secteurs personnels et publics, les filtres et les couleurs par plaisir, surface ou technicité. Les secteurs restent visibles au-dessus de l’itinéraire.'},
 {target:'mapCanvas',title:'Du relief au prochain départ.',text:'Le profil sous la carte suit l’altitude et permet de retrouver un point du parcours. Pendant le dessin, le bouton Enregistrer ouvre le formulaire, aussi sur mobile et en plein écran. Nommez votre itinéraire, ou notez le plaisir d’un secteur, puis validez.'}
];

export function createOnboarding({document,viewport=globalThis,storage=()=>globalThis.localStorage,prepare=()=>{},restore=()=>{}}){
 const $=id=>document.getElementById(id),dialog=$('introTour');let user='',index=0,active=false,version=0,focusBefore=null;
 const seenHere=new Set(),key=()=>`sillage:introduction:v1:${user}`;
 const seen=()=>{if(seenHere.has(user))return true;try{return storage()?.getItem(key())==='seen';}catch{return false;}};
 function persist(){if(!user)return;seenHere.add(user);try{storage()?.setItem(key(),'seen');}catch{/* Browsing still works with storage disabled. */}}
 function finish(){if(!active)return;active=false;version++;persist();viewport.removeEventListener?.('resize',position);viewport.removeEventListener?.('scroll',position,true);viewport.visualViewport?.removeEventListener?.('resize',position);viewport.visualViewport?.removeEventListener?.('scroll',position);$('introTourSpotlight').hidden=true;restore();focusBefore?.focus?.({preventScroll:true});}
 function close(){if(dialog?.open)dialog.close();finish();}
 function target(){if(steps[index].target==='mapToolbar')return document.querySelector('.sillage-map-toolbar')||$('mapTools')||$('mapCanvas');return $(steps[index].target);}
 function position(){
  if(!active)return;const width=viewport.visualViewport?.width||viewport.innerWidth||390,height=viewport.visualViewport?.height||viewport.innerHeight||700,offsetX=viewport.visualViewport?.offsetLeft||0,offsetY=viewport.visualViewport?.offsetTop||0,margin=14,gap=16,cardWidth=Math.min(350,width-2*margin),spot=$('introTourSpotlight');
  dialog.style.width=cardWidth+'px';$('introTourCard').style.maxHeight=(height-2*margin)+'px';
  const bounds=target()?.getBoundingClientRect?.(),card=$('introTourCard').getBoundingClientRect?.(),cardHeight=Math.min(card?.height||310,height-2*margin);
  let left=offsetX+(width-cardWidth)/2,top=offsetY+(height-cardHeight)/2;
  if(bounds?.width>0&&bounds?.height>0){
   const x=Math.max(offsetX+6,bounds.left-6),y=Math.max(offsetY+6,bounds.top-6),right=Math.min(offsetX+width-6,bounds.right+6),bottom=Math.min(offsetY+height-6,bounds.bottom+6);
   spot.hidden=right<=x||bottom<=y;Object.assign(spot.style,{left:x+'px',top:y+'px',width:Math.max(0,right-x)+'px',height:Math.max(0,bottom-y)+'px'});
   if(bounds.right+gap+cardWidth<=offsetX+width-margin){left=bounds.right+gap;top=bounds.top;}
   else if(bounds.bottom+gap+cardHeight<=offsetY+height-margin){top=bounds.bottom+gap;left=bounds.left;}
   else if(bounds.top-gap-cardHeight>=offsetY+margin){top=bounds.top-gap-cardHeight;left=bounds.left;}
   else top=offsetY+height-cardHeight-margin;
  }else spot.hidden=true;
  dialog.style.left=Math.max(offsetX+margin,Math.min(offsetX+width-cardWidth-margin,left))+'px';dialog.style.top=Math.max(offsetY+margin,Math.min(offsetY+height-cardHeight-margin,top))+'px';dialog.style.width=cardWidth+'px';
 }
 async function show(){
  const current=++version,step=index;$('introTourTitle').textContent=steps[step].title;$('introTourText').textContent=steps[step].text;$('introTourStep').textContent=`DÉCOUVRIR SILLAGE · ${step+1} / ${steps.length}`;$('introTourProgress').max=steps.length;$('introTourProgress').value=step+1;$('introTourPrevious').disabled=step===0;$('introTourNext').textContent=step===steps.length-1?'C’est parti':'Suivant';
  await prepare(step);if(!active||current!==version)return;target()?.scrollIntoView?.({block:'center',inline:'nearest',behavior:'auto'});position();
 }
 function start(username=user){
  if(!dialog?.showModal||active)return false;user=String(username||'');index=0;focusBefore=document.activeElement;active=true;
  try{dialog.showModal();}catch{active=false;return false;}
  viewport.addEventListener?.('resize',position);viewport.addEventListener?.('scroll',position,true);viewport.visualViewport?.addEventListener?.('resize',position);viewport.visualViewport?.addEventListener?.('scroll',position);void show();$('introTourNext').focus?.();return true;
 }
 if(dialog){dialog.onclose=()=>{if(!dialog.open)finish();};dialog.oncancel=()=>{persist();};$('introTourNext').onclick=()=>{if(index===steps.length-1)close();else{index++;void show();}};$('introTourPrevious').onclick=()=>{if(index){index--;void show();}};$('introTourSkip').onclick=close;}
 return {start,close,maybeStart(username){if(active)return false;user=String(username||'');return !!user&&!seen()&&start(user);}};
}
