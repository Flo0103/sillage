// Match the server's two-work-request allowance. Read-only calculations keep
// their slot until the response arrives, even after their UI observer cancels:
// aborting fetch does not stop the shared OSM work running on the server.
const paths=new Set(['/api/route','/api/route/nearest','/api/plan-metrics','/api/plan-elevations','/api/osm']);
const foreground=path=>path==='/api/route'||path==='/api/route/nearest';
const aborted=()=>Object.assign(Error('Calcul annulé.'),{name:'AbortError'});
export const isRoutingRequest=path=>paths.has(path);
export function createRoutingRequests(send,{onChange=()=>{}}={}){
 const queue=[],running=new Set(),anchors=new Map();let background=0;
 function notify(job,error,result){if(job.key&&anchors.get(job.key)===job)anchors.delete(job.key);for(const subscriber of [...job.subscribers]){subscriber.clean();error?subscriber.reject(error):subscriber.resolve(result);}job.subscribers.clear();}
 function pump(){
  while(running.size<2){
   let index=queue.findIndex(job=>job.subscribers.size&&foreground(job.path));
   if(index<0&&background<1)index=queue.findIndex(job=>job.subscribers.size);
   if(index<0)break;
   const job=queue.splice(index,1)[0];job.started=true;running.add(job);if(!foreground(job.path))background++;
   let promise;try{promise=send(job.path,job.data,{...job.options,signal:new AbortController().signal});}catch(error){promise=Promise.reject(error);}
   Promise.resolve(promise).then(result=>notify(job,null,result),error=>notify(job,error)).finally(()=>{running.delete(job);if(!foreground(job.path))background--;pump();});
  }
  onChange();
 }
 function request(path,data,options={}){
  if(!paths.has(path))throw Error('Cette file est réservée aux calculs cartographiques en lecture seule.');
  const {signal,...settings}=options;if(signal?.aborted)return Promise.reject(aborted());
  const key=path==='/api/route/nearest'?JSON.stringify([data.point,data.tolerance??150,data.allowRestricted===true,data.accessMode||null]):null;
  let job=key&&anchors.get(key);if(!job){job={path,data,options:settings,key,started:false,subscribers:new Set()};queue.push(job);if(key)anchors.set(key,job);}
  const result=new Promise((resolve,reject)=>{
   const cancel=()=>{subscriber.clean();job.subscribers.delete(subscriber);reject(aborted());if(!job.started&&!job.subscribers.size){const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);if(key&&anchors.get(key)===job)anchors.delete(key);}pump();};
   const subscriber={resolve,reject,clean:()=>signal?.removeEventListener('abort',cancel)};job.subscribers.add(subscriber);signal?.addEventListener('abort',cancel,{once:true});
  });pump();return result;
 }
 return {request,get stats(){const jobs=[...running,...queue];return {active:running.size,queued:queue.length,nearest:jobs.filter(job=>job.path==='/api/route/nearest'&&job.subscribers.size).length,route:jobs.filter(job=>job.path==='/api/route'&&job.subscribers.size).length};}};
}
