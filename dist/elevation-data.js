// The same distance-based smoothing is used by the graph, slopes, gain and GPX.
export const smoothingRadius=150;
export function smoothElevation(profile,radius=smoothingRadius){
 if(profile.length<3)return profile.map(p=>({...p}));let left=0,right=0;const n=profile.length,sumH=[0],sumD=[0],sumDH=[0];for(const p of profile){sumH.push(sumH.at(-1)+p.altitude);sumD.push(sumD.at(-1)+p.at);sumDH.push(sumDH.at(-1)+p.at*p.altitude);}
 return profile.map((p,i)=>{if(!i||i===n-1)return {...p};while(left<i&&profile[left].at<p.at-radius)left++;right=Math.max(right,i);while(right+1<n&&profile[right+1].at<=p.at+radius)right++;
  const a=i-left+1,b=right-i,hL=sumH[i+1]-sumH[left],dL=sumD[i+1]-sumD[left],dhL=sumDH[i+1]-sumDH[left],hR=sumH[right+1]-sumH[i+1],dR=sumD[right+1]-sumD[i+1],dhR=sumDH[right+1]-sumDH[i+1],weight=a*(1-p.at/radius)+dL/radius+b*(1+p.at/radius)-dR/radius,value=hL*(1-p.at/radius)+dhL/radius+hR*(1+p.at/radius)-dhR/radius;
  return {at:p.at,altitude:Math.round((weight>0?value/weight:p.altitude)*10)/10};
 });
}
// Count a change of direction only after a meaningful reversal, rather than
// repeatedly adding small up/down steps around a moving altitude anchor.
export const gainReversalThreshold=5;
export function elevationGain(profile,threshold=gainReversalThreshold){
 if(profile.length<2)return {ascent:0,descent:0};let ascent=0,descent=0,anchor=profile[0].altitude,extreme=anchor,direction=0;
 for(let i=1;i<profile.length;i++){const altitude=profile[i].altitude;
  if(!direction){const delta=altitude-anchor;if(delta>0){direction=1;extreme=altitude;}else if(delta<0){direction=-1;extreme=altitude;}}
  else if(direction>0){if(altitude>extreme)extreme=altitude;else if(extreme-altitude>=threshold){ascent+=extreme-anchor;anchor=extreme;extreme=altitude;direction=-1;}}
  else if(altitude<extreme)extreme=altitude;else if(altitude-extreme>=threshold){descent+=anchor-extreme;anchor=extreme;extreme=altitude;direction=1;}
 }
 // Use the actual endpoint: an unfinished sub-threshold reversal is ignored,
 // while the net altitude difference is preserved, even on a short ramp.
 const tail=profile.at(-1).altitude-anchor;if(tail>0)ascent+=tail;else descent-=tail;
 return {ascent:Math.round(ascent),descent:Math.round(descent)};
}
