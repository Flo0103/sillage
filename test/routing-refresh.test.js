import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {refreshRoutingNetworks} from '../server/routing-refresh.js';
const exec=promisify(execFile),project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runner=project+'/deploy/refresh-routing.sh';
test('actualisation de toutes les régions installées, sans doublon et strictement une à la fois',async()=>{
 const calls=[],events=[];let active=0,max=0;
 const result=await refreshRoutingNetworks({listDatasets:async()=>['luxembourg','belgium','belgium'],refreshDataset:async dataset=>{active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));calls.push(dataset);active--;},onEvent:e=>events.push(e)});
 assert.deepEqual(calls,['belgium','luxembourg']);assert.equal(max,1);assert.deepEqual(result,{updated:calls,failed:[]});assert.deepEqual(events.map(e=>e.status),['started','updated','started','updated']);
});
test('une région échoue : les autres sont traitées et l’échec figure au bilan',async()=>{
 const calls=[],result=await refreshRoutingNetworks({listDatasets:async()=>['belgium','luxembourg'],refreshDataset:async dataset=>{calls.push(dataset);if(dataset==='belgium')throw Error('téléchargement interrompu');}});
 assert.deepEqual(calls,['belgium','luxembourg']);assert.deepEqual(result.updated,['luxembourg']);assert.deepEqual(result.failed,[{dataset:'belgium',error:'téléchargement interrompu'}]);
});
test('aucun réseau, nom invalide ou base indisponible : aucun import involontaire',async()=>{
 let calls=0;for(const listDatasets of [async()=>[],async()=>['../belgium'],async()=>{throw Error('DB indisponible');}])await assert.rejects(refreshRoutingNetworks({listDatasets,refreshDataset:async()=>{calls++;}}));assert.equal(calls,0);
});
test('arrêt demandé pendant une région : les suivantes ne sont pas lancées',async()=>{
 const control=new AbortController(),calls=[];
 await assert.rejects(refreshRoutingNetworks({signal:control.signal,listDatasets:async()=>['belgium','luxembourg'],refreshDataset:async dataset=>{calls.push(dataset);control.abort(Error('arrêt demandé'));}}),/arrêt demandé/);assert.deepEqual(calls,['belgium']);
});

