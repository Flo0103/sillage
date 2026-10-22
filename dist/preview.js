// Lightweight SVG fallback plus lazily mounted Leaflet previews on OSM tiles.
export function previewPath(points){
 if(!Array.isArray(points)||points.length<2)return '';
 const sampled=points.length>500?Array.from({length:500},(_,i)=>points[Math.round(i*(points.length-1)/499)]):points;
 let south=90,north=-90,west=180,east=-180;for(const p of sampled){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))return '';south=Math.min(south,p[0]);north=Math.max(north,p[0]);west=Math.min(west,p[1]);east=Math.max(east,p[1]);}
 const lonScale=Math.max(.01,Math.cos((north+south)/2*Math.PI/180)),width=(east-west)*lonScale,height=north-south,scale=Math.min(288/(width||1e-9),104/(height||1e-9));
 const offsetX=(320-width*scale)/2,offsetY=(136-height*scale)/2;
 return sampled.map((p,i)=>`${i?'L':'M'}${(offsetX+(p[1]-west)*lonScale*scale).toFixed(1)},${(offsetY+(north-p[0])*scale).toFixed(1)}`).join(' ');
}
const previews=new WeakMap();
export function disposePreviews(root){
 const state=previews.get(root);if(state){state.disposed=true;state.visibility?.disconnect();state.resize?.disconnect();state.map?.remove?.();previews.delete(root);}
 for(const child of [...(root.children||[])])disposePreviews(child);
}
export function renderPreview(container,item,{label='Aperçu',meta=''}={}){
 disposePreviews(container);container.replaceChildren();if(!item){const p=document.createElement('p');p.className='empty';p.textContent='Choisissez un élément pour voir son aperçu.';container.append(p);return;}
 const original=item.coordinates||item.preview||[],points=original.length>500?Array.from({length:500},(_,i)=>original[Math.round(i*(original.length-1)/499)]):original,path=previewPath(points),graphic=document.createElement('div');graphic.className='preview-graphic';
 const fallback=()=>{graphic.innerHTML=`<svg viewBox="0 0 320 136" role="img" aria-label="Aperçu du tracé"><path class="preview-underlay" d="${path}"/><path class="preview-path" d="${path}"/></svg>`;};
 if(path)fallback();else{const p=document.createElement('p');p.className='empty';p.textContent='Aperçu du tracé indisponible';graphic.append(p);}
 const eyebrow=document.createElement('small'),title=document.createElement('strong'),details=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent=label;title.textContent=item.name;details.className='preview-meta';details.textContent=meta;container.append(graphic,eyebrow,title,details);
 if(!path||typeof L==='undefined')return;
 const state={disposed:false,visible:typeof IntersectionObserver==='undefined',map:null};previews.set(container,state);
 function size(){if(state.disposed||!state.visible||!(graphic.clientWidth>0&&graphic.clientHeight>0))return;
  if(state.map){state.map.invalidateSize({pan:false});state.map.fitBounds(L.latLngBounds(points),{padding:[14,14],maxZoom:16,animate:false});return;}
  graphic.replaceChildren();graphic.classList.add('preview-map');graphic.setAttribute('aria-label','Aperçu du tracé sur fond OpenStreetMap');
  try{
   const map=L.map(graphic,{zoomControl:false,attributionControl:true,scrollWheelZoom:false,dragging:false,touchZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomSnap:.5});state.map=map;
   map.fitBounds(L.latLngBounds(points),{padding:[14,14],maxZoom:16,animate:false});
   const tile=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{referrerPolicy:'strict-origin-when-cross-origin',updateWhenIdle:true,keepBuffer:0,maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
   L.polyline(points,{color:'#faf8f1',weight:7,interactive:false}).addTo(map);L.polyline(points,{color:'#b5654c',weight:4,interactive:false}).addTo(map);
   const notice=document.createElement('span');notice.className='preview-map-notice';notice.hidden=true;notice.textContent='Fond OSM indisponible';graphic.append(notice);let failed=false;
   tile.on('loading',()=>{failed=false;});tile.on('tileerror',()=>{if(!state.disposed){failed=true;notice.hidden=false;}});tile.on('load',()=>{if(!state.disposed&&!failed)notice.hidden=true;});
  }catch{state.map?.remove?.();state.map=null;graphic.classList.remove('preview-map');fallback();}
 }
 if(typeof IntersectionObserver!=='undefined'){state.visibility=new IntersectionObserver(entries=>{state.visible=entries.some(e=>e.isIntersecting);if(state.visible)size();});state.visibility.observe(graphic);}
 if(typeof ResizeObserver!=='undefined'){state.resize=new ResizeObserver(size);state.resize.observe(graphic);}size();
}
