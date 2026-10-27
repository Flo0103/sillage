import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readdir, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'sillage-backup-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'deploy'));await mkdir(join(root,'bin'));
 const script=join(root,'deploy/backup.sh');await copyFile(new URL('../deploy/backup.sh',import.meta.url),script);
 await writeFile(join(root,'bin/docker'),'#!/bin/sh\nprintf "%s\\n" "-- PostgreSQL database dump"\nexit "${DUMP_EXIT:-0}"\n',{mode:0o755});
 const run=(env={})=>spawnSync('bash',[script],{cwd:tmpdir(),encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,...env}});
 return {root,run,files:()=>readdir(join(root,'backups'))};
}

test('sauvegarde : fichier complet, compressé et privé, créé depuis un autre répertoire',async t=>{
 const f=await fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);
 const files=await f.files();assert.equal(files.length,1);assert.match(files[0],/\.sql\.gz$/);
 const path=join(f.root,'backups',files[0]);assert.match(gunzipSync(await readFile(path)).toString(),/PostgreSQL database dump/);
 assert.equal((await stat(path)).mode&0o777,0o600);assert.match(result.stdout,/Sauvegarde créée/);
});

test('sauvegarde : pg_dump échoue après des données partielles, aucun faux succès ni fichier publié',async t=>{
 const f=await fixture(t);assert.equal(f.run().status,0);const previous=await f.files(),data=await readFile(join(f.root,'backups',previous[0]));
 const result=f.run({DUMP_EXIT:'7'});assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/Sauvegarde créée/);
 assert.deepEqual(await f.files(),previous);assert.deepEqual(await readFile(join(f.root,'backups',previous[0])),data);
});

test('sauvegarde : deux exécutions rapprochées conservent deux archives distinctes',async t=>{
 const f=await fixture(t);assert.equal(f.run().status,0);assert.equal(f.run().status,0);
 const files=await f.files();assert.equal(files.length,2);assert.ok(files.every(name=>name.endsWith('.sql.gz')));
});
