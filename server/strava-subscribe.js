const {STRAVA_CLIENT_ID:client_id,STRAVA_CLIENT_SECRET:client_secret,STRAVA_WEBHOOK_SECRET:verify_token,APP_ORIGIN:origin}=process.env;
try{
 if(!client_id||!client_secret||!verify_token||!origin)throw Error('Complétez la configuration Strava et redémarrez le serveur.');
 const callback_url=origin+'/api/strava/webhook/'+verify_token;
 const list=await fetch('https://www.strava.com/api/v3/push_subscriptions?'+new URLSearchParams({client_id,client_secret}),{signal:AbortSignal.timeout(15000)});if(!list.ok)throw Error('Impossible de vérifier les abonnements Strava.');const existing=await list.json();
 if(existing.some(x=>x.callback_url===callback_url))console.log('Abonnement aux événements Strava déjà actif.');
 else if(existing.length)throw Error('Cette application Strava possède déjà un abonnement différent. Vérifiez sa configuration avant de le remplacer.');
 else{const response=await fetch('https://www.strava.com/api/v3/push_subscriptions',{method:'POST',body:new URLSearchParams({client_id,client_secret,callback_url,verify_token}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Strava ne valide pas le callback. Vérifiez HTTPS et la disponibilité de Sillage.');console.log('Abonnement aux événements Strava activé.');}
}catch(e){console.error(e.message);process.exitCode=1;}
