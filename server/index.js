import { pool,migrate } from './db.js';
import { createApp } from './app.js';
await migrate();
const server=createApp(pool,{origin:process.env.APP_ORIGIN,secure:process.env.COOKIE_SECURE!=='false'});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Sillage écoute sur le port 3000'));
process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
