// Mesure CPU manuelle, sans réseau ni seuil de temps dépendant de la machine.
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {routeOnOSM} from '../server/local-routing.js';
import {osmMapWays} from '../server/osm.js';
import {planSummary} from '../dist/planner.js';
import {buildElevationModel} from '../dist/elevation.js';
if(process.argv[2]==='--summary'){
 const legs=Array.from({length:30},(_,j)=>{const coordinates=Array.from({length:2000},(_,i)=>[50+(j*1999+i)*.000001,5]);return {coordinates,analysis:{surfaceRuns:[{coordinates,unpaved:true}],surfaces:[{type:'Gravier',distance:222.3}]}};});
 let start=performance.now();planSummary(legs);const cold=performance.now()-start,times=[];for(let i=0;i<60;i++){start=performance.now();planSummary(legs);times.push(performance.now()-start);}times.sort((a,b)=>a-b);console.log(JSON.stringify({points:60000,coldMs:cold,warmMedianMs:times[30],warmP95Ms:times[57],note:'Synthèse du relief et des surfaces, hors affichage et réseau.'},null,2));process.exit(0);
}
if(process.argv[2]==='--profile'){
 const legs=Array.from({length:30},(_,j)=>({coordinates:Array.from({length:2000},(_,i)=>[50+(j*1999+i)*.000001,5])}));const times=[];for(let i=0;i<40;i++){legs[0].analysis={elevation:{profile:[{at:0,altitude:100},{at:200,altitude:120+i}]}};const start=performance.now();buildElevationModel(legs);times.push(performance.now()-start);}const sorted=times.slice(1).sort((a,b)=>a-b);console.log(JSON.stringify({points:60000,firstMs:times[0],warmMedianMs:sorted[Math.floor(sorted.length/2)],warmP95Ms:sorted[Math.floor(sorted.length*.95)],note:'Mise à jour du profil sans changement de géométrie ; calcul seul.'},null,2));process.exit(0);
}
let elements,queries,label;
if(process.argv[2]){
 const data=JSON.parse(await readFile(process.argv[2],'utf8'));elements=data.elements.some(e=>e.type==='node')?osmMapWays(data):data.elements;label='Données Spa';queries=Array.from({length:80},(_,i)=>[[50.4927+i*.000002,5.8696],[50.4968+i*.000002,5.8707]]);
}else{
 const rows=140,columns=100;elements=[];label='Grille de 14 000 nœuds';
 for(let row=0;row<rows;row++)elements.push({id:row,nodes:Array.from({length:columns},(_,col)=>row*columns+col),geometry:Array.from({length:columns},(_,col)=>({lat:50+row*.0002,lon:5+col*.0003})),tags:{highway:'residential',surface:'asphalt'}});
 for(let col=0;col<columns;col++)elements.push({id:rows+col,nodes:Array.from({length:rows},(_,row)=>row*columns+col),geometry:Array.from({length:rows},(_,row)=>({lat:50+row*.0002,lon:5+col*.0003})),tags:{highway:'residential',surface:'asphalt'}});
 queries=Array.from({length:80},(_,i)=>[[50+(10+i)*.0002,5+10*.0003],[50+(12+i)*.0002,5+30*.0003]]);
}
const times=[];for(const points of queries){const start=performance.now();routeOnOSM(points,elements,{accessMode:'warn'});times.push(performance.now()-start);}
const sorted=times.slice(1).sort((a,b)=>a-b);console.log(JSON.stringify({label,routes:queries.length,coldMs:times[0],warmMedianMs:sorted[Math.floor(sorted.length/2)],warmP95Ms:sorted[Math.floor(sorted.length*.95)],note:'Calcul local seul, hors HTTP et téléchargements ; accès restreints autorisés pour la comparaison historique. Les 80 couples sont différents.'},null,2));
