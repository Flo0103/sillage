const help={
 garmin:'https://support.garmin.com/en-US/?faq=wKuZXCaZRP4mWPX5aRz5h5',
 coros:'https://support.coros.com/hc/en-us/articles/24181489692436-Downloading-and-Using-Routes'
};
export function gpsFilename(name){return (String(name||'Itinéraire').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').trim()||'Itinéraire')+'.gpx';}

export function createGpsTransfer({document,navigator=globalThis.navigator,fetcher=(...args)=>fetch(...args),FileClass=globalThis.File}={}){
 const $=id=>document.getElementById(id),dialog=$('gpsTransferDialog');let version=0,controller=null,file=null,sharing=false;
 const status=text=>{$('gpsTransferStatus').textContent=text;};
 const supported=()=>{try{return !!file&&typeof navigator?.share==='function'&&navigator?.canShare?.({files:[file]})===true;}catch{return false;}};
 const reset=()=>{version++;controller?.abort();controller=null;file=null;sharing=false;$('gpsTransferShare').disabled=true;};
 const destination=provider=>{
  for(const kind of ['garmin','coros']){$('gpsDestination'+kind).setAttribute('aria-pressed',String(kind===provider));$('gpsInstructions'+kind).hidden=kind!==provider;}
  $('gpsTransferHelp').href=help[provider];$('gpsTransferHelp').textContent=provider==='garmin'?'Guide Garmin Connect ↗':'Guide COROS ↗';
 };
 for(const provider of ['garmin','coros'])$('gpsDestination'+provider).onclick=()=>destination(provider);
 $('gpsTransferClose').onclick=()=>{reset();if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');dialog.open=false;}};
 dialog.addEventListener?.('close',()=>{if(!dialog.open)reset();});
 dialog.addEventListener?.('cancel',reset);
 $('gpsTransferShare').onclick=async()=>{
  if(sharing||!supported())return;const ticket=version;sharing=true;$('gpsTransferShare').disabled=true;
  try{
   // The file is prepared when opening the dialog. Keep share() in this click's
   // user activation (fetching it here breaks file sharing on some phones).
   await navigator.share({files:[file]});
   if(ticket===version)status('Terminez l’import dans l’application choisie, puis synchronisez votre appareil.');
  }catch(e){if(ticket===version)status(e.name==='AbortError'?'Partage annulé. Vous pouvez réessayer ou télécharger le GPX.':'Le partage n’est pas disponible ici. Téléchargez le GPX puis ouvrez-le avec Garmin Connect ou COROS.');}
  finally{if(ticket===version){sharing=false;$('gpsTransferShare').disabled=!supported();}}
 };
 const open=async plan=>{
  if(!plan||!/^[a-f0-9-]{36}$/i.test(plan.id||''))throw Error('Enregistrez l’itinéraire avant de le transférer.');
  reset();const ticket=version,path=`/api/plans/${plan.id}/gpx`;
  $('gpsTransferName').textContent=plan.name||'Itinéraire';$('gpsTransferFilename').textContent=gpsFilename(plan.name);$('gpsTransferDownload').href=path;destination('garmin');
  const canPrepare=typeof navigator?.share==='function'&&typeof navigator?.canShare==='function'&&typeof FileClass==='function';
  $('gpsTransferShare').hidden=!canPrepare;$('gpsTransferShare').disabled=true;
  status(canPrepare?'Préparation du GPX pour le partage…':'Téléchargez le GPX puis importez-le en suivant les étapes ci-dessus.');
  // A dialog must belong to the fullscreen element to remain accessible when
  // the map uses the browser's fullscreen mode.
  (document.fullscreenElement||document.body).append(dialog);
  if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.open=true;}}
  if(!canPrepare)return;
  controller=new AbortController();
  try{
   const response=await fetcher(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/gpx+xml'},signal:controller.signal});
   if(!response.ok){let message=response.status===401?'Votre session a expiré. Reconnectez-vous pour récupérer cet itinéraire.':'Impossible de préparer le GPX.';try{const data=await response.json();if(typeof data.error==='string')message=data.error;}catch{}throw Error(message);}
   if(!/^(application\/(gpx\+xml|xml)|text\/xml)(;|$)/i.test(response.headers.get('Content-Type')||''))throw Error('Le fichier reçu n’est pas un GPX. Réessayez après rechargement.');
   const blob=await response.blob();if(ticket!==version)return;
   file=new FileClass([blob],gpsFilename(plan.name),{type:'application/gpx+xml'});
   $('gpsTransferShare').hidden=!supported();$('gpsTransferShare').disabled=!supported();
   status(supported()?'GPX prêt. Dans le menu de partage, choisissez Garmin Connect ou COROS.':'Ce navigateur ne partage pas les fichiers GPX. Téléchargez le fichier puis ouvrez-le dans l’application.');
  }catch(e){if(ticket!==version||e.name==='AbortError')return;file=null;$('gpsTransferShare').disabled=true;status(e.message+' Vous pouvez réessayer avec le lien de téléchargement.');}
 };
 return {open};
}
