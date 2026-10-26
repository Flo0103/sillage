// Refresh installed regions sequentially. Each import owns its publication
// transaction; failure of one region leaves its previous revision available.
export async function refreshRoutingNetworks({listDatasets,refreshDataset,signal,onEvent=()=>{}}){
 const datasets=[...new Set(await listDatasets())].sort();
 if(!datasets.length)throw Error('Aucun réseau OSM installé. Effectuez d’abord un import initial.');
 if(datasets.some(s=>typeof s!=='string'||!/^[a-z0-9][a-z0-9_/-]{0,79}$/.test(s)||s.includes('..')))throw Error('Nom de région OSM invalide.');
 const updated=[],failed=[];
 for(const dataset of datasets){
  signal?.throwIfAborted();onEvent({dataset,status:'started'});
  try{await refreshDataset(dataset,signal);signal?.throwIfAborted();updated.push(dataset);onEvent({dataset,status:'updated'});}
  catch(e){signal?.throwIfAborted();failed.push({dataset,error:e.message});onEvent({dataset,status:'failed',error:e.message});}
 }
 return {updated,failed};
}
