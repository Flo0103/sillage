// One list of directly actionable cards. Only visible local thumbnails are fetched.
export function createRideCards({document,renderPreview,disposePreviews,fetchPreview,onOpen,onDelete,Observer=globalThis.IntersectionObserver}){
 const cache=new Map(),states=new Map(),queue=[];let active=0;
 function clear(root){const state=states.get(root);if(state){state.alive=false;state.observer?.disconnect();for(const controller of state.controllers)controller.abort();states.delete(root);}disposePreviews(root);root.replaceChildren();}
 function drain(){while(active<2&&queue.length){const job=queue.shift();if(!job.state.alive)continue;active++;const controller=new AbortController();job.state.controllers.add(controller);fetchPreview(job.item.id,controller.signal).then(preview=>{
   if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(job.item.id,preview);if(job.state.alive)renderPreview(job.main,{...job.item,...preview},job.options);
  }).catch(error=>{if(job.state.alive&&error.name!=='AbortError')renderPreview(job.main,job.item,job.options);}).finally(()=>{job.state.controllers.delete(controller);active--;drain();});}}
 function render(root,items,{remote=false,busy=false,currentId=null}={}){
  clear(root);const state={alive:true,controllers:new Set(),observer:null};states.set(root,state);
  if(!items.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Aucune sortie ne correspond à cette recherche.';root.append(empty);return;}
  const pending=new Map();if(Observer){state.observer=new Observer(entries=>{for(const entry of entries)if(entry.isIntersecting&&pending.has(entry.target)){const job=pending.get(entry.target);pending.delete(entry.target);state.observer.unobserve?.(entry.target);queue.push(job);}drain();});}
  for(const item of items){
   const card=document.createElement('article'),main=document.createElement('div');card.className='preview-card ride-result'+(currentId!=null&&currentId===(remote?item.rideId:item.id)?' is-current':'');main.className='ride-result-main';main.setAttribute('role','button');main.setAttribute('tabindex','0');main.setAttribute('aria-label','Afficher '+item.name+' sur la carte');main.setAttribute('aria-disabled',String(busy));
   const nested=e=>e?.target?.closest?.('a,button,input,select');main.onclick=e=>{if(!busy&&!nested(e))return onOpen(item,remote);};main.onkeydown=e=>{if(!e.repeat&&!nested(e)&&(e.key==='Enter'||e.key===' ')){e.preventDefault();return main.onclick(e);}};
   const date=new Date(item.startDate||item.created_at||''),when=Number.isNaN(date.getTime())?'':date.toLocaleDateString('fr-BE'),options={label:remote?'Strava'+(item.rideId?' · importée':''):item.source_type==='strava'?'Import Strava':'Ma sortie GPX',meta:[when,`${((item.distance||0)/1000).toFixed(1)} km`,Number.isFinite(item.ascent)?`D+ ${Math.round(item.ascent)} m`:''].filter(Boolean).join(' · ')};
   card.append(main);root.append(card);
   const ready=cache.get(item.id);if(remote||item.coordinates?.length||ready)renderPreview(main,ready?{...item,...ready}:item,options);
   else{
    const graphic=document.createElement('div'),title=document.createElement('strong'),label=document.createElement('small'),meta=document.createElement('p');graphic.className='preview-graphic ride-preview-placeholder';graphic.setAttribute('aria-label','Aperçu de la sortie');label.className='eyebrow';label.textContent=options.label;title.textContent=item.name;meta.className='preview-meta';meta.textContent=options.meta;main.append(graphic,label,title,meta);
    const job={state,item,main,options};if(state.observer){pending.set(main,job);state.observer.observe(main);}else if(main.getBoundingClientRect?.().width>0)queue.push(job);
   }
   if(!remote){const actions=document.createElement('div'),download=document.createElement('a'),remove=document.createElement('button');actions.className='ride-result-actions';download.className='textbutton';download.textContent='GPX ↓';download.href='/api/rides/'+item.id+'/gpx';download.setAttribute('aria-label','Télécharger '+item.name);remove.type='button';remove.className='textbutton danger';remove.textContent='Supprimer';remove.onclick=()=>onDelete(item);actions.append(download,remove);card.append(actions);}
  }drain();
 }
 return {render,clear};
}

// The query only reads the private index. A separate single worker fills history.
export function createStravaSearch({get,post,onResults,onStatus,onError,onDisconnected}){
 let active=false,paused=false,query='',version=0,readController=null,worker=null,status=null,forceRefresh=false;
 const needed=()=>forceRefresh||!status?.complete||status?.headPending||status?.needsRefresh;
 async function read(){const current=++version;readController?.abort();const controller=new AbortController();readController=controller;
  try{const result=await get('/api/strava/library?'+query,{signal:controller.signal});if(!active||current!==version)return;if(result.connected!==true){paused=true;onDisconnected();return;}status=result.status;onResults(result);onStatus(status,{paused});return result;}
  catch(error){if(error.name!=='AbortError'&&active&&current===version)onError(error);}
 }
 function run(){if(worker||!active||paused||!needed())return worker||Promise.resolve();
  worker=(async()=>{let cursor=null;while(active&&!paused&&needed()){
   let refreshing=false;try{refreshing=forceRefresh;forceRefresh=false;const next=await post('/api/strava/library/sync',{refresh:refreshing});if(!active)return;status=next;onStatus(status,{paused});await read();if(!active||paused)return;if(next.cursor&&next.cursor===cursor&&needed())throw Error('La synchronisation n’a pas progressé. Réessayez.');cursor=next.cursor;}
   catch(error){if(refreshing)forceRefresh=true;if(!active)return;paused=true;await read();if(active){onStatus(status,{paused});onError(error);}return;}
  }})().finally(()=>{worker=null;if(active&&!paused&&needed())void run();});return worker;
 }
 return {
  async start(params){active=true;paused=false;query=params;const result=await read();if(result)void run();return result;},
  async search(params){query=params;const result=await read();if(result)void run();return result;},
  pause(){paused=true;onStatus(status,{paused});},resume(){active=true;paused=false;onStatus(status,{paused});return run();},
  refresh(){forceRefresh=true;paused=false;active=true;return run();},
  stop(){active=false;version++;readController?.abort();},get idle(){return worker||Promise.resolve();}
 };
}
