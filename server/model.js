import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export const surfaces=['Gravier fin','Chemin de terre','Cailloux / pierres','Grosses pierres / blocs','Sable','Asphalte','Mixte'];
export const difficulties=['Facile','Intermédiaire','Technique','Très technique'];
export const winters=['unknown','yes','no','conditions'];
export function coordinates(value) {
  if(!Array.isArray(value)||value.length<2||value.length>100000||!value.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180)) throw Error('Coordonnées invalides (2 à 100 000 points).');
  return value;
}
export function distance(a,b){const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r,h=Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2;return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
export const routeLength=p=>p.slice(1).reduce((s,x,i)=>s+distance(p[i],x),0);
const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
export function portion(body){
  const points=coordinates(body.coordinates);
  if(!Number.isInteger(body.rating)||body.rating<1||body.rating>5)throw Error('Choisissez une note de 1 à 5.');
  if(!surfaces.includes(body.surface)||!difficulties.includes(body.difficulty)||!winters.includes(body.winter??'unknown')||!['unknown','yes','no'].includes(body.singleTrack??'unknown'))throw Error('Attributs invalides.');
  const meters=routeLength(points);let routePoints,legs;
  if(body.mode==='route'){routePoints=coordinates(body.routePoints??[points[0],points.at(-1)]);if(routePoints.length>200)throw Error('Routage limité à 200 points.');}
  if(body.legs!==undefined&&body.legs!==null){
    if(body.mode!=='route'||!Array.isArray(body.legs)||body.legs.length<1||body.legs.length>199)throw Error('Portions de tracé invalides.');
    legs=body.legs.map(l=>{if(!l||!['route','manual'].includes(l.mode))throw Error('Mode de portion invalide.');return {mode:l.mode,coordinates:coordinates(l.coordinates)};});
    if(legs.reduce((n,l)=>n+l.coordinates.length,0)>100200)throw Error('Tracé trop détaillé.');
    for(let i=1;i<legs.length;i++)if(JSON.stringify(legs[i-1].coordinates.at(-1))!==JSON.stringify(legs[i].coordinates[0]))throw Error('Les portions doivent se rejoindre.');
    const combined=legs.flatMap((l,i)=>i?l.coordinates.slice(1):l.coordinates);if(JSON.stringify(combined)!==JSON.stringify(points))throw Error('Les portions ne correspondent pas au tracé.');
    routePoints=[legs[0].coordinates[0],...legs.map(l=>l.coordinates.at(-1))];
  }
  return {legs,name:text(body.name,100)||`Portion de ${(meters/1000).toFixed(2).replace('.',',')} km`,rating:body.rating,surface:body.surface,difficulty:body.difficulty,winter:body.winter??'unknown',singleTrack:body.singleTrack??'unknown',notes:text(body.notes,2000),source:text(body.source,200),coordinates:points,routePoints,snapped:body.snapped===true,mode:['manual','route','snap'].includes(body.mode)?body.mode:'gps',distance:meters};
}
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `${salt}:${key.toString('hex')}`;}
export async function verifyPassword(password,stored){const[salt,hash]=stored.split(':');const key=await scrypt(password,salt,64);const expected=Buffer.from(hash,'hex');return key.length===expected.length&&timingSafeEqual(key,expected);}
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
