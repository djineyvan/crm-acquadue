// Teste la logique de chargement extraite de index.html avec un faux reseau.
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
function grab(start,end){ const i=src.indexOf(start), j=src.indexOf(end,i); if(i<0||j<0) throw new Error('introuvable '+start); return src.slice(i,j); }
const code = grab('function loadAllDataFromDb(opts){','function mapDocumentFromDb(r){')
  + grab('function checkAppVersion(autoReload){',"window.addEventListener('pageshow'");
// --- faux environnement ---
let banner=null, reloads=0, applied=0, lastData=null, renders=0;
const document={ body:{appendChild(b){banner=b;}}, getElementById(id){ return id==='load-error-banner'?banner:null; },
  createElement(){ return {style:{}, remove(){ banner=null; }}; }, querySelector(){ return modalOpen?{}:null; },
  addEventListener(){} };
let modalOpen=false, PENDING_WRITES=0, WRITE_GEN=0, lent=null, CU={nom:'Yvan'}, CURRENT_VIEW='dash', BOOT_VERSION=null;
const location={ reload(){ reloads++; } };
let mode='ok', serverVersion='v1';
function apiGet(url){
  if(mode==='down') return Promise.reject(new Error('reseau'));
  if(mode==='lent') return new Promise(function(r){ lent=function(){ r({ok:true,data:{data:{clients:[{id:2}]}}}); }; });
  if(url==='/api/bulk-load'){
    if(mode==='bulk413'||mode==='legacyPartial') return Promise.resolve({ok:false,status:413,data:{}});
    return Promise.resolve({ok:true,data:{data:{clients:[{id:1}]}}});
  }
  if(mode==='legacyPartial' && url.indexOf('documents')>=0) return Promise.resolve({ok:false,status:500,data:{}});
  return Promise.resolve({ok:true,data:{rows:[{id:url}]}});
}
function applyBulkData(d){ applied++; lastData=d; }
function showSyncWarning(){}
function updateAllBadges(){} function renderView(){ renders++; } function restoreSubTabs(){}
function showUpdateBanner(){ updBanner=true; } let updBanner=false;
function fetch(){ return Promise.resolve({json(){ return {version:serverVersion}; }}); }
function autoRefreshTick(){}
eval(code);
let pass=0, fail=0; function ok(c,m){ if(c){pass++;console.log('✅ '+m);} else {fail++;console.log('❌ '+m);} }
(async()=>{
  // 1. chargement normal
  mode='ok'; await loadAllDataFromDb(); ok(applied===1 && !banner,'chargement normal : donnees appliquees, aucun message');
  // 2. reseau coupe pendant l'actualisation : donnees gardees, pas de message au 1er echec
  mode='down'; applied=0; await loadAllDataFromDb().catch(()=>{}); ok(applied===0,'coupure : les donnees affichees ne sont PAS remplacees par du vide');
  ok(!banner,'coupure ponctuelle pendant actualisation : pas de message (1 echec)');
  await loadAllDataFromDb().catch(()=>{}); await loadAllDataFromDb().catch(()=>{});
  ok(!!banner && /pas pu être chargées/.test(banner.innerHTML),'3 echecs de suite : message « Les données n\'ont pas pu être chargées » affiche');
  ok(/Réessayer/.test(banner.innerHTML),'le message contient le bouton Réessayer');
  // 3. bouton Reessayer quand le reseau revient
  mode='ok'; retryDataLoad(); await new Promise(r=>setTimeout(r,20));
  ok(!banner && renders===1,'Réessayer avec reseau revenu : message retire et ecran redessine');
  // 4. premier chargement rate (demarrage) : message immediat
  DATA_LOADED_ONCE=false; DATA_LOAD_FAILS=0; mode='down'; await loadAllDataFromDb().catch(()=>{});
  ok(!!banner,'echec au demarrage : message affiche des le 1er echec');
  // 5. bulk trop gros -> secours table par table, complet
  mode='bulk413'; applied=0; await loadAllDataFromDb();
  ok(applied===1 && lastData && Object.keys(lastData).length===24 && !banner,'bulk refuse : secours table par table charge les 24 tables, message retire');
  // 6. secours avec une table en echec : tout ou rien
  mode='legacyPartial'; applied=0; DATA_LOAD_FAILS=0; DATA_LOADED_ONCE=false; await loadAllDataFromDb().catch(()=>{});
  ok(applied===0 && !!banner,'secours avec une table en echec : rien n\'est remplace, message affiche');
  // 7. version : retour sur la page avec nouvelle version -> rechargement auto
  mode='ok'; serverVersion='v1'; checkAppVersion(); await new Promise(r=>setTimeout(r,5));
  serverVersion='v2'; checkAppVersion(true); await new Promise(r=>setTimeout(r,5));
  ok(reloads===1,'retour sur l\'onglet + nouvelle version : rechargement automatique');
  // 8. ... mais pas si une saisie est en cours
  BOOT_VERSION='v1'; modalOpen=true; updBanner=false; checkAppVersion(true); await new Promise(r=>setTimeout(r,5));
  ok(reloads===1 && updBanner,'fenetre de saisie ouverte : pas de rechargement, bandeau « Nouvelle version » a la place');
  modalOpen=false; PENDING_WRITES=1; updBanner=false; checkAppVersion(true); await new Promise(r=>setTimeout(r,5));
  ok(reloads===1 && updBanner,'enregistrement en cours : pas de rechargement');
  PENDING_WRITES=0; updBanner=false; checkAppVersion(false); await new Promise(r=>setTimeout(r,5));
  ok(reloads===1 && updBanner,'controle normal (chaque minute) : bandeau seulement, pas de rechargement force');
  // 9. (19/11/2026) actualisation automatique perimee : ignoree
  mode='ok'; applied=0; await loadAllDataFromDb({auto:true, gen:WRITE_GEN});
  ok(applied===1,'actualisation automatique normale : donnees appliquees');
  mode='lent'; applied=0; let pr=loadAllDataFromDb({auto:true, gen:WRITE_GEN}); WRITE_GEN++; lent(); await pr;
  ok(applied===0,'enregistrement lance pendant l\'actualisation : l\'ancienne version n\'efface pas le changement');
  applied=0; pr=loadAllDataFromDb({auto:true, gen:WRITE_GEN}); modalOpen=true; lent(); await pr; modalOpen=false;
  ok(applied===0,'fiche ouverte pendant l\'actualisation : donnees de l\'ecran gardees (la fiche ouverte reste liee)');
  applied=0; pr=loadAllDataFromDb({auto:true, gen:WRITE_GEN}); PENDING_WRITES=1; lent(); await pr; PENDING_WRITES=0;
  ok(applied===0,'enregistrement encore en cours : actualisation ignoree');
  applied=0; pr=loadAllDataFromDb(); WRITE_GEN++; lent(); await pr;
  ok(applied===1,'chargement apres connexion (pas automatique) : toujours applique');
  console.log(`\n${pass} reussis, ${fail} en echec`); process.exit(fail?1:0);
})();
