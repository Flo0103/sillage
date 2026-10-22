// Positions along a route, rather than distance to its endpoints: handles winding roads.
function projected(point,latitude){return [point[1]*Math.cos(latitude*Math.PI/180),point[0]];}
export function routePosition(path,point,minFraction=0){
 if(path.length<2)return 0;const latitude=point[0],q=projected(point,latitude),segments=[];let total=0;
 for(let i=1;i<path.length;i++){const a=projected(path[i-1],latitude),b=projected(path[i],latitude),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);segments.push({a,dx,dy,length,start:total});total+=length;}
 if(!total)return 0;let best=Infinity,result=minFraction;
 for(const s of segments){if(s.start+s.length<minFraction*total)continue;const lower=s.length?Math.max(0,(minFraction*total-s.start)/s.length):0,t=s.length?Math.max(lower,Math.min(1,((q[0]-s.a[0])*s.dx+(q[1]-s.a[1])*s.dy)/(s.length*s.length))):0,x=s.a[0]+s.dx*t,y=s.a[1]+s.dy*t,error=(q[0]-x)**2+(q[1]-y)**2;if(error<best){best=error;result=(s.start+s.length*t)/total;}}
 return result;
}
export function insertionIndex(path,controls,point,fractions){
 if(controls.length<2)return 1;
 const valid=Array.isArray(fractions)&&fractions.length===controls.length&&fractions.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=1&&(!i||v>=fractions[i-1]));
 const positions=valid?fractions:[0];if(!valid){for(let i=1;i<controls.length-1;i++)positions.push(routePosition(path,controls[i],positions.at(-1)));positions.push(1);}
 const at=routePosition(path,point);let index=1;while(index<controls.length-1&&at>positions[index])index++;return index;
}
