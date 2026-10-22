import { randomUUID } from 'node:crypto';
import { stdin,stdout } from 'node:process';
import { pool,migrate } from './db.js';
import { hashPassword } from './model.js';
const username=(process.argv[2]||'').trim().toLowerCase();
if(!/^[a-z0-9_.-]{3,80}$/.test(username)){console.error('Usage : node server/users.js identifiant (3–80 caractères : a-z, 0-9, _, ., -).');process.exit(1);}
async function secret(prompt){stdout.write(prompt);if(!stdin.isTTY)throw Error('Utilisez un terminal interactif pour saisir le mot de passe.');stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');return new Promise((resolve,reject)=>{let value='';const handler=chunk=>{for(const c of chunk){if(c==='\u0003'){cleanup();reject(Error('Annulé.'));return;}if(c==='\r'||c==='\n'){cleanup();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};function cleanup(){stdin.off('data',handler);stdin.setRawMode(false);stdin.pause();stdout.write('\n');}stdin.on('data',handler);});}
try{
 const password=await secret('Mot de passe (12 caractères minimum, saisie masquée) : ');
 const confirm=await secret('Confirmer : ');if(password!==confirm||password.length<12||password.length>256)throw Error('Mots de passe différents ou longueur invalide (12–256).');
 await migrate();const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id',[randomUUID(),username,await hashPassword(password)]);await client.query('DELETE FROM sessions WHERE user_id=$1',[q.rows[0].id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}console.log('Compte créé ou mot de passe renouvelé.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}
