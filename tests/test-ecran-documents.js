// Teste l'ouverture d'un document cote ecran (index.html) avec un faux serveur.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2],'utf8');
function grab(a,b){ const i=src.indexOf(a), j=src.indexOf(b,i); return src.slice(i,j); }
let clicked=[], alerts=[], served={};
const document={ createElement(){ return { click(){ clicked.push(this.href+'|'+this.download); } }; }, body:{appendChild(){},removeChild(){}} };
function alert(m){ alerts.push(m); }
let DOCUMENTS=[];
function apiGet(url){ const id=new URL('http://x'+url).searchParams.get('id'); if(served[id]===undefined) return Promise.resolve({ok:false,status:404,data:{}}); if(served[id]==='down') return Promise.reject(new Error('reseau')); return Promise.resolve({ok:true,status:200,data:{row:{id,data:served[id]}}}); }
eval(grab('function mapDocumentFromDb(r){','function mapRhPresenceFromDb') + grab('function downloadDocument(id){','function deleteDocument(id){'));
let pass=0,fail=0; function ok(c,m){ if(c){pass++;console.log('✅ '+m);}else{fail++;console.log('❌ '+m);} }
(async()=>{
  DOCUMENTS=[ {id:1,nom:'Contrat.pdf',categorie:'Clients',taille:'3 Mo',date_doc:'x',par_qui:'Yvan',mime_type:'application/pdf',has_data:true},
              {id:2,nom:'Ancien.pdf',has_data:false}, {id:3,nom:'Local.pdf',data:'data:local'}, {id:4,nom:'Coupe.pdf',has_data:true}, {id:5,nom:'Supprime.pdf',has_data:true} ].map(mapDocumentFromDb);
  ok(DOCUMENTS[0].hasData===true && DOCUMENTS[0].data===null,'liste legere : le fichier existe mais n\'est pas encore telecharge');
  ok(DOCUMENTS[2].hasData===true,'ancien format (contenu deja present) : reconnu');
  served={'1':'data:application/pdf;base64,QUJD','4':'down'};
  downloadDocument(1); await new Promise(r=>setTimeout(r,10));
  ok(clicked[0]==='data:application/pdf;base64,QUJD|Contrat.pdf','ouverture : le fichier est recupere a la demande puis telecharge sous son nom');
  downloadDocument(3); ok(clicked[1]==='data:local|Local.pdf','document deja en memoire : telecharge sans appel au serveur');
  downloadDocument(2); ok(/plus disponible/.test(alerts[0]),'document sans contenu : message clair');
  downloadDocument(4); await new Promise(r=>setTimeout(r,10)); ok(/Verifiez votre connexion/.test(alerts[1]),'coupure reseau : message clair, pas de plantage');
  downloadDocument(5); await new Promise(r=>setTimeout(r,10)); ok(/supprime/.test(alerts[2]),'document supprime entre-temps : message clair');
  console.log(`\n${pass} reussis, ${fail} en echec`); process.exit(fail?1:0);
})();
