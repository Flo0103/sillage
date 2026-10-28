import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.js';
import {hashPassword,tokenHash} from '../server/model.js';
import {createAdmissionController} from '../server/security.js';

const session='a'.repeat(64),password='Un mot de passe de test 2026';
const stored=await hashPassword(password);
async function fixture(t,options={}) {
  const limits=new Map(),queries=[];
  const db={async query(sql,args=[]){
    queries.push({sql,args});
    if(sql.includes('RETURNING attempts')){const attempts=(limits.get(args[0])||0)+1;limits.set(args[0],attempts);return {rows:[{attempts}]};}
    if(sql.startsWith('SELECT id,username,password_hash'))return {rows:args[0]==='alice'?[{id:'alice',username:'alice',password_hash:stored}]:[]};
    if(sql.includes('FROM sessions s'))return {rows:args[0]===tokenHash(session)?[{id:'alice',username:'alice'}]:[]};
    return {rows:[],rowCount:1};
  }};
  const server=createApp(db,{origin:'https://sillage.test',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const request=async(path,{method='GET',body,ip='198.51.100.1',authenticated=false}={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Origin:'https://sillage.test','X-Real-IP':ip,'Content-Type':'application/json',...(authenticated?{Cookie:'sillage_session='+session}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    return {status:response.status,headers:response.headers,body:await response.text()};
  };
  return {server,request,queries};
}

test('attaquer un identifiant ne bloque pas son propriétaire depuis une autre IP',async t=>{
  const {request}=await fixture(t);
  for(let i=0;i<20;i++)assert.equal((await request('/api/login',{method:'POST',body:{username:'alice',password:'incorrect'}})).status,401);
  const blocked=await request('/api/login',{method:'POST',body:{username:'alice',password}});
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'900');
  const owner=await request('/api/login',{method:'POST',body:{username:'alice',password},ip:'203.0.113.2'});
  assert.equal(owner.status,200);assert.match(owner.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
});

test('petits corps authentification : refus 413 puis créneau libéré après erreur',async t=>{
  const {request}=await fixture(t);
  for(const path of ['/api/login','/api/accept-invitation','/api/invitation-info'])assert.equal((await request(path,{method:'POST',body:{username:'x'.repeat(17000)}})).status,413,path);
  assert.equal((await request('/api/login',{method:'POST',body:{username:'alice',password}})).status,200);
});

test('débit API refusé avant PostgreSQL, reprise après renouvellement du budget',async t=>{
  let now=0;const {request,queries}=await fixture(t,{admission:createAdmissionController({now:()=>now})});
  for(let i=0;i<120;i++)assert.equal((await request('/api/me',{authenticated:true})).status,200);
  const before=queries.length,rejected=await request('/api/me',{authenticated:true});
  assert.equal(rejected.status,429);assert.equal(rejected.headers.get('retry-after'),'1');assert.equal(queries.length,before);
  now=500;assert.equal((await request('/api/me',{authenticated:true})).status,200);
});

test('routage : plafonds par IP et global, reprise après libération des calculs',{timeout:5000},async t=>{
  let started=0;const pending=[];
  const routingService=()=>{started++;return new Promise(resolve=>pending.push(resolve));};
  const {request}=await fixture(t,{routingService});
  async function start(ip){const result=request('/api/route',{method:'POST',body:{},ip,authenticated:true});const deadline=Date.now()+2000;while(pending.length<jobs.length+1){assert.ok(Date.now()<deadline,'Le calcul admis doit démarrer');await new Promise(resolve=>setTimeout(resolve,5));}return {result};}
  const jobs=[];
  t.after(()=>{for(const resolve of pending)resolve({});});
  jobs.push((await start('198.51.100.1')).result);jobs.push((await start('198.51.100.1')).result);
  assert.equal((await request('/api/route',{method:'POST',body:{},authenticated:true})).status,429);
  jobs.push((await start('198.51.100.2')).result);jobs.push((await start('198.51.100.2')).result);
  assert.equal((await request('/api/route',{method:'POST',body:{},ip:'198.51.100.3',authenticated:true})).status,429);
  for(const resolve of pending)resolve({engine:'test'});
  assert.ok((await Promise.all(jobs)).every(r=>r.status===200));
  const next=await start('198.51.100.1');pending.at(-1)({engine:'test'});assert.equal((await next.result).status,200);
});

test('admission : mémoire bornée et créneaux authentification/uploads libérés une seule fois',()=>{
  let now=0;const bounded=createAdmissionController({maxEntries:2,now:()=>now});
  bounded.enter('/api/me','GET','one')();bounded.enter('/api/me','GET','two')();
  assert.throws(()=>bounded.enter('/api/me','GET','three'),e=>e.status===429);
  now=60000;bounded.enter('/api/me','GET','three')();
  const guard=createAdmissionController(),auth=[];
  for(let i=0;i<4;i++)auth.push(guard.enter('/api/login','POST',String(i)));
  assert.throws(()=>guard.enter('/api/login','POST','other'),e=>e.status===429);
  auth[0]();auth[0]();const replacement=guard.enter('/api/login','POST','other');
  assert.throws(()=>guard.enter('/api/login','POST','extra'),e=>e.status===429);replacement();for(const release of auth)release();
  const first=guard.enter('/api/rides','POST','one'),second=guard.enter('/api/rides','POST','two');
  assert.throws(()=>guard.enter('/api/rides','POST','three'),e=>e.status===429);first();second();guard.enter('/api/rides','POST','three')();
});

test('carte locale sous CSP stricte, chemins non listés et visiteurs anonymes refusés',async t=>{
  const {request}=await fixture(t);
  for(const path of ['/vendor/leaflet-1.9.4/leaflet.js','/vendor/leaflet-1.9.4/leaflet.css','/vendor/leaflet-1.9.4/images/marker-icon.png']){
    assert.equal((await request(path)).status,303);
    const result=await request(path,{authenticated:true});assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/^private/);
    assert.match(result.headers.get('content-security-policy'),/script-src 'self';/);
  }
  assert.equal((await request('/vendor/leaflet-1.9.4/../security.js',{authenticated:true})).status,404);
  const callback=await request('/strava-callback.js');assert.equal(callback.status,200);assert.match(callback.body,/location.replace/);
  const page=await request('/',{authenticated:true});assert.match(page.body,/src="\/vendor\/leaflet-1.9.4\/leaflet.js"/);assert.doesNotMatch(page.body,/unpkg.com/);
});

test('aucun script HTML inline et fichiers Leaflet conformes au paquet 1.9.4 conservé',async()=>{
  const dist=new URL('../dist/',import.meta.url);
  for(const name of await readdir(dist))if(name.endsWith('.html')){
    const html=await readFile(new URL(name,dist),'utf8');for(const tag of html.matchAll(/<script\b([^>]*)>([^]*?)<\/script>/g)){assert.match(tag[1],/\bsrc="(?!https?:)/,name);assert.equal(tag[2].trim(),'',name);}
  }
  const vendor=new URL('vendor/leaflet-1.9.4/',dist),manifest=JSON.parse(await readFile(new URL('provenance.json',vendor),'utf8'));
  for(const [name,hash]of Object.entries(manifest.sha256)){
    const bytes=await readFile(new URL(name,vendor));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,name);
    const original=new URL('../node_modules/leaflet/'+(name==='LICENSE'?'':'dist/')+name,import.meta.url);assert.deepEqual(bytes,await readFile(original),name+' doit correspondre au paquet npm verrouillé');
  }
});
