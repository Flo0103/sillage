import {mkdir,mkdtemp,stat,rename,rm,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pool,migrate} from './db.js';
import {importRoutingWays} from './routing-import.js';
import {startOsmiumReader} from './osmium-reader.js';
const dataset=process.env.ROUTING_REGION||'belgium',directory=process.env.ROUTING_IMPORT_DIR||'/data',refresh=process.argv.includes('--refresh');
let client,reader,workdir,heartbeat,preparing=false;
try{
 if(!/^[a-z0-9][a-z0-9_/-]{0,79}$/.test(dataset)||dataset.includes('..'))throw Error('ROUTING_REGION invalide.');
 await migrate();client=await pool.connect();const lock=await client.query("SELECT pg_try_advisory_lock(hashtext('sillage-routing-prepare')) AS locked");if(!lock.rows[0]?.locked)throw Error('Une préparation OSM est déjà en cours. Attendez sa fin.');preparing=true;
 await mkdir(directory,{recursive:true});const prefix=directory+'/'+dataset.replaceAll('/','_'),file=prefix+'.osm.pbf',source=`https://download.geofabrik.de/europe/${dataset}-latest.osm.pbf`;
 // The preparation lock excludes any other live importer. Only these scratch
 // directories are disposable; the downloaded source extract is retained.
 for(const entry of await readdir(directory,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('.routing-import-'))await rm(directory+'/'+entry.name,{recursive:true,force:true});
 await rm(prefix+'-roads.osm.pbf',{force:true});
 const present=await stat(file).then(s=>s.size>0).catch(()=>false);
 if(refresh||!present){
  console.log(`Téléchargement initial : ${source} (hors calcul des itinéraires)`);
  const response=await fetch(source,{signal:AbortSignal.timeout(1200000)});if(!response.ok||!response.body)throw Error(`Téléchargement OSM impossible (${response.status}).`);
  const temp=file+'.part';try{await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));await rename(temp,file);}catch(e){await rm(temp,{force:true});throw e;}
 }else console.log('Extrait déjà téléchargé. --refresh permet sa mise à jour.');
 workdir=await mkdtemp(directory+'/.routing-import-');
 console.log('Lecture OSM avec index de coordonnées sur disque, sans filtrage en mémoire…');
 reader=await startOsmiumReader({input:file,indexPath:workdir+'/nodes.idx'});
 console.log('Import progressif des chemins dans PostGIS (l’ancien réseau reste actif)…');
 const began=Date.now();let imported=0;heartbeat=setInterval(()=>console.log(imported?`Import en cours : ${imported.toLocaleString('fr-FR')} chemins enregistrés…`:`Construction de l’index sur disque en cours (${Math.round((Date.now()-began)/1000)} s)…`),15000);heartbeat.unref();
 const result=await importRoutingWays({client,stream:reader.stream,dataset,source,validate:()=>reader.completed,onProgress:count=>{imported=count;console.log(`${count.toLocaleString('fr-FR')} chemins importés`);}});
 console.log(JSON.stringify({ok:true,...result}));console.log('Réseau local actif. Lancez le diagnostic de routage pour mesurer les temps.');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
 clearInterval(heartbeat);
 try{await reader?.stop();if(workdir)await rm(workdir,{recursive:true,force:true});}
 finally{try{if(preparing)await client.query("SELECT pg_advisory_unlock(hashtext('sillage-routing-prepare'))");}finally{client?.release();await pool.end();}}
}
