import {validateBox} from './osm.js';
const contains=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const unavailable=message=>Object.assign(Error(message),{status:503});
export function createStoredOSM({db,remote,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let bytes=0,state=null,stateAt=-Infinity,stateJob=null;
 const read=async(...args)=>{try{return await db.query(...args);}catch(cause){throw Object.assign(unavailable('Le stockage du réseau de routage est indisponible. Réessayez dans quelques instants.'),{cause});}};
 async function networks(){
  if(state&&now()-stateAt<2000)return state;if(stateJob)return stateJob;
  stateJob=(async()=>{const q=await read('SELECT revision,dataset,source,bounds,way_count,imported_at FROM routing_networks WHERE active=true ORDER BY dataset');const next=q.rows,stamp=next.map(n=>n.revision).join(',');if(state&&stamp!==state.map(n=>n.revision).join(',')){cache.clear();bytes=0;}state=next;stateAt=now();return next;})();
  try{return await stateJob;}finally{stateJob=null;}
 }
 const matching=(rows,box)=>rows.filter(n=>Array.isArray(n.bounds)&&n.bounds[0]<=box[2]&&n.bounds[2]>=box[0]&&n.bounds[1]<=box[3]&&n.bounds[3]>=box[1]);
 function remember(key,data){const size=Buffer.byteLength(JSON.stringify(data));if(size>32*1024*1024)throw unavailable('Zone routable trop détaillée. Ajoutez un point de passage.');while(cache.size&&(cache.size>=12||bytes+size>32*1024*1024)){const first=cache.keys().next().value;bytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{data,bytes:size});bytes+=size;return data;}
 const service=async (input,{routing=false}={})=>{
  const box=validateBox(input),rows=matching(await networks(),box);
  if(!rows.length){if(remote)return routing&&remote.forRouting?remote.forRouting(box):remote(box);throw unavailable('Cette zone ne fait pas partie du réseau OSM installé.');}
  const revisions=rows.map(n=>n.revision),stamp=revisions.join(',');
  for(const item of cache.values())if(item.data.revision===stamp&&contains(item.data.bbox,box))return {...item.data,cached:true};
  const step=.025;let frame=[Math.floor(box[0]/step)*step,Math.floor(box[1]/step)*step,Math.ceil(box[2]/step)*step,Math.ceil(box[3]/step)*step].map(v=>Number(v.toFixed(6)));try{validateBox(frame);}catch{frame=box;}
  const key=stamp+':'+frame.join(',');if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   const began=performance.now();
   const q=await read({text:'SELECT DISTINCT ON (osm_id) data FROM routing_ways WHERE revision=ANY($1::uuid[]) AND geom && ST_MakeEnvelope($2,$3,$4,$5,4326) ORDER BY osm_id,revision LIMIT 25001',values:[revisions,frame[1],frame[0],frame[3],frame[2]],query_timeout:5000});
   if(q.rows.length>25000)throw unavailable('Zone routable trop détaillée. Ajoutez un point de passage.');
   // A country's bounds include neighbouring countries and holes in its data.
   // An empty indexed window is not proof that no road exists there.
   if(!q.rows.length&&remote)return routing&&remote.forRouting?remote.forRouting(frame):remote(frame);
   return remember(key,{elements:q.rows.map(r=>r.data),bbox:frame,source:'PostGIS · '+rows.map(n=>n.dataset).join(' + '),revision:stamp,offline:true,cached:false,readMs:Math.round((performance.now()-began)*100)/100});
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 };
 service.forRouting=input=>service(input,{routing:true});
 service.peek=(input,options)=>{const box=validateBox(input);if(!state?.length||!matching(state,box).length)return remote?.peek?.(box,options)||null;if(now()-stateAt>=2000)return null;const current=new Set(state.map(n=>n.revision));for(const item of cache.values())if(item.data.revision.split(',').every(r=>current.has(r))&&contains(item.data.bbox,box))return {...item.data,cached:true};return null;};
 service.covers=async points=>{
  const rows=await networks();if(!rows.length)return false;
  // Requiring an imported road near every control avoids treating the country's
  // rectangular bounding box as complete coverage of neighbouring countries.
  const revisions=rows.map(n=>n.revision),q=await read({text:'SELECT count(*)::integer AS found FROM jsonb_array_elements($2::jsonb) p WHERE EXISTS (SELECT 1 FROM routing_ways w WHERE w.revision=ANY($1::uuid[]) AND w.geom && ST_Expand(ST_SetSRID(ST_MakePoint((p->>1)::float,(p->>0)::float),4326),0.004) AND ST_DWithin(w.geom::geography,ST_SetSRID(ST_MakePoint((p->>1)::float,(p->>0)::float),4326)::geography,300))',values:[revisions,JSON.stringify(points)],query_timeout:5000});return q.rows[0]?.found===points.length;
 };
 service.status=async()=>({mode:(await networks()).length?'stored':'public',networks:(await networks()).map(({dataset,way_count,imported_at,bounds})=>({dataset,ways:way_count,importedAt:imported_at,bounds}))});
 service.forRoute=async guide=>{
  const rows=await networks();if(!rows.length){if(remote?.forRoute)return remote.forRoute(guide);throw unavailable('Aucun réseau OSM installé.');}
  if(!await service.covers(guide.points)&&remote?.forRoute)return remote.forRoute(guide);
  const ids=guide.nodes;if(!Array.isArray(ids)||!ids.length||ids.length>25000||ids.some(n=>!Number.isSafeInteger(n)||n<=0))throw unavailable('Guide OSM incomplet.');
  // Node ids alone are not a substitute for the spatial index. Small buffers
  // along the candidate select complete local ways, including clicked controls.
  const points=guide.coordinates.concat(guide.points),coordinates=JSON.stringify(points.map(p=>[p[1],p[0]]));
  const q=await read({text:"SELECT DISTINCT ON (osm_id) data FROM routing_ways WHERE revision=ANY($1::uuid[]) AND geom && ST_Expand(ST_Envelope(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)),0.004) AND ST_DWithin(geom::geography,ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography,350) ORDER BY osm_id,revision LIMIT 25001",values:[rows.map(n=>n.revision),JSON.stringify({type:'LineString',coordinates:JSON.parse(coordinates)})],query_timeout:5000});
  if(q.rows.length>25000)throw unavailable('Guide OSM trop détaillé.');
  // Both endpoints can be covered while the public candidate crosses a border.
  // Check the candidate's actual OSM nodes before trusting the stored corridor.
  const missing=new Set(ids);for(const row of q.rows){for(const id of row.data.nodes||[])missing.delete(id);if(!missing.size)break;}
  if(missing.size){if(remote?.forRoute)return remote.forRoute(guide);throw unavailable('Le trajet sort du réseau OSM installé.');}
  return {elements:q.rows.map(r=>r.data),source:'PostGIS · trajet guidé',offline:true};
 };
 return service;
}
