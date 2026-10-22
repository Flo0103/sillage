export const spatialSQL=`
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE OR REPLACE FUNCTION sillage_line(coords jsonb) RETURNS geometry
LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT ST_SetSRID(ST_MakeLine(array_agg(ST_MakePoint((point->>1)::double precision,(point->>0)::double precision) ORDER BY ordinal)),4326)
 FROM jsonb_array_elements(coords) WITH ORDINALITY AS t(point,ordinal)
$$;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS geom geometry(LineString,4326);
ALTER TABLE planned_routes ADD COLUMN IF NOT EXISTS geom geometry(LineString,4326);
ALTER TABLE portions ADD COLUMN IF NOT EXISTS geom geometry(LineString,4326);
CREATE OR REPLACE FUNCTION sillage_sync_ride() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.geom := sillage_line(NEW.coordinates); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION sillage_sync_portion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.geom := sillage_line(NEW.data->'coordinates'); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS sillage_ride_geom ON rides;
CREATE TRIGGER sillage_ride_geom BEFORE INSERT OR UPDATE OF coordinates ON rides FOR EACH ROW EXECUTE FUNCTION sillage_sync_ride();
DROP TRIGGER IF EXISTS sillage_portion_geom ON portions;
CREATE TRIGGER sillage_portion_geom BEFORE INSERT OR UPDATE OF data ON portions FOR EACH ROW EXECUTE FUNCTION sillage_sync_portion();
DROP TRIGGER IF EXISTS sillage_plan_geom ON planned_routes;
CREATE TRIGGER sillage_plan_geom BEFORE INSERT OR UPDATE OF data ON planned_routes FOR EACH ROW EXECUTE FUNCTION sillage_sync_portion();
UPDATE planned_routes SET geom=sillage_line(data->'coordinates') WHERE geom IS NULL;
ALTER TABLE planned_routes ALTER COLUMN geom SET NOT NULL;
CREATE INDEX IF NOT EXISTS planned_routes_geom_gist ON planned_routes USING gist(geom);
UPDATE rides SET geom=sillage_line(coordinates) WHERE geom IS NULL;
UPDATE portions SET geom=sillage_line(data->'coordinates') WHERE geom IS NULL;
ALTER TABLE rides ALTER COLUMN geom SET NOT NULL;
ALTER TABLE portions ALTER COLUMN geom SET NOT NULL;
CREATE INDEX IF NOT EXISTS rides_geom_gist ON rides USING gist(geom);
CREATE INDEX IF NOT EXISTS portions_geom_gist ON portions USING gist(geom);
`;
export function spatialBounds(text){if(!text)return null;const b=String(text).split(',').map(Number);if(b.length!==4||!b.every(Number.isFinite)||b[0]<-180||b[2]>180||b[1]<-90||b[3]>90||b[0]>=b[2]||b[1]>=b[3])throw Error('Emprise invalide (ouest,sud,est,nord).');return b;}
