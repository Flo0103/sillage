import {pool,migrate} from './db.js';
const username=(process.argv[2]||'').trim().toLowerCase();
try{if(!username)throw Error('Usage : node server/admin.js identifiant-existant');await migrate();const q=await pool.query('UPDATE users SET is_admin=true,active=true WHERE username=$1 RETURNING username',[username]);if(!q.rowCount)throw Error('Compte introuvable. Créez-le avec server/users.js avant de le promouvoir.');console.log('Droits administrateur accordés à '+q.rows[0].username);}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}
