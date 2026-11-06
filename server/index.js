import { pool,migrate,createServingPool } from './db.js';
import { createApp } from './app.js';
import {createRuntimeRouting} from './routing-runtime.js';
await migrate();
// Migrations may run long; requests then use a pool with statement limits.
await pool.end();
const db=createServingPool();
const routing=createRuntimeRouting(db);
const server=createApp(db,{origin:process.env.APP_ORIGIN,secure:process.env.COOKIE_SECURE!=='false',...routing});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Sillage écoute sur le port 3000'));
process.on('SIGTERM',()=>server.close(async()=>{await db.end();process.exit(0);}));