async function host(){
 const directory=await mkdtemp(tmpdir()+'/sillage-refresh-test-');await mkdir(directory+'/bin');
 const script=`#!/usr/bin/env python3
import os,sys,json,time
a=sys.argv[1:]
with open(os.environ['MOCK_DOCKER_LOG'],'a') as f:f.write(json.dumps(a)+'\\n')
token_path=os.environ['MOCK_TOKEN_FILE']
if a[:2]==['image','inspect']:sys.exit(int(os.environ.get('MOCK_IMAGE_EXIT','0')))
if a[:2]==['container','inspect']:
 if os.environ.get('MOCK_FOREIGN')=='1':print('foreign-owner');sys.exit(0)
 try:print(open(token_path).read());sys.exit(0)
 except FileNotFoundError:sys.exit(1)
if a[:2]==['container','stop']:
 try:os.unlink(token_path)
 except FileNotFoundError:pass
 sys.exit(0)
if a[:3]!=['compose','--profile','tools']:sys.exit(99)
b=a[3:]
if b[:2]==['config','--images']:print('sillage-routing-import:local');sys.exit(0)
if b[:1]==['config']:sys.exit(0)
if b[:1]==['exec']:sys.exit(int(os.environ.get('MOCK_DB_EXIT','0')))
if b[:1]==['run']:
 label=b[b.index('--label')+1].split('=',1)[1]
 with open(token_path,'w') as f:f.write(label)
 with open(os.environ['MOCK_RUN_MARKER'],'w') as f:f.write('started')
 time.sleep(float(os.environ.get('MOCK_RUN_DELAY','0')))
 code=int(os.environ.get('MOCK_RUN_EXIT','0'))
 if code==0:
  try:os.unlink(token_path)
  except FileNotFoundError:pass
 sys.exit(code)
sys.exit(98)
`;
 await writeFile(directory+'/bin/docker',script,{mode:0o755});
 const env={...process.env,PATH:directory+'/bin:'+process.env.PATH,SILLAGE_ROUTING_UPDATE_LOCK:directory+'/update.lock',MOCK_DOCKER_LOG:directory+'/docker.log',MOCK_TOKEN_FILE:directory+'/token',MOCK_RUN_MARKER:directory+'/started'};
 return {directory,env,async commands(){return (await readFile(env.MOCK_DOCKER_LOG,'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));},close:()=>rm(directory,{recursive:true,force:true})};
}
async function started(path){for(let i=0;i<100;i++){if(await stat(path).then(()=>true).catch(()=>false))return;await new Promise(r=>setTimeout(r,10));}throw Error('mock Docker was not reached');}
test('tâche hôte : réutilise l’image, ne lance pas de dépendances et supervise toutes les régions',async()=>{
 const h=await host();try{const result=await exec('bash',[runner],{env:h.env});assert.match(result.stdout,/terminée/);const calls=await h.commands(),run=calls.find(c=>c[3]==='run');assert.ok(run.includes('--no-deps'));assert.equal(run[run.indexOf('--pull')+1],'never');assert.equal(run.at(-1),'server/refresh-routing.js');assert.ok(!calls.some(c=>c.includes('build')||c.includes('up')||c.includes('pull')));}finally{await h.close();}
});
test('tâche hôte : code d’échec conservé et nettoyage du seul conteneur appartenant à cette exécution',async()=>{
 const h=await host();try{
  await assert.rejects(exec('bash',[runner],{env:{...h.env,MOCK_RUN_EXIT:'17'}}),e=>e.code===17);assert.ok((await h.commands()).some(c=>c[0]==='container'&&c[1]==='stop'));
  await writeFile(h.env.MOCK_DOCKER_LOG,'');await assert.rejects(exec('bash',[runner],{env:{...h.env,MOCK_RUN_EXIT:'18',MOCK_FOREIGN:'1'}}),e=>e.code===18);assert.ok(!(await h.commands()).some(c=>c[0]==='container'&&c[1]==='stop'));
 }finally{await h.close();}
});
test('tâche hôte : image absente ou base arrêtée empêchent le lancement de l’import',async()=>{
 const h=await host();try{for(const failure of [{MOCK_IMAGE_EXIT:'1'},{MOCK_DB_EXIT:'2'}]){await writeFile(h.env.MOCK_DOCKER_LOG,'');await assert.rejects(exec('bash',[runner],{env:{...h.env,...failure}}));assert.ok(!(await h.commands()).some(c=>c[3]==='run'));}}finally{await h.close();}
});
test('deux lancements simultanés : un seul import hôte',async()=>{
 const h=await host();let first;try{first=spawn('bash',[runner],{env:{...h.env,MOCK_RUN_DELAY:'0.4'},stdio:'ignore'});const finished=once(first,'close');await started(h.env.MOCK_RUN_MARKER);const second=await exec('bash',[runner],{env:h.env});assert.match(second.stdout,/déjà en cours/);assert.equal((await finished)[0],0);assert.equal((await h.commands()).filter(c=>c[3]==='run').length,1);}finally{first?.kill();await h.close();}
});
test('arrêt du service : le conteneur de cette exécution est arrêté et le statut reste non nul',async()=>{
 const h=await host();let worker;try{worker=spawn('bash',[runner],{env:{...h.env,MOCK_RUN_DELAY:'20'},detached:true,stdio:'ignore'});const finished=once(worker,'close');await started(h.env.MOCK_RUN_MARKER);process.kill(-worker.pid,'SIGTERM');const [code,signal]=await finished;assert.ok(code!==0||signal);assert.ok((await h.commands()).some(c=>c[0]==='container'&&c[1]==='stop'));}finally{if(worker?.exitCode===null)try{process.kill(-worker.pid,'SIGKILL');}catch{}await h.close();}
});
async function renderUnits(directory,name){
 const copy=directory+'/'+name,units=directory+'/units';await mkdir(copy+'/deploy',{recursive:true});await cp(project+'/deploy/install-routing-updates.sh',copy+'/deploy/install-routing-updates.sh');await cp(project+'/deploy/systemd',copy+'/deploy/systemd',{recursive:true});await exec('bash',[copy+'/deploy/install-routing-updates.sh','--render',units]);
 return {copy,units,service:await readFile(units+'/sillage-routing-update.service','utf8'),timer:await readFile(units+'/sillage-routing-update.timer','utf8')};
}
test('rendu systemd : WorkingDirectory commence par / sans guillemets pour un dossier standard',async()=>{
 const directory=await mkdtemp(tmpdir()+'/sillage-units-');try{
  const {copy,service}=await renderUnits(directory,'sillage'),value=service.match(/^WorkingDirectory=(.*)$/m)?.[1];assert.ok(value?.startsWith('/'));assert.equal(value,copy+'/');assert.match(service,/^RequiresMountsFor="\/.*"$/m);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('rendu systemd : chemins avec espaces, guillemets, pourcentages, esperluettes et antislashs',async()=>{
 const directory=await mkdtemp(tmpdir()+'/sillage-units-');try{
  for(const name of ['Atlas & 50% "test" \\chemin','Atlas \\','Atlas  ']){
   const {copy,service,timer}=await renderUnits(directory,name),value=service.match(/^WorkingDirectory=(.*)$/m)?.[1];assert.equal(value,copy.replaceAll('%','%%')+'/');assert.equal(await stat(value.replaceAll('%%','%')).then(s=>s.isDirectory()),true);assert.ok(service.includes('RequiresMountsFor="'+copy.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"'));assert.ok(!service.includes('@PROJECT_DIR@'));assert.match(timer,/Sun \*-\*-\* 04:00:00 Europe\/Brussels/);assert.match(timer,/Persistent=false/);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('parseur systemd natif : unités valides et régression du WorkingDirectory entre guillemets rejetée',async t=>{
 const directory=await mkdtemp(tmpdir()+'/sillage-native-units-');try{
  for(const name of ['sillage','Atlas & 50% "test" \\chemin','Atlas \\','Atlas  ']){
   const {units,service}=await renderUnits(directory,name),file=units+'/sillage-routing-update.service';
   // A dependency stub keeps this a configuration check, independent of Docker
   // installation. No service or timer is started by systemd-analyze verify.
   await writeFile(units+'/docker.service','[Service]\nExecStart=/usr/bin/true\n');
   const options={env:{...process.env,SYSTEMD_UNIT_PATH:units+':'},timeout:15000};
   try{await exec('systemd-analyze',['--man=no','--generators=no','verify',file,units+'/sillage-routing-update.timer'],options);}catch(e){
    if(e.code==='ENOENT'||/SO_PASSCRED failed: Operation not permitted/.test(e.stderr||'')){t.skip('parseur systemd indisponible dans cet environnement : '+(e.stderr?.trim()||e.code));return;}throw e;
   }
   await writeFile(file,service.replace(/^WorkingDirectory=(.*)$/m,'WorkingDirectory="$1"'));
   await assert.rejects(exec('systemd-analyze',['--man=no','--generators=no','verify',file],options),e=>/WorkingDirectory=.*path is not absolute|WorkingDirectory= path is not absolute/.test(e.stderr||''));
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('horaire belge : 4 h correspond à 2 h UTC en été et à 3 h UTC en hiver',async t=>{
 try{const summer=await exec('systemd-analyze',['calendar','--base-time=2026-07-01 00:00:00 UTC','Sun *-*-* 04:00:00 Europe/Brussels']),winter=await exec('systemd-analyze',['calendar','--base-time=2026-10-31 00:00:00 UTC','Sun *-*-* 04:00:00 Europe/Brussels']);assert.match(summer.stdout,/2026-07-05 02:00:00 UTC/);assert.match(winter.stdout,/2026-11-01 03:00:00 UTC/);}catch(e){if(e.code==='ENOENT')t.skip('systemd-analyze absent');else throw e;}
});
