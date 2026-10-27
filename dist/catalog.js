export const ratingColors=['#c63f3a','#df7b3b','#d0ad3c','#8aa34a','#278049'];
export const ratingLabels=['Horrible','Peu agréable','Agréable','Très agréable','Superbe'];
export const surfaceColors={'Gravier fin':'#d29b35','Chemin de terre':'#825c40','Cailloux / pierres':'#777e91','Grosses pierres / blocs':'#643b91','Sable':'#d5ba65','Asphalte':'#283e4d','Mixte':'#228b9b'};
export const winterLabels={unknown:'Hiver non renseigné',yes:'Roulable en hiver',no:'Non roulable en hiver',conditions:'Hiver selon conditions'};
export function visibleSegments(segments,{mine=true,others=true,winter='all',singleTrack='all'}={}){return segments.filter(s=>(s.isMine?mine:others&&s.isPublic)&&(winter==='all'||(s.winter||'unknown')===winter)&&(singleTrack==='all'||(s.singleTrack||'unknown')===singleTrack));}
export const singleTrackLabels={yes:'Single track',no:'Chemin large',unknown:'Single track non renseigné'};
export const singleTrackColors={yes:'#7c4297',no:'#197b78',unknown:'#7b817d'};
export const difficultyColors={'Facile':'#547854','Intermédiaire':'#b59e46','Technique':'#b96b45','Très technique':'#8e4353'};
export function segmentColor(s,mode){return mode==='difficulty'?difficultyColors[s.difficulty]||'#9b9b91':mode==='singleTrack'?singleTrackColors[s.singleTrack||'unknown']||singleTrackColors.unknown:mode==='surface'?surfaceColors[s.surface]||'#65786b':ratingColors[Math.max(0,Math.min(4,s.rating-1))];}
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
