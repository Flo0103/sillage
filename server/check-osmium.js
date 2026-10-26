// Build-time smoke test. Uses the actual Osmium binary, high OSM ids and a
// disposable disk index; no network, database or member data is involved.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {startOsmiumReader} from './osmium-reader.js';
import {parseRoutingWay} from './routing-import.js';
import {routeOnOSM} from './local-routing.js';
const directory=await mkdtemp(tmpdir()+'/sillage-osmium-check-');let reader;
try{
 const id=12000000001,points=[[50,5],[50.001,5],[50.002,5],[50.0010001,5],[50.002,5.002]],nodes=points.map(([lat,lon],i)=>`<node id="${id+i}" version="1" lat="${lat}" lon="${lon}"/>`).join('');
 const way=(n,refs,tags)=>`<way id="${n}" version="1">${refs.map(i=>`<nd ref="${id+i}"/>`).join('')}${Object.entries(tags).map(([k,v])=>`<tag k="${k}" v="${v}"/>`).join('')}</way>`;
 const xml=`<osm version="0.6">${nodes}${way(1,[0,1],{building:'yes'})}${way(2,[0,1],{highway:'residential',surface:'asphalt',oneway:'yes'})}${way(3,[1,2],{highway:'track',surface:'gravel',access:'private'})}${way(4,[3,4],{highway:'track',surface:'ground'})}</osm>`;
 const input=directory+'/sample.osm',indexPath=directory+'/nodes.idx';await writeFile(input,xml);reader=await startOsmiumReader({input,indexPath});const ways=[];
 for await(const line of createInterface({input:reader.stream,crlfDelay:Infinity})){const data=parseRoutingWay(line);if(data)ways.push(data);}await reader.completed;
 assert.equal(ways.length,3);assert.deepEqual(ways[0].nodes,[id,id+1]);assert.equal(ways[1].nodes[0],ways[0].nodes.at(-1));
 const result=routeOnOSM([points[0],points[2]],ways);assert.deepEqual(result.coordinates,points.slice(0,3));assert.equal(result.analysis.surfaceRuns[1].unpaved,true);assert.equal(result.analysis.accessRuns.length,1);
 assert.throws(()=>routeOnOSM([points[2],points[0]],ways),e=>e.localNoPath);assert.throws(()=>routeOnOSM([points[0],points[4]],ways),e=>e.localNoPath);
 console.log('OSMIUM_CHECK_OK : index disque, identifiants élevés, géométries, revêtements, accès et sens unique.');
}finally{await reader?.stop();await rm(directory,{recursive:true,force:true});}
