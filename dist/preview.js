// Plain SVG geometry, no tile downloads and no third-party preview service.
export function previewPath(points){
 if(!Array.isArray(points)||points.length<2)return '';
 const sampled=points.length>500?Array.from({length:500},(_,i)=>points[Math.round(i*(points.length-1)/499)]):points;
 let south=90,north=-90,west=180,east=-180;for(const p of sampled){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))return '';south=Math.min(south,p[0]);north=Math.max(north,p[0]);west=Math.min(west,p[1]);east=Math.max(east,p[1]);}
 const lonScale=Math.max(.01,Math.cos((north+south)/2*Math.PI/180)),width=(east-west)*lonScale,height=north-south,scale=Math.min(288/(width||1e-9),104/(height||1e-9));
 const offsetX=(320-width*scale)/2,offsetY=(136-height*scale)/2;
 return sampled.map((p,i)=>`${i?'L':'M'}${(offsetX+(p[1]-west)*lonScale*scale).toFixed(1)},${(offsetY+(north-p[0])*scale).toFixed(1)}`).join(' ');
}
export function renderPreview(container,item,{label='Aperçu',meta=''}={}){
 container.replaceChildren();if(!item){const p=document.createElement('p');p.className='empty';p.textContent='Choisissez un élément pour voir son aperçu.';container.append(p);return;}
 const path=previewPath(item.coordinates||item.preview),graphic=document.createElement('div');graphic.className='preview-graphic';
 // Only generated numeric coordinates enter this markup. User-supplied labels use textContent below.
 if(path)graphic.innerHTML=`<svg viewBox="0 0 320 136" role="img" aria-label="Aperçu du tracé"><path class="preview-underlay" d="${path}"/><path class="preview-path" d="${path}"/></svg>`;
 else{const p=document.createElement('p');p.className='empty';p.textContent='Aperçu du tracé indisponible';graphic.append(p);}
 const eyebrow=document.createElement('small'),title=document.createElement('strong'),details=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent=label;title.textContent=item.name;details.className='preview-meta';details.textContent=meta;container.append(graphic,eyebrow,title,details);
}
