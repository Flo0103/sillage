import {$,api,post,message,button} from './common.js?v=6.18.0';
async function layers(){const list=await api('/api/wms');$('wmsList').replaceChildren();for(const w of list){const row=document.createElement('div'),name=document.createElement('strong');row.className='managementrow';name.textContent=w.name;row.append(name,button('Supprimer',async()=>{await api(`/api/wms/${w.id}`,{method:'DELETE'});await layers();}));$('wmsList').append(row);}}
$('passwordForm').onsubmit=async e=>{e.preventDefault();try{if($('newPassword').value!==$('confirmation').value)throw Error('Les nouveaux mots de passe sont différents.');await post('/api/account/password',{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});$('passwordForm').reset();message('Mot de passe modifié. Les autres sessions sont déconnectées.');}catch(e){message(e.message);}};
$('wmsForm').onsubmit=async e=>{e.preventDefault();try{await post('/api/wms',{name:$('wmsName').value,url:$('wmsUrl').value,layers:$('wmsLayers').value,version:$('wmsVersion').value,styles:$('wmsStyles').value,attribution:$('wmsAttribution').value});$('wmsForm').reset();await layers();message('Fond enregistré. Retournez sur la carte pour le sélectionner.');}catch(e){message(e.message);}};
try{const me=await api('/api/me');$('identity').textContent=`Connecté en tant que ${me.username}`;await layers();}catch(e){message(e.message);}

async function stravaStatus(){const state=await api('/api/strava/status');
 $('accountStravaStatus').textContent=!state.configured?'La connexion Strava doit encore être activée sur le serveur par l’administrateur.':state.connected?'Votre compte Strava est connecté. Vous pouvez choisir vos sorties gravel.':'Connectez votre compte Strava pour choisir une sortie gravel.';
 $('accountConnectStrava').hidden=!state.configured||state.connected;$('accountStravaActivities').hidden=!state.configured||!state.connected;$('accountDisconnectStrava').hidden=!state.connected;
}
$('accountDisconnectStrava').onclick=async()=>{if(!confirm('Déconnecter Strava et supprimer ses sorties importées et leurs secteurs ?'))return;try{const result=await post('/api/strava/disconnect',{});await stravaStatus();message(result.remoteRevoked?'Compte Strava déconnecté.':'Imports supprimés de Sillage. Vérifiez aussi les autorisations dans les paramètres Strava.');}catch(e){message(e.message);}};
try{await stravaStatus();}catch(e){$('accountStravaStatus').textContent=e.message;}

$('exportAccount').onclick=async()=>{
 const control=$('exportAccount');if(control.disabled)return;control.disabled=true;$('exportStatus').textContent='Préparation du fichier…';let objectURL;
 try{const response=await fetch('/api/account/export');if(response.status===401){location.replace('/login.html');throw Error('Session expirée.');}if(!response.ok){const data=await response.json();throw Error(data.error||'Export indisponible.');}const blob=await response.blob();objectURL=URL.createObjectURL(blob);const link=document.createElement('a');link.href=objectURL;link.download='sillage-donnees-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();$('exportStatus').textContent='Le téléchargement de vos données a été lancé.';}
 catch(e){$('exportStatus').textContent=e.message;}finally{if(objectURL)setTimeout(()=>URL.revokeObjectURL(objectURL),1000);control.disabled=false;}
};
