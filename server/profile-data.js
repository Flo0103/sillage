export function elevationData(e,length){
 const finite=v=>Number.isFinite(v)&&v>=0;
 let elevation=null;if(e){if(!finite(e.ascent)||!finite(e.descent)||e.ascent>100000||e.descent>100000||!Array.isArray(e.profile)||e.profile.length<2||e.profile.length>401||!e.profile.every((p,i)=>finite(p.at)&&p.at<=length+10&&Number.isFinite(p.altitude)&&p.altitude>=-500&&p.altitude<=9000&&(!i||p.at>e.profile[i-1].at)))throw Error('Altitudes invalides.');elevation={ascent:e.ascent,descent:e.descent,profile:e.profile.map(p=>({at:p.at,altitude:p.altitude})),spacing:Number.isFinite(e.spacing)?e.spacing:0,source:'Open-Meteo · Copernicus DEM GLO-90'};}
 return elevation;
}
