import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGpsTransfer,gpsFilename} from '../dist/gps-transfer.js';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const plan={id:'00000000-0000-0000-0000-000000000001',name:'Spa & les crêtes'},other={id:'00000000-0000-0000-0000-000000000002',name:'Retour des Fagnes'};
const gpx='<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Spa &amp; les crêtes</name><type>cycling</type><trkseg><trkpt lat="50" lon="5"><ele>250.0</ele></trkpt><trkpt lat="50.01" lon="5"><ele>300.0</ele></trkpt></trkseg></trk></gpx>';
const response=()=>new Response(gpx,{headers:{'Content-Type':'application/gpx+xml; charset=utf-8'}});
function setup({navigator={},fetcher=async()=>response()}={}){
 const elements=new Map([...html.matchAll(/id="(gps[^"]+)"/g)].map(m=>[m[1],{hidden:false,disabled:false,textContent:'',attributes:{},listeners:{},setAttribute(k,v){this.attributes[k]=String(v);},removeAttribute(k){delete this.attributes[k];},addEventListener(k,fn){this.listeners[k]=fn;}}])),calls=[],parents=[],dialog=elements.get('gpsTransferDialog');
 dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.listeners.close?.();};
 const document={body:{append:node=>parents.push(node)},getElementById:id=>elements.get(id)};
 const controller=createGpsTransfer({document,navigator,fetcher:(...args)=>{calls.push(args);return fetcher(...args);}});
 return {controller,elements,calls,dialog,document,parents};
}
test('ordinateur : choix Garmin / COROS et téléchargement authentifié, sans faux transfert automatique',async()=>{
 const {controller,elements,calls,dialog}=setup({fetcher:async()=>{throw Error('inutile');}});await controller.open(plan);
 assert.equal(dialog.open,true);assert.equal(calls.length,0);assert.equal(elements.get('gpsTransferDownload').href,`/api/plans/${plan.id}/gpx`);assert.equal(elements.get('gpsTransferFilename').textContent,'Spa & les crêtes.gpx');assert.equal(elements.get('gpsTransferShare').hidden,true);
 elements.get('gpsDestinationcoros').onclick();assert.equal(elements.get('gpsDestinationcoros').attributes['aria-pressed'],'true');assert.equal(elements.get('gpsInstructionscoros').hidden,false);assert.equal(elements.get('gpsInstructionsgarmin').hidden,true);assert.match(elements.get('gpsTransferHelp').href,/support.coros.com/);
 elements.get('gpsDestinationgarmin').onclick();assert.match(elements.get('gpsTransferHelp').href,/support.garmin.com/);assert.equal(elements.get('gpsInstructionsgarmin').hidden,false);
 elements.get('gpsTransferClose').onclick();assert.equal(dialog.open,false);
});
test('partage mobile : fichier préchargé, nom seul, sport et altitude conservés, activation du clic préservée',async()=>{
 let sent;const navigator={canShare:({files})=>files[0].type==='application/gpx+xml',share:async data=>{sent=data;}};
 const {controller,elements,calls}=setup({navigator});await controller.open(plan);
 assert.equal(calls.length,1);assert.equal(calls[0][1].credentials,'same-origin');assert.equal(calls[0][1].cache,'no-store');assert.equal(calls[0][1].headers.Accept,'application/gpx+xml');assert.equal(elements.get('gpsTransferShare').disabled,false);
 const sharing=elements.get('gpsTransferShare').onclick();assert.ok(sent,'share appelé dans le clic avant toute attente réseau');assert.deepEqual(Object.keys(sent),['files']);assert.equal(sent.files[0].name,'Spa & les crêtes.gpx');assert.equal(await sent.files[0].text(),gpx);await sharing;
 assert.equal(calls.length,1);assert.match(elements.get('gpsTransferStatus').textContent,/Terminez l’import/);assert.doesNotMatch(elements.get('gpsTransferStatus').textContent,/envoyé|synchronisé/);
});
test('annulation native : aucun téléchargement forcé, le partage reste réessayable',async()=>{
 let attempts=0;const navigator={canShare:()=>true,share:async()=>{attempts++;throw Object.assign(Error('cancel'),{name:'AbortError'});}},s=setup({navigator});await s.controller.open(plan);await s.elements.get('gpsTransferShare').onclick();
 assert.equal(attempts,1);assert.equal(s.elements.get('gpsTransferShare').disabled,false);assert.match(s.elements.get('gpsTransferStatus').textContent,/annulé/);assert.equal(s.calls.length,1);
});
test('partage refusé ou type GPX non pris en charge : téléchargement toujours accessible',async()=>{
 const s=setup({navigator:{canShare:()=>true,share:async()=>{throw Object.assign(Error('blocked'),{name:'NotAllowedError'});}}});await s.controller.open(plan);await s.elements.get('gpsTransferShare').onclick();assert.match(s.elements.get('gpsTransferStatus').textContent,/Téléchargez/);assert.equal(s.elements.get('gpsTransferDownload').href,`/api/plans/${plan.id}/gpx`);
 let shared=0;for(const canShare of [()=>false,()=>{throw Error('unsupported');}]){const x=setup({navigator:{canShare,share:async()=>{shared++;}}});await x.controller.open(plan);assert.equal(x.elements.get('gpsTransferShare').hidden,true);await x.elements.get('gpsTransferShare').onclick();}assert.equal(shared,0);
});
test('session expirée, itinéraire privé ou supprimé et fausse réponse HTML : aucun fichier partagé',async()=>{
 let shared=0;for(const fetcher of [async()=>Response.json({error:'Session expirée.'},{status:401}),async()=>Response.json({error:'Itinéraire introuvable.'},{status:404}),async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}})]){
  const s=setup({navigator:{canShare:()=>true,share:async()=>{shared++;}},fetcher});await s.controller.open(plan);assert.equal(s.elements.get('gpsTransferShare').disabled,true);await s.elements.get('gpsTransferShare').onclick();assert.match(s.elements.get('gpsTransferStatus').textContent,/expirée|introuvable|n’est pas un GPX/);
 }assert.equal(shared,0);
});
test('changement de parcours pendant le chargement : ancienne requête annulée, résultat tardif ignoré',async()=>{
 let first,sent;const s=setup({navigator:{canShare:()=>true,share:async data=>{sent=data;}},fetcher:async path=>path.includes(plan.id)?new Promise(r=>first=r):response()});
 const pending=s.controller.open(plan);await s.controller.open(other);assert.equal(s.calls[0][1].signal.aborted,true);first(response());await pending;await s.elements.get('gpsTransferShare').onclick();assert.equal(sent.files[0].name,'Retour des Fagnes.gpx');assert.equal(s.elements.get('gpsTransferName').textContent,other.name);assert.equal(s.elements.get('gpsTransferDownload').href,`/api/plans/${other.id}/gpx`);
});
test('fermeture pendant préparation : pas de réactivation tardive ni de partage du fichier précédent',async()=>{
 let release,shared=0;const s=setup({navigator:{canShare:()=>true,share:async()=>{shared++;}},fetcher:async()=>new Promise(r=>release=r)}),pending=s.controller.open(plan);s.elements.get('gpsTransferClose').onclick();assert.equal(s.calls[0][1].signal.aborted,true);release(response());await pending;await s.elements.get('gpsTransferShare').onclick();assert.equal(s.dialog.open,false);assert.equal(s.elements.get('gpsTransferShare').disabled,true);assert.equal(shared,0);
});
test('itinéraire enregistré obligatoire, nom compatible et boîte accessible dans la carte en plein écran',async()=>{
 const s=setup();for(const p of [null,{name:'Non enregistré'},{id:'../../private',name:'x'}])await assert.rejects(s.controller.open(p),/Enregistrez/);assert.equal(s.calls.length,0);assert.equal(s.dialog.open,false);
 assert.equal(gpsFilename('  /Bois:\\crêtes\n  '),'_Bois__crêtes_.gpx');assert.equal(gpsFilename('  '),'Itinéraire.gpx');
 let parent;s.document.fullscreenElement={append:node=>parent=node};await s.controller.open(plan);assert.equal(parent,s.dialog);
});
