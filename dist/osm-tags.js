const surfaces={asphalt:'Asphalte / bitume',bitumen:'Asphalte / bitume',chipseal:'Asphalte / bitume',concrete:'Béton','concrete:lanes':'Béton','concrete:plates':'Béton',fine_gravel:'Gravier fin',gravel:'Gravier',compacted:'Gravier compacté',dirt:'Terre',earth:'Terre',ground:'Terre',mud:'Boue',grass:'Herbe',grass_paver:'Dalles engazonnées',sand:'Sable',rock:'Roches',rocks:'Roches',pebblestone:'Pierres',cobblestone:'Pavés',sett:'Pavés','cobblestone:flattened':'Pavés',unhewn_cobblestone:'Pavés',paving_stones:'Pavés',wood:'Bois',woodchips:'Copeaux de bois',metal:'Métal',unpaved:'Non revêtu',paved:'Revêtu (non précisé)',soil:'Terre',clay:'Terre',laterite:'Terre'};
const solid=new Set(['asphalt','bitumen','chipseal','concrete','concrete:lanes','concrete:plates','paved']);
export function surfaceInfo(tags={}){
 const value=typeof tags.surface==='string'?tags.surface.trim().toLowerCase():'';
 if(value&&surfaces[value])return {type:surfaces[value],unpaved:!solid.has(value),source:'surface'};
 if(value.includes(';')){const parts=value.split(';').map(s=>s.trim());if(parts.every(v=>surfaces[v])){const paved=parts.map(v=>solid.has(v));return {type:paved.every(v=>!v)?'Mixte non revêtu':'Mixte',unpaved:paved.every(v=>!v)?true:paved.every(Boolean)?false:null,source:'surface'};}}
 if(/^grade[2-5]$/.test(tags.tracktype||''))return {type:'Non revêtu (tracktype)',unpaved:true,source:'tracktype'};
 return {type:'Inconnu',unpaved:null,source:null};
}
const yes=new Set(['yes','1','true']),no=new Set(['no','0','false']);
export function bicycleDirections(tags={}){
 const bike=String(tags['oneway:bicycle']??'').toLowerCase(),base=String(tags.oneway??(['roundabout','circular'].includes(tags.junction)?'yes':'no')).toLowerCase(),one=bike||base;let forward=one!=='-1',backward=!yes.has(one);
 if(no.has(one))forward=backward=true;
 if(!bike)for(const key of ['cycleway','cycleway:left','cycleway:right','cycleway:both']){const extra=String(tags[key+':oneway']??'').toLowerCase();if(/^opposite(?:_|$)/.test(tags[key]||'')||no.has(extra))forward=backward=true;else if(extra==='-1')backward=true;else if(yes.has(extra))forward=true;}
 return {forward,backward};
}
// Local traffic is usable for the gravel planner. Bicycle-specific bans still
// take precedence in bicycleForbidden, including on a destination-only street.
const allowed=new Set(['yes','designated','permissive','official','allowed','destination']);
const meanings={no:'Interdit',private:'Accès privé',destination:'Desserte locale uniquement',customers:'Réservé aux clients',permit:'Autorisation requise',forestry:'Usage forestier',agricultural:'Usage agricole',delivery:'Livraisons uniquement',dismount:'Vélo à pousser',use_sidepath:'Piste cyclable à utiliser',discouraged:'Circulation déconseillée'};
export function bicycleAccess(tags={},direction='forward'){
 const keys=[`bicycle:${direction}`,'bicycle',`vehicle:${direction}`,'vehicle',`access:${direction}`,'access'];let label=null,level=keys.length-1;
 for(const [index,key] of keys.entries()){const raw=tags[key];if(typeof raw!=='string'||!raw.trim())continue;level=index;const value=raw.trim().toLowerCase();if(!allowed.has(value))label=`${meanings[value]||'Accès limité'} (${key}=${raw.slice(0,70)})`;break;}
 const condition=keys.slice(0,level+1).map(key=>tags[key+':conditional']).find(Boolean);
 if(condition)label=(label?label+' · ':'')+'Conditions : '+String(condition).slice(0,130);
 return label?{label:label.slice(0,200)}:null;
}

// Unconditional bicycle bans cannot be overridden by a waypoint. Directional
// bicycle tags take precedence over the general bicycle tag.
export function bicycleForbidden(tags={},direction='forward'){
 const value=String(tags[`bicycle:${direction}`]??tags.bicycle??'').trim().toLowerCase();return ['no','0','false','dismount','use_sidepath'].includes(value);
}
