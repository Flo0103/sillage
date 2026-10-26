// Routing data is independent of members' rides and routes. A replacement is
// loaded under a new revision, then made visible in one transaction.
export const routingStorageSQL=`
CREATE TABLE IF NOT EXISTS routing_networks(
 revision uuid PRIMARY KEY,dataset text NOT NULL,source text NOT NULL,
 active boolean NOT NULL DEFAULT false,way_count integer NOT NULL DEFAULT 0,
 bounds jsonb,imported_at timestamptz NOT NULL DEFAULT now(),retired_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS routing_network_active ON routing_networks(dataset) WHERE active;
CREATE TABLE IF NOT EXISTS routing_ways(
 revision uuid NOT NULL REFERENCES routing_networks(revision) ON DELETE CASCADE,
 osm_id bigint NOT NULL,data jsonb NOT NULL,geom geometry(LineString,4326) NOT NULL,
 PRIMARY KEY(revision,osm_id)
);
CREATE INDEX IF NOT EXISTS routing_ways_geometry ON routing_ways USING gist(geom);
`;
