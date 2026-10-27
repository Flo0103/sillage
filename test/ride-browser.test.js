import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRideCards,createStravaSearch} from '../dist/ride-browser.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function element(){return {children:[],attributes:{},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},getBoundingClientRect(){return {width:100};}};}
function cardsFixture(){
 const opened=[],removed=[],previews=[],pending=[],observers=[],root=element();
 class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}disconnect(){this.disconnected=true;}}
 const cards=createRideCards({document:{createElement:element},Observer,onOpen:(...args)=>opened.push(args),onDelete:item=>removed.push(item),renderPreview:(root,item,options)=>previews.push({root,item,options}),disposePreviews(){},fetchPreview:(id,signal)=>new Promise(resolve=>pending.push({id,signal,resolve}))});
 return {cards,opened,removed,previews,pending,observers,root};
}
test('cartes de sorties : clic et clavier ouvrent le résultat, actions locales séparées',()=>{
 const f=cardsFixture(),item={id:'a',name:'Fagnes',distance:15000};f.cards.render(f.root,[item]);const [main,actions]=f.root.children[0].children;assert.equal(main.attributes.role,'button');assert.equal(main.attributes['aria-label'],'Afficher Fagnes sur la carte');main.onclick();main.onkeydown({key:'Enter',preventDefault(){}});assert.equal(f.opened.length,2);assert.equal(actions.children[0].href,'/api/rides/a/gpx');actions.children[1].onclick();assert.equal(f.removed[0],item);
 main.onkeydown({key:' ',target:{closest:()=>({})},preventDefault(){assert.fail('lien imbriqué intercepté');}});assert.equal(f.opened.length,2);
});
test('aperçus locaux : seulement les cartes visibles, deux requêtes maximum et aucune réponse périmée affichée',async()=>{
 const f=cardsFixture(),items=Array.from({length:4},(_,i)=>({id:String(i),name:'Sortie '+i}));f.cards.render(f.root,items);assert.equal(f.pending.length,0);const observer=f.observers[0];observer.fn(f.root.children.map(card=>({target:card.children[0],isIntersecting:true})));assert.equal(f.pending.length,2);
 f.pending[0].resolve({coordinates:[[50,5],[50.1,5]]});await tick();assert.equal(f.previews.length,1);assert.equal(f.pending.length,3);f.cards.clear(f.root);assert.equal(observer.disconnected,true);assert.equal(f.pending[1].signal.aborted,true);f.pending[1].resolve({coordinates:[[50,5],[50.1,5]]});f.pending[2].resolve({coordinates:[[50,5],[50.1,5]]});await tick();assert.equal(f.previews.length,1);assert.equal(f.pending.length,3);
});
test('cartes Strava : aperçu disponible immédiatement, pas de sélection de toutes les cartes sans sortie courante',()=>{
 const f=cardsFixture();f.cards.render(f.root,[{id:'s',name:'Gravel',preview:[[50,5],[50.1,5]]}],{remote:true});assert.equal(f.previews.length,1);assert.equal(f.pending.length,0);assert.equal(f.root.children[0].className,'preview-card ride-result');assert.equal(f.root.children[0].children.length,1);f.root.children[0].children[0].onclick();assert.equal(f.opened[0][1],true);
});
function searchFixture({get,post}={}){
 const results=[],states=[],errors=[];let disconnected=0;const complete={cursor:'done',complete:true,needsRefresh:false};
 const search=createStravaSearch({get:get||(async()=>({connected:true,items:[],total:0,status:complete})),post:post||(async()=>complete),onResults:r=>results.push(r),onStatus:(s,ui)=>states.push({s,ui}),onError:e=>errors.push(e),onDisconnected:()=>disconnected++});return {search,results,states,errors,disconnected:()=>disconnected};
}
test('historique progressif indépendant du filtre : une recherche vide continue jusqu’aux anciennes activités',async()=>{
 let page=0;const get=async url=>({connected:true,items:page>=3?[{id:'old'}]:[],total:page>=3?1:0,status:{cursor:String(page),complete:page>=3,needsRefresh:page<3}}),f=searchFixture({get,post:async()=>({cursor:String(++page),complete:page>=3,needsRefresh:page<3})});await f.search.start('q=ancienne');await f.search.idle;assert.equal(page,3);assert.equal(f.results.at(-1).items[0].id,'old');assert.equal(f.errors.length,0);
});
test('changement de requête : réponse tardive ignorée et lecture précédente abandonnée',async()=>{
 let release,signal;const f=searchFixture({get:async(url,options)=>url.endsWith('q=old')?new Promise(r=>{release=r;signal=options.signal;}):{connected:true,items:[{name:'new'}],status:{complete:true}}});const old=f.search.start('q=old');await tick();await f.search.search('q=new');release({connected:true,items:[{name:'old'}],status:{complete:true}});await old;assert.equal(signal.aborted,true);assert.equal(f.results.length,1);assert.equal(f.results[0].items[0].name,'new');
});
test('quota et reprise : pas de boucle automatique, résultats conservés et même travail repris',async()=>{
 let requests=0,done=false;const f=searchFixture({get:async()=>({connected:true,items:[{id:'cached'}],status:{cursor:done?'done':'start',complete:done,needsRefresh:!done}}),post:async()=>{requests++;if(requests===1)throw Error('Quota');done=true;return {cursor:'done',complete:true};}});await f.search.start('');await f.search.idle;assert.equal(requests,1);assert.equal(f.errors.length,1);assert.equal(f.results.at(-1).items[0].id,'cached');await tick();assert.equal(requests,1);await f.search.resume();assert.equal(requests,2);assert.equal(f.states.at(-1).s.complete,true);
});
test('actualisation refusée : le bouton reprendre retente aussi une actualisation du cache complet',async()=>{
 let requests=0;const f=searchFixture({post:async(path,body)=>{assert.equal(body.refresh,true);if(++requests===1)throw Error('Quota');return {cursor:'new',complete:true};}});await f.search.start('');await f.search.refresh();assert.equal(f.errors.length,1);await f.search.resume();assert.equal(requests,2);
});
test('pause, changement de source et déconnexion : aucun autre lot lancé ou résultat tardif appliqué',async()=>{
 let release,requests=0;const f=searchFixture({get:async()=>({connected:true,items:[],status:{cursor:'0',complete:false}}),post:()=>{requests++;return new Promise(r=>release=r);}});await f.search.start('');f.search.pause();release({cursor:'1',complete:false});await f.search.idle;assert.equal(requests,1);assert.equal(f.states.at(-1).ui.paused,true);
 const old=f.results.length;void f.search.resume();await tick();f.search.stop();release({cursor:'2',complete:false});await f.search.idle;assert.equal(f.results.length,old);
 const off=searchFixture({get:async()=>({connected:false})});await off.search.start('');assert.equal(off.disconnected(),1);assert.equal(off.results.length,0);
});
