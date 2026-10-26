import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {startOsmiumReader} from '../server/osmium-reader.js';
function processStub(){const child=new EventEmitter();child.stdout=Readable.from([]);child.signals=[];child.kill=signal=>{child.signals.push(signal);setImmediate(()=>child.emit('close',null,signal));return true;};return child;}
test('lecteur utilise un index fichier explicite, sans filtrage à références en mémoire',async()=>{
 const child=processStub();let command,options;const reader=await startOsmiumReader({input:'/data/belgium.osm.pbf',indexPath:'/data/scratch/nodes.idx',readOomKills:async()=>0,spawnProcess:(...args)=>{command=args.slice(0,2);options=args[2];return child;}});
 assert.equal(command[0],'osmium');assert.equal(command[1][0],'add-locations-to-ways');assert.ok(command[1].includes('sparse_file_array,/data/scratch/nodes.idx'));assert.ok(!command[1].includes('tags-filter'));assert.equal(options.env.OSMIUM_POOL_THREADS,'1');assert.equal(reader.stream,child.stdout);child.emit('close',0,null);await reader.completed;await reader.stop();assert.deepEqual(child.signals,[]);
});
test('SIGKILL et compteur OOM augmenté : message de mémoire précis, validation refusée',async()=>{
 const child=processStub();let reads=0;const reader=await startOsmiumReader({input:'x',indexPath:'y',spawnProcess:()=>child,readOomKills:async()=>reads++?8:7});child.emit('close',null,'SIGKILL');
 await assert.rejects(reader.completed,e=>e.code==='OSMIUM_OOM'&&e.signal==='SIGKILL'&&/manque de mémoire/.test(e.message)&&!/\(null\)/.test(e.message));
});
test('SIGKILL sans preuve OOM et SIGTERM : signal conservé sans inventer une cause mémoire',async()=>{
 for(const signal of ['SIGKILL','SIGTERM']){const child=processStub(),reader=await startOsmiumReader({input:'x',indexPath:'y',spawnProcess:()=>child,readOomKills:async()=>null});child.emit('close',null,signal);await assert.rejects(reader.completed,e=>e.code==='OSMIUM_FAILED'&&e.signal===signal&&e.message.includes(signal)&&!/manque de mémoire/.test(e.message));}
});
test('code de sortie non nul et binaire absent : échecs explicites',async()=>{
 const child=processStub(),reader=await startOsmiumReader({input:'x',indexPath:'y',spawnProcess:()=>child,readOomKills:async()=>0});child.emit('close',2,null);await assert.rejects(reader.completed,e=>e.exitCode===2&&/code 2/.test(e.message));
 const missing=processStub(),absent=await startOsmiumReader({input:'x',indexPath:'y',spawnProcess:()=>missing,readOomKills:async()=>0});missing.emit('error',Object.assign(Error('spawn missing'),{code:'ENOENT'}));await assert.rejects(absent.completed,/Osmium est introuvable/);
});
test('arrêt après erreur de lecture : enfant terminé avant nettoyage de l’index',async()=>{
 const child=processStub(),reader=await startOsmiumReader({input:'x',indexPath:'y',spawnProcess:()=>child,readOomKills:async()=>0});await reader.stop();assert.deepEqual(child.signals,['SIGTERM']);await assert.rejects(reader.completed,e=>e.signal==='SIGTERM');
});
