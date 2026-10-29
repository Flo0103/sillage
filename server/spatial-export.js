import {deflateRawSync} from 'node:zlib';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Both formats use the same features, in WGS 84 longitude/latitude order.
export function exportLayers(data){
 const feature=({coordinates,...properties})=>({type:'Feature',id:properties.id,geometry:{type:'LineString',coordinates:coordinates.map(([lat,lon])=>[lon,lat])},properties});
 const collection=features=>({type:'FeatureCollection',features});
 return {secteurs:data.segments,itineraires:collection(data.itineraries.map(feature)),sorties:collection(data.rides.map(feature))};
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Three standard ZIP entries, compressed with DEFLATE. No external executable.
function geojsonZip(layers){
 const files=[],directory=[];let offset=0;
 for(const [name,collection] of Object.entries(layers)){
  const filename=Buffer.from(name+'.geojson'),data=Buffer.from(JSON.stringify(collection)),compressed=deflateRawSync(data),crc=crc32(data);
  if(data.length>0xffffffff||offset+compressed.length+filename.length+30>0xffffffff)throw Error('Export trop volumineux pour une archive ZIP.');
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  files.push(local,filename,compressed);directory.push(central,filename);offset+=local.length+filename.length+compressed.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(3,8);end.writeUInt16LE(3,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...files,central,end]);
}

function bounds(coordinates){
 const box=[Infinity,-Infinity,Infinity,-Infinity];
 for(const [x,y] of coordinates){box[0]=Math.min(box[0],x);box[1]=Math.max(box[1],x);box[2]=Math.min(box[2],y);box[3]=Math.max(box[3],y);}
 return box;
}

// GeoPackageBinary header (XY envelope) followed by a little-endian WKB LineString.
function geometry(coordinates){
 const bytes=Buffer.alloc(49+coordinates.length*16);bytes.write('GP');bytes[3]=3;bytes.writeInt32LE(4326,4);
 bounds(coordinates).forEach((n,i)=>bytes.writeDoubleLE(n,8+i*8));bytes[40]=1;bytes.writeUInt32LE(2,41);bytes.writeUInt32LE(coordinates.length,45);
 coordinates.forEach(([x,y],i)=>{bytes.writeDoubleLE(x,49+i*16);bytes.writeDoubleLE(y,57+i*16);});return bytes;
}

const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const sqlValue=value=>value==null?null:typeof value==='boolean'?Number(value):value instanceof Date?value.toISOString():typeof value==='object'?JSON.stringify(value):value;

async function geopackage(layers,exportedAt){
 const {DatabaseSync}=await import('node:sqlite'),directory=await mkdtemp(join(tmpdir(),'sillage-export-')),path=join(directory,'donnees.gpkg');let db;
 try{
  db=new DatabaseSync(path);db.exec(`
   PRAGMA application_id=1196444487;
   PRAGMA user_version=10300;
   PRAGMA foreign_keys=ON;
   CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL,srs_id INTEGER NOT NULL PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT);
   INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Cartesian SRS',-1,'NONE',-1,'undefined',NULL),('Undefined geographic SRS',0,'NONE',0,'undefined',NULL),('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]','Longitude/latitude');
   CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT '',last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER,FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
   CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,PRIMARY KEY (table_name,column_name),UNIQUE (table_name),FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
   BEGIN;
  `);
  for(const [name,{features}] of Object.entries(layers)){
   const columns=new Map([['id','TEXT'],['name','TEXT']]);
   for(const {properties} of features)for(const [key,value] of Object.entries(properties)){
    if(!columns.has(key)||columns.get(key)===null)columns.set(key,value==null?null:typeof value==='number'?'REAL':typeof value==='boolean'?'BOOLEAN':'TEXT');
   }
   const keys=[...columns.keys()],table=identifier(name);
   db.exec(`CREATE TABLE ${table} (fid INTEGER PRIMARY KEY AUTOINCREMENT,geom LINESTRING,${keys.map(key=>identifier(key)+' '+(columns.get(key)||'TEXT')).join(',')})`);
   const extent=features.length?bounds(features.flatMap(f=>f.geometry.coordinates)):null;
   db.prepare('INSERT INTO gpkg_contents(table_name,data_type,identifier,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,\'features\',?,?,?,?,?,?,4326)').run(name,name,exportedAt,extent?.[0]??null,extent?.[2]??null,extent?.[1]??null,extent?.[3]??null);
   db.prepare('INSERT INTO gpkg_geometry_columns VALUES (?,\'geom\',\'LINESTRING\',4326,0,0)').run(name);
   const insert=db.prepare(`INSERT INTO ${table} (geom,${keys.map(identifier).join(',')}) VALUES (${Array(keys.length+1).fill('?').join(',')})`);
   for(const feature of features)insert.run(geometry(feature.geometry.coordinates),...keys.map(key=>sqlValue(feature.properties[key])));
  }
  db.exec('COMMIT');db.close();db=null;return await readFile(path);
 }finally{try{db?.close();}finally{await rm(directory,{recursive:true,force:true});}}
}

export async function spatialExport(data,format){
 const layers=exportLayers(data);
 if(format==='geojson')return {body:geojsonZip(layers),extension:'zip',contentType:'application/zip'};
 if(format==='gpkg')return {body:await geopackage(layers,data.exportedAt),extension:'gpkg',contentType:'application/geopackage+sqlite3'};
 throw Error('Format d’export invalide.');
}
