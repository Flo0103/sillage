import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOnboarding} from '../dist/onboarding.js';

function setup({blocked=false,native=true,prepare=()=>{},width=390,height=720}={}){
 const names=['introTour','introTourSpotlight','introTourCard','introTourTitle','introTourText','introTourStep','introTourProgress','introTourPrevious','introTourNext','introTourSkip','mapCanvas','appSidebar','mapTools','segmentLegend'],elements=new Map(),values=new Map(),listeners=new Set(),calls=[];
 let focusRestored=0,restored=0;
 for(const name of names)elements.set(name,{style:{},hidden:false,disabled:false,textContent:'',scrollIntoView(){calls.push(name);},focus(){},getBoundingClientRect(){return name==='introTourCard'?{width:350,height:300}:{left:10,top:70,right:width-10,bottom:height-80,width:width-20,height:height-150};}});
 const dialog=elements.get('introTour');dialog.open=false;if(native)dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.onclose?.();};
 const document={getElementById:id=>elements.get(id),querySelector:()=>null,activeElement:{focus(){focusRestored++;}}};
 const storage={getItem(key){if(blocked)throw Error('disabled');return values.get(key)||null;},setItem(key,value){if(blocked)throw Error('disabled');values.set(key,value);}};
 const viewport={innerWidth:width,innerHeight:height,addEventListener(name){listeners.add(name);},removeEventListener(name){listeners.delete(name);}};
 const tour=createOnboarding({document,viewport,storage:()=>storage,prepare,restore(){restored++;}});
 return {tour,elements,values,listeners,calls,dialog,get restored(){return restored;},get focusRestored(){return focusRestored;}};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('première visite par compte : six étapes, retour possible, fin mémorisée et focus restauré',async()=>{
 const h=setup();assert.equal(h.tour.maybeStart('alice'),true);await tick();assert.match(h.elements.get('introTourTitle').textContent,/atlas gravel/);assert.equal(h.elements.get('introTourPrevious').disabled,true);
 for(let i=0;i<3;i++){h.elements.get('introTourNext').onclick();await tick();}
 assert.match(h.elements.get('introTourTitle').textContent,/Un clic/);h.elements.get('introTourPrevious').onclick();await tick();assert.match(h.elements.get('introTourTitle').textContent,/Deux outils/);
 for(let i=0;i<3;i++){h.elements.get('introTourNext').onclick();await tick();}
 assert.equal(h.elements.get('introTourNext').textContent,'C’est parti');assert.equal(h.elements.get('introTourProgress').value,6);h.elements.get('introTourNext').onclick();assert.equal(h.dialog.open,false);assert.equal(h.restored,1);assert.equal(h.focusRestored,1);assert.equal(h.listeners.size,0);assert.equal(h.values.get('sillage:introduction:v1:alice'),'seen');assert.equal(h.tour.maybeStart('alice'),false);assert.equal(h.tour.maybeStart('bob'),true);
});
test('passer et Échap ferment la visite, sans la redemander au prochain chargement',async()=>{
 for(const escape of [false,true]){const h=setup();h.tour.maybeStart('alice');await tick();if(escape){h.dialog.oncancel();h.dialog.close();}else h.elements.get('introTourSkip').onclick();assert.equal(h.dialog.open,false);assert.equal(h.restored,1);assert.equal(h.values.get('sillage:introduction:v1:alice'),'seen');assert.equal(h.tour.maybeStart('alice'),false);assert.equal(h.tour.start('alice'),true);h.tour.close();}
});
test('stockage bloqué : visite utilisable et pas de répétition dans la même session de page',async()=>{
 const h=setup({blocked:true});assert.equal(h.tour.maybeStart('alice'),true);await tick();h.tour.close();assert.equal(h.tour.maybeStart('alice'),false);assert.equal(h.tour.start('alice'),true);h.tour.close();assert.equal(h.restored,2);
});
test('compte déjà initié et absence de dialog natif : pas d’ouverture automatique ni de préférence écrite',()=>{
 const h=setup();h.values.set('sillage:introduction:v1:alice','seen');assert.equal(h.tour.maybeStart('alice'),false);assert.equal(h.restored,0);const unavailable=setup({native:false});assert.equal(unavailable.tour.maybeStart('alice'),false);assert.equal(unavailable.values.size,0);
});
test('navigation rapide : une préparation ancienne ne déplace pas le focus visuel de l’étape courante',async()=>{
 const pending=[],h=setup({prepare:step=>new Promise(resolve=>pending.push({step,resolve}))});h.tour.start('alice');h.elements.get('introTourNext').onclick();h.elements.get('introTourNext').onclick();assert.equal(pending.length,3);pending[2].resolve();await tick();assert.deepEqual(h.calls,['mapTools']);pending[0].resolve();pending[1].resolve();await tick();assert.deepEqual(h.calls,['mapTools']);assert.match(h.elements.get('introTourTitle').textContent,/Deux outils/);h.tour.close();
});
test('petit écran et changement de taille : carte de visite contenue dans le viewport, cible hors écran ignorée',async()=>{
 const h=setup({width:320,height:360});h.elements.get('mapCanvas').getBoundingClientRect=()=>({left:-50,top:-500,right:350,bottom:-100,width:400,height:400});h.tour.start('alice');await tick();const box=h.dialog.style;assert.ok(Number.parseFloat(box.left)>=14);assert.ok(Number.parseFloat(box.top)>=14);assert.ok(Number.parseFloat(box.left)+Number.parseFloat(box.width)<=306);assert.equal(h.elements.get('introTourSpotlight').hidden,true);h.tour.close();assert.equal(h.listeners.size,0);
});
test('fermeture pendant une préparation : aucun défilement ni affichage tardif',async()=>{
 let done;const h=setup({prepare:()=>new Promise(resolve=>done=resolve)});h.tour.start('alice');h.tour.close();done();await tick();assert.equal(h.calls.length,0);assert.equal(h.elements.get('introTourSpotlight').hidden,true);assert.equal(h.restored,1);
});
test('un lancement concurrent ne change pas le compte auquel sera attachée la préférence',()=>{
 const h=setup();h.tour.start('alice');assert.equal(h.tour.maybeStart('bob'),false);h.tour.close();assert.equal(h.values.has('sillage:introduction:v1:alice'),true);assert.equal(h.values.has('sillage:introduction:v1:bob'),false);
});

test('événement close différé : ne ferme pas une visite relancée entre-temps',async()=>{
 const h=setup();h.dialog.close=()=>{h.dialog.open=false;};h.tour.start('alice');await tick();h.tour.close();assert.equal(h.restored,1);h.tour.start('alice');h.dialog.onclose();assert.equal(h.dialog.open,true);assert.equal(h.restored,1);h.elements.get('introTourNext').onclick();await tick();assert.match(h.elements.get('introTourTitle').textContent,/bibliothèque/);h.tour.close();
});
