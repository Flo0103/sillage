// Diagnostic en lecture seule, sans accès aux comptes. --online ne lit pas la base.
import {readFile} from 'node:fs/promises';
import {pool} from './db.js';
import {createRuntimeRouting} from './routing-runtime.js';
import {routeLength,coordinates} from './model.js';
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const argv=process.argv.slice(2),online=argv.includes('--online'),custom=argv.includes('--from')||argv.includes('--to');
function point(flag,fallback){const i=argv.indexOf(flag);if(i<0){if(custom)throw Error('Indiquez --from et --to, chacun au format latitude,longitude.');return fallback;}const value=String(argv[i+1]||'').split(',').map(Number);return coordinates([value,value])[0];}
if(online&&argv.includes('--require-local'))throw Error('--online et --require-local sont incompatibles.');
const start=point('--from',[50.4918849,5.8693681]),finish=point('--to',[50.4976469,5.870257]),via=[50.4959481,5.8711952];
const fetcher=async(url,options)=>{const began=Date.now(),host=new URL(url).hostname;try{const response=await fetch(url,options);console.log(JSON.stringify({upstream:host,status:response.status,milliseconds:Date.now()-began}));return response;}catch(e){console.log(JSON.stringify({upstream:host,error:e.cause?.code||e.name,milliseconds:Date.now()-began}));throw e;}};
const {routingService:route}=createRuntimeRouting(online?{query:async()=>({rows:[]})}:pool,{fetcher});
console.log(`Sillage ${version} · ${custom?'Points personnalisés':'Rue du Jeu de Paume à Spa'}${online?' · données en ligne, sans base':''}`);
const networkStatus=await route.status();console.log(JSON.stringify(networkStatus,null,2));
if(process.argv.includes('--require-local')&&networkStatus.mode!=='stored'){await pool.end();throw Error('Aucun réseau local actif : exécutez d’abord l’import routing-import.');}
const nearestBegan=Date.now();
try{const nearest=await route.nearest({point:start,allowRestricted:true,tolerance:150});console.log(JSON.stringify({test:'Accrochage initial',milliseconds:Date.now()-nearestBegan,...nearest},null,2));start.splice(0,2,...nearest.point);}catch(e){console.error(`Accrochage initial : ${e.message}`);process.exitCode=1;}
const cases=[['Aller',[start,finish]],['Retour',[finish,start]],...(custom?[]:[['Rue entière avec passage gravel',[start,via,finish]]])];
for(const [label,points]of cases){
 const began=Date.now();try{const result=await route({points,purpose:'itinerary',allowRestricted:true,tolerance:150});
  console.log(JSON.stringify({test:label,engine:result.engine,source:result.osmSource||'Moteur vélo public',distance:Math.round(routeLength(result.coordinates)),milliseconds:Date.now()-began,timings:result.timings,surfaces:result.analysis?.surfaces,restrictedPortions:result.analysis?.accessRuns.length,warning:result.warning||null},null,2));
  if(result.warning)process.exitCode=1;
  if(process.argv.includes('--require-local')&&!result.timings?.offline)process.exitCode=1;
 }catch(e){console.error(`${label} : ${e.message}`);process.exitCode=1;}
}
await pool.end();
