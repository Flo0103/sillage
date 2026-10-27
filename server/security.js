// Leaflet uses inline styles for map positioning. Scripts and workers stay local;
// public HTTPS map imagery and providers, including user WMS, remain available.
export const contentSecurityPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

// Admission happens before reading bodies or accessing PostgreSQL. These bounds
// are per process; persistent password limits in PostgreSQL survive restarts.
export function createAdmissionController({now=Date.now,maxEntries=4096}={}) {
  const buckets=new Map(),activeByIp=new Map(),workByIp=new Map(),authByIp=new Map(),uploadsByIp=new Map();
  let active=0,work=0,auth=0,uploads=0,lastSweep=0;
  const busy=()=>Object.assign(Error('Trop de requêtes. Réessayez dans quelques instants.'),{status:429,retryAfter:1});
  return {
    enter(path,method,ip) {
      if(!path.startsWith('/api/'))return ()=>{};
      const timestamp=now();
      if(timestamp-lastSweep>=60000||buckets.size>=maxEntries&&timestamp-lastSweep>=1000){
        for(const [key,bucket]of buckets)if(timestamp-bucket.at>=60000)buckets.delete(key);
        lastSweep=timestamp;
      }
      let bucket=buckets.get(ip);
      if(!bucket){if(buckets.size>=maxEntries)throw busy();bucket={tokens:120,at:timestamp};buckets.set(ip,bucket);}
      bucket.tokens=Math.min(120,bucket.tokens+Math.max(0,timestamp-bucket.at)/500);bucket.at=timestamp;
      if(bucket.tokens<1)throw busy();bucket.tokens--;
      const expensive=method==='POST'&&['/api/route','/api/route/nearest','/api/plan-metrics','/api/plan-elevations','/api/osm'].includes(path);
      const password=method==='POST'&&['/api/login','/api/accept-invitation','/api/account/password'].includes(path);
      const upload=method==='POST'&&path==='/api/rides';
      if(active>=64||(activeByIp.get(ip)||0)>=16||expensive&&(work>=4||(workByIp.get(ip)||0)>=2)||password&&(auth>=4||(authByIp.get(ip)||0)>=1)||upload&&(uploads>=2||(uploadsByIp.get(ip)||0)>=1))throw busy();
      const increment=map=>map.set(ip,(map.get(ip)||0)+1),decrement=map=>{const next=map.get(ip)-1;if(next)map.set(ip,next);else map.delete(ip);};
      active++;increment(activeByIp);
      if(expensive){work++;increment(workByIp);}
      if(password){auth++;increment(authByIp);}
      if(upload){uploads++;increment(uploadsByIp);}
      let released=false;
      return ()=>{if(released)return;released=true;active--;decrement(activeByIp);if(expensive){work--;decrement(workByIp);}if(password){auth--;decrement(authByIp);}if(upload){uploads--;decrement(uploadsByIp);}};
    }
  };
}
