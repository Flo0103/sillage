// Diagnostic public et en lecture seule, sans accès aux comptes ou à la base.
import {readFile} from 'node:fs/promises';
import {createRoutingService} from './routing.js';
import {routeLength} from './model.js';
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const start=[50.4918849,5.8693681],finish=[50.4976469,5.870257],via=[50.4959481,5.8711952],route=createRoutingService();
console.log(`Sillage ${version} · Rue du Jeu de Paume à Spa`);
try{const nearest=await route.nearest({point:start,allowRestricted:true,tolerance:150});console.log(JSON.stringify({test:'Accrochage initial',...nearest},null,2));start.splice(0,2,...nearest.point);}catch(e){console.error(`Accrochage initial : ${e.message}`);process.exitCode=1;}
for(const [label,points]of [['Extrémités, sud → nord',[start,finish]],['Extrémités, nord → sud',[finish,start]],['Rue entière avec passage gravel',[start,via,finish]]]){
 const began=Date.now();try{const result=await route({points,purpose:'itinerary',allowRestricted:true,tolerance:150});
  console.log(JSON.stringify({test:label,engine:result.engine,source:result.osmSource||'Moteur vélo public',distance:Math.round(routeLength(result.coordinates)),milliseconds:Date.now()-began,surfaces:result.analysis?.surfaces,restrictedPortions:result.analysis?.accessRuns.length,warning:result.warning||null},null,2));
  if(result.warning)process.exitCode=1;
 }catch(e){console.error(`${label} : ${e.message}`);process.exitCode=1;}
}
