// Teste (19/11/2026) : Rapports -> « Suivi d'appel, ventes par pub et filtres »
// et l'export CSV (joignabilite, ventes par pub, raisons de perte, filtres a
// changer ce mois-ci, detail du suivi). Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-rapport-suivi.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

function fcfa(n) { return (n || 0) + ' FCFA'; }
eval(grab('const PIPE_RESULTATS_APPEL', 'function peutSuivrePipe').replace(/^const /gm, 'var '));
eval(grab('const RAISONS_PERTE =', '\n').replace(/^const /, 'var '));
eval(grab('function formatDateFr(isoDate){', '\n}\n') + '\n}');
eval(grab('function isInPeriod(dateStr, period){', '// Meme logique que isInPeriod'));
eval(grab('function csvEscape(val){', 'function downloadTextFile'));
eval(grab('// ── RAPPORT « SUIVI D\'APPEL', 'function duplicateContactsReportHtml(){').replace(/^const /gm, 'var '));
function findLinkedClient(p) { return CLIENTS.find(function (c) { return c.nom === p.nom; }); }

const now = new Date();
const ceMois = function (j) { return new Date(now.getFullYear(), now.getMonth(), j, 10).getTime(); };
const iso = function (d) { return pipeIsoLocal(d); };
// Livraison il y a ~90 jours -> filtre a changer ce mois-ci
const livAncienne = new Date(now.getFullYear(), now.getMonth() + 1, 0); livAncienne.setDate(livAncienne.getDate() - 90);
const livRetard = new Date(now.getFullYear(), now.getMonth(), 1); livRetard.setDate(livRetard.getDate() - 100);
let PIPELINE = [
  { id: ceMois(1), nom: 'A', pub: 'V1', appele: true, resultatAppel: 'Interesse', etape: 'Contacte' },
  { id: ceMois(1) + 1, nom: 'B', pub: 'V1', appele: true, resultatAppel: 'Pas de reponse', etape: 'Contacte', rappelSoir: true },
  { id: ceMois(2), nom: 'C', pub: 'V2', appele: true, resultatAppel: 'Livraison prevue', etape: 'Gagne', dateLivraison: iso(now), montant: 70000, relanceJ2: true },
  { id: ceMois(2) + 1, nom: 'D', pub: '', appele: false, resultatAppel: '', etape: 'Nouveau prospect' },
  { id: ceMois(3), nom: 'E', pub: 'V2', appele: true, resultatAppel: 'Pas interesse', etape: 'Perdu' },
  { id: ceMois(3) + 1, nom: 'F', pub: 'V3', appele: false, resultatAppel: 'Vocal envoye', etape: 'Perdu' },
  { id: new Date(now.getFullYear() - 1, 0, 5).getTime(), nom: 'Vieux', pub: 'V1', appele: true, resultatAppel: 'Interesse', etape: 'Gagne', dateLivraison: iso(livAncienne), montant: 50000, tel: '96', quartier: 'Plateau', asg: 'Yvan' },
  { id: new Date(now.getFullYear() - 1, 0, 6).getTime(), nom: 'Retard', pub: 'V1', etape: 'Gagne', dateLivraison: iso(livRetard), montant: 50000 }
];
let CLIENTS = [{ nom: 'E', statut: 'Client perdu', raisonPerte: 'Pas interesse' }, { nom: 'F', statut: 'Client perdu', raisonPerte: '' }];

