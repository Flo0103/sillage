export const ratingColors=['#b91c1c','#e36b22','#c49b12','#64a036','#16734a'];
export const surfaceColors={'Gravier fin':'#d29b35','Chemin de terre':'#825c40','Cailloux / pierres':'#777e91','Grosses pierres / blocs':'#643b91','Sable':'#d5ba65','Asphalte':'#283e4d','Mixte':'#228b9b'};
export const winterLabels={unknown:'Hiver non renseigné',yes:'Roulable en hiver',no:'Non roulable en hiver',conditions:'Hiver selon conditions'};
export function visibleSegments(segments,{mine=true,others=true,winter='all'}={}){return segments.filter(s=>(s.isMine?mine:others&&s.isPublic)&&(winter==='all'||s.winter===winter));}
export function segmentColor(s,mode){return mode==='surface'?surfaceColors[s.surface]||'#65786b':ratingColors[Math.max(0,Math.min(4,s.rating-1))];}
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
