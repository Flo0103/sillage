import {createOSMService} from './osm.js';
import {createStoredOSM} from './stored-osm.js';
import {createLocalRouting} from './local-routing.js';
import {createRoutingService} from './routing.js';
export function createRuntimeRouting(db,{fetcher,now,wait}={}){
 const remote=createOSMService({mapFallback:true,fetcher,now,wait}),osmService=createStoredOSM({db,remote}),routingService=createRoutingService({localRouting:createLocalRouting({osmService}),onlineRouting:createLocalRouting({osmService:remote}),fetcher,now,wait});
 return {osmService,routingService};
}