console.log('— 1. Chiffres du mois');
const st = suiviAppelStats('this_month');
ok(st.recus === 6, '6 contacts recus ce mois-ci (les anciens ne comptent pas)', st.recus);
ok(st.appeles === 5 && st.joints === 3 && st.nonJoints === 2, 'appeles 5 (dont « Vocal envoye » sans case cochee), joints 3', [st.appeles, st.joints]);
ok(pourcent(st.joints, st.appeles) === 60, 'taux de joignabilite : 60 %');
ok(st.rappelSoir === 1 && st.relanceJ2 === 1, 'rappels du soir et relances J+2 comptes');
ok(st.resultats['Pas de reponse'] === 1 && st.resultats['Sans resultat'] === 1, 'repartition des resultats');
ok(st.pubs.V1.contacts === 2 && st.pubs.V1.joints === 1 && st.pubs.V1.interesses === 1 && st.pubs.V1.ventes === 0, 'pub V1 : 2 contacts, 1 joint, 1 interesse, 0 vente');
ok(st.pubs.V2.ventes === 1 && st.pubs.V2.montant === 70000, 'pub V2 : 1 vente, 70 000 FCFA');
ok(st.pubs['Non renseignee'].contacts === 1, 'contacts sans pub : « Non renseignee »');
ok(st.perdus === 2 && st.pertes['Pas interesse'] === 1 && st.pertes['Sans raison'] === 1, 'raisons de perte comptees');

console.log('— 2. Filtres a changer ce mois-ci (toutes periodes)');
ok(st.filtres.length === 2 && st.filtres.some(function (f) { return f.nom === 'Vieux' && !f.retard; }) && st.filtres.some(function (f) { return f.nom === 'Retard' && f.retard; }), 'filtre du mois + filtre en retard, meme pour un ancien client', st.filtres);
ok(!st.filtres.some(function (f) { return f.nom === 'C'; }), 'une livraison d\'aujourd\'hui n\'est pas encore a changer');

console.log('— 3. Toute la periode, affichage et CSV');
ok(suiviAppelStats('all').recus === 8, '« Tout afficher » : tous les contacts');
const html = suiviAppelRapportHtml('this_month');
ok(/JOIGNABILITE/.test(html) && /60 %/.test(html) && /Ventes par pub/.test(html) && /Raisons de perte/.test(html) && /Filtres a changer ce mois-ci \(2\)/.test(html) && /en retard/.test(html), 'rapport affiche : joignabilite, ventes par pub, pertes, filtres');
const csv = suiviAppelCsvLignes('this_month').join('\n');
ok(/--- SUIVI D'APPEL/.test(csv) && /\n6,5,3,2,60,1,1,2\n/.test(csv), 'CSV : ligne des chiffres', csv.slice(0, 300));
ok(/--- VENTES PAR PUB ---/.test(csv) && /\nV2,2,2,2,100,1,1,50,70000/.test(csv), 'CSV : ventes par pub');
ok(/--- RAISONS DE PERTE ---/.test(csv) && /\nPas interesse,1,50/.test(csv), 'CSV : raisons de perte');
ok(/--- FILTRES A CHANGER CE MOIS-CI ---/.test(csv) && /\nVieux,96,Plateau,/.test(csv), 'CSV : filtres a changer');
ok(/--- PIPELINE : DETAIL DU SUIVI D'APPEL ---/.test(csv) && /\nE,,[0-9\/]+,Perdu,Pas interesse,V2,Oui,Non,Non,Pas interesse/.test(csv), 'CSV : detail ligne par ligne avec la raison de perte');

console.log('— 4. Branchements');
ok(/id="rpt-suivi"/.test(src) && /el\('rpt-suivi'\)\.innerHTML = suiviAppelRapportHtml\(RAPPORT_PERIOD\)/.test(src), 'carte dans Rapports, suit la periode choisie');
ok(/suiviAppelCsvLignes\(RAPPORT_PERIOD\)\.forEach/.test(src), 'ajoute a l\'export CSV');
ok(/'Raison \(perdu \/ non qualifie\)'/.test(src), 'CSV clients : colonne de la raison');
const pdf = grab('function exportReportPDF(){', '// ── UTILISATEURS & ACCES');
ok(/suiviAppelRapportHtml\(RAPPORT_PERIOD\)/.test(pdf) && /nonQualifiesParMoisHtml\(\)/.test(pdf), 'rapport PDF : carte du suivi d\'appel et raisons des non qualifies (19/11)');
ok(/:root\{--red:#C8102E;[^}]*--blue-light:/.test(pdf), 'rapport PDF : les couleurs de la carte sont definies');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
