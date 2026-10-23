import {routeOSM,matchOSMDetailed} from './geo.js?v=6.9.0';
self.onmessage=({data})=>{
 try{const calculate=data.mode==='route'?routeOSM:matchOSMDetailed;const result=calculate(data.points,data.elements,{tolerance:data.tolerance,onProgress:progress=>self.postMessage({progress})});self.postMessage({result});}
 catch(error){self.postMessage({error:error.message});}
};
