import pg from 'pg';
export const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'sillage',password:process.env.PGPASSWORD,database:process.env.PGDATABASE||'sillage',max:10});
export async function migrate(){
await pool.query(`
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rides(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, coordinates jsonb NOT NULL, distance double precision NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS rides_owner ON rides(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS portions(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, legacy_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,legacy_id));
CREATE INDEX IF NOT EXISTS portions_owner ON portions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS login_limits(key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
`);
}
