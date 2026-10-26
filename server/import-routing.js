import {mkdir,stat,rename,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pool,migrate} from './db.js';
import {importRoutingWays} from './routing-import.js';
const dataset=process.env.ROUTING_REGION||'belgium',directory=process.env.ROUTING_IMPORT_DIR||'/data',refresh=process.argv.includes('--refresh');
async function run(command,args){const child=spawn(command,args,{stdio:['ignore','inherit','inherit']});const [code]=await once(child,'exit');if(code!==0)throw Error(`${command} a échoué (${code}).`);}
let client,processOSM,preparing=false;
try{
 if(!/^[a-z0-9][a-z0-9_/-]{0,79}$/.test(dataset)||dataset.includes('..'))throw Error('ROUTING_REGION invalide.');
 await migrate();client=await pool.connect();const lock=await client.query("SELECT pg_try_advisory_lock(hashtext('sillage-routing-prepare')) AS locked");if(!lock.rows[0]?.locked)throw Error('Une préparation OSM est déjà en cours. Attendez sa fin.');preparing=true;
 await mkdir(directory,{recursive:true});const prefix=directory+'/'+dataset.replaceAll('/','_'),file=prefix+'.osm.pbf',filtered=prefix+'-roads.osm.pbf',source=`https://download.geofabrik.de/europe/${dataset}-latest.osm.pbf`;
 const present=await stat(file).then(s=>s.size>0).catch(()=>false);
 if(refresh||!present){
  console.log(`Téléchargement initial : ${source} (hors calcul des itinéraires)`);
  const response=await fetch(source,{signal:AbortSignal.timeout(1200000)});if(!response.ok||!response.body)throw Error(`Téléchargement OSM impossible (${response.status}).`);
  const temp=file+'.part';try{await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));await rename(temp,file);}catch(e){await rm(temp,{force:true});throw e;}
 }else console.log('Extrait déjà téléchargé. --refresh permet sa mise à jour.');
 console.log('Filtrage des routes et chemins OSM…');await run('osmium',['tags-filter',file,'w/highway','--overwrite','-o',filtered]);
 console.log('Import progressif dans PostGIS (l’ancien réseau reste actif)…');
 processOSM=spawn('osmium',['add-locations-to-ways','-i','sparse_mem_array','-f','opl,locations_on_ways=true,add_metadata=false',filtered],{stdio:['ignore','pipe','inherit']});
 const completed=once(processOSM,'exit').then(([code])=>{if(code!==0)throw Error(`Lecture OSM interrompue (${code}).`);});completed.catch(()=>{});
 const result=await importRoutingWays({client,stream:processOSM.stdout,dataset,source,validate:()=>completed,onProgress:count=>console.log(`${count.toLocaleString('fr-FR')} chemins importés`)});
 console.log(JSON.stringify({ok:true,...result}));await rm(filtered,{force:true});console.log('Réseau local actif. Lancez le diagnostic de routage pour mesurer les temps.');
}catch(e){console.error(e.message);process.exitCode=1;processOSM?.kill();}
finally{if(preparing)await client.query("SELECT pg_advisory_unlock(hashtext('sillage-routing-prepare'))");client?.release();await pool.end();}
