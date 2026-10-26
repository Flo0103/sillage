import {createOSMService} from './osm.js';
import {createStoredOSM} from './stored-osm.js';
import {createLocalRouting} from './local-routing.js';
import {createRoutingService} from './routing.js';
export function createRuntimeRouting(db,{fetcher}={}){
 const remote=createOSMService({mapFallback:true,fetcher}),osmService=createStoredOSM({db,remote}),routingService=createRoutingService({localRouting:createLocalRouting({osmService}),fetcher});
 return {osmService,routingService};
}
