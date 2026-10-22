import pg from 'pg';
export const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'sillage',password:process.env.PGPASSWORD,database:process.env.PGDATABASE||'sillage',max:10});
export async function migrate(){
await pool.query(`
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rides(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, coordinates jsonb NOT NULL, distance double precision NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE rides ADD COLUMN IF NOT EXISTS gpx_xml text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS file_name text;
CREATE INDEX IF NOT EXISTS rides_owner ON rides(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS portions(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, legacy_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,legacy_id));
ALTER TABLE portions ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE portions ALTER COLUMN is_public SET DEFAULT true;
CREATE INDEX IF NOT EXISTS portions_public ON portions(is_public);
CREATE INDEX IF NOT EXISTS portions_owner ON portions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS invitations(id uuid PRIMARY KEY,token_hash text UNIQUE NOT NULL,username text NOT NULL,user_id uuid REFERENCES users(id) ON DELETE CASCADE,created_by uuid REFERENCES users(id) ON DELETE SET NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),used_at timestamptz,revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS wms_layers(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,config jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_limits(key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
`);
}
