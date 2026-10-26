import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
async function oomKills(){
 try{const text=await readFile('/sys/fs/cgroup/memory.events','utf8'),value=text.match(/^oom_kill\s+(\d+)$/m);return value?Number(value[1]):null;}catch{return null;}
}
export async function startOsmiumReader({input,indexPath,spawnProcess=spawn,readOomKills=oomKills}={}){
 if(!input||!indexPath)throw Error('Fichier OSM ou index disque manquant.');
 const before=await readOomKills();
 // Do not run tags-filter with referenced nodes: its id sets can exceed the
 // importer's memory budget. Locate all ways using a disk-backed sparse index,
 // then let the streaming importer retain highways only.
 const child=spawnProcess('osmium',['add-locations-to-ways','--no-progress','-i',`sparse_file_array,${indexPath}`,'-f','opl,locations_on_ways=true,add_metadata=false',input],{stdio:['ignore','pipe','inherit'],env:{...process.env,OSMIUM_POOL_THREADS:'1'}});
 let closed=false;
 const completed=once(child,'close').then(async([code,signal])=>{
  closed=true;if(code===0&&!signal)return;
  const after=await readOomKills(),outOfMemory=signal==='SIGKILL'&&before!==null&&after!==null&&after>before;
  const message=outOfMemory?'Osmium arrêté par manque de mémoire (SIGKILL, OOM du conteneur). L’ancien réseau reste actif.':signal?`Osmium interrompu par ${signal}. L’ancien réseau reste actif.`:`Osmium a échoué avec le code ${code}. L’ancien réseau reste actif.`;
  throw Object.assign(Error(message),{code:outOfMemory?'OSMIUM_OOM':'OSMIUM_FAILED',signal:signal||null,exitCode:code});
 },cause=>{closed=true;throw Object.assign(Error(cause.code==='ENOENT'?'Osmium est introuvable. Reconstruisez l’image routing-import.':`Impossible de lancer Osmium : ${cause.message}`),{cause});});
 // Reading/importing the pipe can fail before the child finishes. Keep the
 // rejection handled until the importer validates it, before activation.
 completed.catch(()=>{});
 const stop=async()=>{if(closed)return;child.kill('SIGTERM');const timer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},1500);try{await completed.catch(()=>{});}finally{clearTimeout(timer);}};
 return {stream:child.stdout,completed,stop};
}
