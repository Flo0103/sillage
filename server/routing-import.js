import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
const excluded=/^(motorway|trunk|motorway_link|trunk_link|steps|construction|proposed)$/;
const decode=text=>text.replace(/%([a-f0-9]{1,6})%/gi,(_,hex)=>{const code=parseInt(hex,16);if(code>0x10ffff||code>=0xd800&&code<=0xdfff)throw Error('Caractère OPL invalide.');return String.fromCodePoint(code);});
// Osmium supplies locations on ways, so a country-sized node map never has
// to live in Node's heap. Real OSM node ids are retained for every connection.
export function parseRoutingWay(line){
 if(!line.startsWith('w'))return null;const fields=line.trim().split(' '),id=Number(fields[0].slice(1));if(!Number.isSafeInteger(id)||id<=0)throw Error('Identifiant OSM invalide.');if(fields.includes('dD'))return null;
 const raw=fields.find(f=>f.startsWith('T'))?.slice(1)||'',tags={};
 for(const tag of raw.split(',')){if(!tag)continue;const at=tag.indexOf('=');if(at<1)throw Error('Tag OPL invalide.');const key=decode(tag.slice(0,at));if(['__proto__','constructor','prototype'].includes(key))continue;tags[key]=decode(tag.slice(at+1));}
 if(!tags.highway||excluded.test(tags.highway))return null;
 const refs=fields.find(f=>f.startsWith('N'))?.slice(1).split(',')||[];if(refs.length<2||refs.length>100000)throw Error('Chemin OSM incomplet.');
 const nodes=[],geometry=[];for(const ref of refs){const m=ref.match(/^n(\d+)x(-?\d+(?:\.\d+)?)y(-?\d+(?:\.\d+)?)$/);if(!m)throw Error('Coordonnées OSM manquantes. Utilisez add-locations-to-ways.');const node=Number(m[1]),lon=Number(m[2]),lat=Number(m[3]);if(!Number.isSafeInteger(node)||node<=0||Math.abs(lon)>180||Math.abs(lat)>90)throw Error('Coordonnée OSM invalide.');nodes.push(node);geometry.push({lat,lon});}
 return {type:'way',id,nodes,geometry,tags};
}
export async function importRoutingWays({client,stream,dataset,source,onProgress=()=>{},validate=async()=>{}}){
 if(!/^[a-z0-9][a-z0-9_/-]{0,79}$/.test(dataset)||dataset.includes('..'))throw Error('Région invalide.');
 const revision=randomUUID();let locked=false,created=false,activated=false,count=0,batch=[];
 const flush=async()=>{if(!batch.length)return;const rows=batch.map(w=>({...w,geojson:{type:'LineString',coordinates:w.geometry.map(p=>[p.lon,p.lat])}}));
  await client.query("INSERT INTO routing_ways(revision,osm_id,data,geom) SELECT $1,(v->>'id')::bigint,v-'geojson',ST_SetSRID(ST_GeomFromGeoJSON(v->'geojson'),4326) FROM jsonb_array_elements($2::jsonb) v",[revision,JSON.stringify(rows)]);count+=batch.length;batch=[];if(count%10000===0)onProgress(count);
 };
 try{
  const lock=await client.query("SELECT pg_try_advisory_lock(hashtext('sillage-routing-import:'||$1)) AS locked",[dataset]);if(!lock.rows[0]?.locked)throw Error('Un import de cette région est déjà en cours.');locked=true;
  await client.query('INSERT INTO routing_networks(revision,dataset,source) VALUES($1,$2,$3)',[revision,dataset,source]);created=true;
  const lines=createInterface({input:stream,crlfDelay:Infinity});let inputError=null;const failed=e=>{inputError=e;lines.close();};stream.on('error',failed);
  try{for await(const line of lines){if(line.length>16*1024*1024)throw Error('Ligne OSM trop détaillée.');const way=parseRoutingWay(line);if(way)batch.push(way);if(batch.length>=300)await flush();}if(inputError)throw inputError;await flush();}finally{stream.off('error',failed);lines.close();}
  await validate();if(!count)throw Error('Aucun chemin routable dans cet import.');
  await client.query('ANALYZE routing_ways');
  const ext=await client.query('SELECT ARRAY[ST_YMin(b),ST_XMin(b),ST_YMax(b),ST_XMax(b)] AS bounds FROM (SELECT ST_Extent(geom)::box3d AS b FROM routing_ways WHERE revision=$1) s',[revision]),bounds=ext.rows[0]?.bounds;
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite))throw Error('Emprise OSM invalide.');
  await client.query('BEGIN');try{
   await client.query('UPDATE routing_networks SET active=false,retired_at=now() WHERE dataset=$1 AND active=true',[dataset]);
   await client.query('UPDATE routing_networks SET active=true,way_count=$1,bounds=$2::jsonb WHERE revision=$3',[count,JSON.stringify(bounds),revision]);
   await client.query('COMMIT');activated=true;
  }catch(e){await client.query('ROLLBACK');throw e;}
  // Keep retired data a day so requests pinned to an earlier revision finish.
  await client.query("DELETE FROM routing_networks WHERE dataset=$1 AND active=false AND COALESCE(retired_at,imported_at)<now()-interval '1 day'",[dataset]);
  onProgress(count);return {dataset,revision,ways:count,bounds};
 }finally{
  if(created&&!activated)await client.query('DELETE FROM routing_networks WHERE revision=$1 AND active=false',[revision]);
  if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('sillage-routing-import:'||$1))",[dataset]);
 }
}
