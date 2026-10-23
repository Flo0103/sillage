// The same distance-based smoothing is used by the graph, slopes, gain and GPX.
export const smoothingRadius=150;
export function smoothElevation(profile,radius=smoothingRadius){
 if(profile.length<3)return profile.map(p=>({...p}));let left=0,right=0;const n=profile.length,sumH=[0],sumD=[0],sumDH=[0];for(const p of profile){sumH.push(sumH.at(-1)+p.altitude);sumD.push(sumD.at(-1)+p.at);sumDH.push(sumDH.at(-1)+p.at*p.altitude);}
 return profile.map((p,i)=>{if(!i||i===n-1)return {...p};while(left<i&&profile[left].at<p.at-radius)left++;right=Math.max(right,i);while(right+1<n&&profile[right+1].at<=p.at+radius)right++;
  const a=i-left+1,b=right-i,hL=sumH[i+1]-sumH[left],dL=sumD[i+1]-sumD[left],dhL=sumDH[i+1]-sumDH[left],hR=sumH[right+1]-sumH[i+1],dR=sumD[right+1]-sumD[i+1],dhR=sumDH[right+1]-sumDH[i+1],weight=a*(1-p.at/radius)+dL/radius+b*(1+p.at/radius)-dR/radius,value=hL*(1-p.at/radius)+dhL/radius+hR*(1+p.at/radius)-dhR/radius;
  return {at:p.at,altitude:Math.round((weight>0?value/weight:p.altitude)*10)/10};
 });
}
export function elevationGain(profile,threshold=3){let ascent=0,descent=0,anchor=profile[0]?.altitude??0;for(let i=1;i<profile.length;i++){const delta=profile[i].altitude-anchor;if(Math.abs(delta)>=threshold||i===profile.length-1){if(delta>0)ascent+=delta;else descent-=delta;anchor=profile[i].altitude;}}return {ascent:Math.round(ascent),descent:Math.round(descent)};}
