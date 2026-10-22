export const $=id=>document.getElementById(id);
export async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const d=await r.json();if(r.status===401){location.replace('/login.html');throw Error('Session expirée.');}if(!r.ok)throw Error(d.error||'Requête impossible.');return d;}
export const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
export function message(t){$('message').textContent=t;}
export function button(text,action){const b=document.createElement('button');b.type='button';b.className='outline';b.textContent=text;b.onclick=()=>Promise.resolve(action()).catch(e=>message(e.message));return b;}
