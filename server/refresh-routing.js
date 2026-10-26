import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pool} from './db.js';
import {refreshRoutingNetworks} from './routing-refresh.js';
const shutdown=new AbortController();let child=null,killTimer=null;
const stop=()=>{if(shutdown.signal.aborted)return;shutdown.abort(Error('Mise à jour interrompue.'));if(child){child.kill('SIGTERM');killTimer=setTimeout(()=>child?.kill('SIGKILL'),5000);killTimer.unref();}};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
try{
 const result=await refreshRoutingNetworks({
  signal:shutdown.signal,
  listDatasets:async()=>{const q=await pool.query('SELECT DISTINCT dataset FROM routing_networks WHERE active=true ORDER BY dataset');return q.rows.map(r=>r.dataset);},
  refreshDataset:async dataset=>{
   shutdown.signal.throwIfAborted();child=spawn(process.execPath,['server/import-routing.js','--refresh'],{stdio:'inherit',env:{...process.env,ROUTING_REGION:dataset}});
   try{const [code,signal]=await once(child,'close');if(code!==0||signal)throw Error(signal?`Import interrompu par ${signal}.`:`Import échoué (code ${code}).`);}
   finally{clearTimeout(killTimer);killTimer=null;child=null;}
  },
  onEvent:event=>console.log(JSON.stringify({event:'routing-refresh',at:new Date().toISOString(),...event}))
 });
 console.log(JSON.stringify({event:'routing-refresh-summary',...result}));if(result.failed.length)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{clearTimeout(killTimer);process.off('SIGTERM',stop);process.off('SIGINT',stop);await pool.end();}
