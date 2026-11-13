// Teste le statut « Non qualifie » cote ecran (index.html), avec un faux environnement.
// Mis a jour le 13/11/2026 (soir) : depuis 9ea29cb, le bouton « Non qualifie » demande
// une RAISON (petite fenetre) au lieu d'une confirmation. Les controles du bouton
// simulent donc maintenant le choix de la raison (ou « Annuler »).
// Usage : node test-ecran-non-qualifie.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
const window = globalThis;
// --- faux environnement ---
let CU = { nom: 'Yvan' }, superAdmin = true, prospectPerm = false;
function isSuperAdmin() { return superAdmin; } function canModifyProspectInfo() { return prospectPerm; }
let alerts = [], logs = [], synced = [], dbUpdates = [], confirmAnswer = true, html = {};
function alert(m) { alerts.push(m); } function confirm() { return confirmAnswer; }
function logAction(a, d, c) { logs.push([a, d, c]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; p.lastModifiedAt = 'now'; }
function ensureClientExists(nom, prod, statut) { synced.push([nom, statut]); }
function closeModal() {} function go() {} function triggerPipelineWon() { return true; }
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
// Faux DOM : la fenetre de raison + des zones d'affichage simples
const DOM = {};
DOM.app = { insertAdjacentHTML: function (w, h) { const m = { style: {}, classList: { add: function () {} }, remove: function () { delete DOM['modal-raison-nq']; } }; DOM['modal-raison-nq'] = m; DOM['raison-nq-select'] = { value: '' }; } };
function el(id) { if (id === 'app' || id === 'modal-raison-nq' || id === 'raison-nq-select') return DOM[id] || null; if (!html[id]) html[id] = { innerHTML: '' }; return html[id]; }
function modalShell(id, t, b, f) { return '<div id="' + id + '">' + t + b + f + '</div>'; }
function btnGhost(l, o) { return '<button onclick="' + o + '">' + l + '</button>'; } function btnRed(l, o) { return btnGhost(l, o); }
function choisir(r) { DOM['raison-nq-select'].value = r; confirmRaisonNq(); }
function fcfa(v) { return v + ' F'; } function searchMatch() { return true; } function visiblePipeFilter() { return true; }
function isResponsableOrAbove() { return false; } let PIPE_TYPE_FILTER = 'Tous', PIPE_AGENT_FILTER = 'Tous';
function tag(t, c) { return '<span class="' + c + '">' + t + '</span>'; }
let STOCK = [], PIPELINE = [], CLIENTS = [];
function syncStockRow() {}
eval(grab('const PIPELINE_STAGES =', '// ── CLIENTS / PROSPECTS').replace(/^const /gm, 'var '));
eval(grab('function statusTag(s){', '\n}\n') + '\n}');
eval(grab('function renderPipeBoard(){', 'function viewPipeCard(id){'));
eval(grab('function advancePipelineStage(id){', '// Demande explicite : jusqu\'ici, aucune action de suppression'));
eval(grab('function clientStatutToPipelineEtape(statut){', 'function syncClientToPipeline'));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));
eval(grab('function wrapAfter(fnName, afterFn){', '// CLIENTS'));
eval(grab('function findLinkedClient(p, oldNom){', 'function findLinkedPipeline'));
// fonctions declarees par eval -> on les rend globales comme dans le navigateur
Object.assign(window, { markPipelineLost, markPipelineUnqualified, advancePipelineStage });
eval(grab("wrapAfter('markPipelineLost', function", '// CAMPAGNES'));

let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

// 1. Colonnes
ok(PIPELINE_STAGES.length === 7 && PIPELINE_STAGES[6] === 'Non qualifie', '7 colonnes, « Non qualifie » en dernier', PIPELINE_STAGES);
ok(PIPELINE_STAGES.slice(0, 6).join() === 'Nouveau prospect,Contacte,Offre envoyee,En negociation,Gagne,Perdu', 'les 6 colonnes existantes sont inchangees, dans le meme ordre');
ok(isPipelineClosed('Non qualifie') && isPipelineClosed('Gagne') && isPipelineClosed('Perdu') && !isPipelineClosed('Contacte'), 'Gagne, Perdu et Non qualifie = etapes finales');
ok(/tag-grey/.test(statusTag('Non qualifie')), 'etiquette grise « Non qualifie » (fiche, tableau de bord)');
ok(/repeat\(7,1fr\)/.test(src) && /repeat\(7,200px\)/.test(src), 'mise en page : 7 colonnes sur ordinateur et sur telephone');

// 2. Affichage du tableau
PIPELINE = [
  { id: 1, nom: 'Awa', etape: 'Nouveau prospect', val: 30000, type: 'B2C', ville: 'Niamey', asg: 'Harouna X' },
  { id: 2, nom: 'Bio', etape: 'Non qualifie', val: 50000, type: 'B2C', ville: 'Maradi', asg: 'Harouna X' },
  { id: 3, nom: 'Cisse', etape: 'Offre envoyee', val: 70000, type: 'B2B', ville: 'Niamey', asg: 'Nadia Y', reservationFaite: true, qte: 2, sku: 'P1', entrepot: 'E1' }
];
renderPipeBoard();
const board = html['pipe-board'].innerHTML;
const cols = board.split('pipeline-col"').length - 1;
ok(cols === 7, 'le Pipeline affiche 7 colonnes', cols);
const nqCol = board.slice(board.indexOf('>Non qualifie<'));
ok(/Bio/.test(nqCol) && !/Awa/.test(nqCol), 'la fiche « Non qualifie » est dans sa colonne');

// 3. Classer en « Non qualifie »
STOCK = [{ sku: 'P1', entrepot: 'E1', reserve: 5 }];
CLIENTS = [{ id: 103, nom: 'Cisse', statut: 'Offre envoyee' }];
markPipelineUnqualified(3);
ok(PIPELINE[2].etape === 'Offre envoyee' && !!DOM['modal-raison-nq'], 'le bouton ouvre la fenetre de raison (rien ne change avant de choisir)');
choisir('Hors zone');
ok(alerts.length === 0 && PIPELINE[2].etape === 'Non qualifie', 'Super Admin : le prospect passe en « Non qualifie »', [alerts, PIPELINE[2].etape]);
ok(STOCK[0].reserve === 3 && PIPELINE[2].reservationFaite === false, 'le stock reserve pour ce prospect est libere', STOCK[0]);
ok(synced.some(function (s) { return s[0] === 'Cisse' && s[1] === 'Non qualifie'; }), 'Clients & Prospects mis a jour avec le meme statut', synced);
ok(dbUpdates.some(function (u) { return u[0] === 'pipeline' && u[1] === 3 && u[2].etape === 'Non qualifie'; }), 'changement enregistre en base (ne revient pas apres actualisation)', dbUpdates);
ok(logs.some(function (l) { return l[0] === 'Prospect non qualifie'; }), 'trace dans le journal d\'activite', logs);
ok(CLIENTS[0].raisonNq === 'Hors zone' && dbUpdates.some(function (u) { return u[0] === 'clients' && u[1] === 103 && u[2].raison_nq === 'Hors zone'; }), 'la raison choisie est enregistree sur la fiche client (et en base)', dbUpdates);

// 4. Garde-fous
const avant = dbUpdates.length;
advancePipelineStage(2);
ok(PIPELINE[1].etape === 'Non qualifie', '« Faire avancer » ne fait rien sur un prospect non qualifie');
markPipelineLost(2);
ok(PIPELINE[1].etape === 'Non qualifie', '« Marquer perdu » ne change pas un prospect deja non qualifie');
markPipelineUnqualified(1); closeRaisonNq();
ok(PIPELINE[0].etape === 'Nouveau prospect', 'si on clique « Annuler » dans la fenetre de raison, rien ne change');
superAdmin = false; prospectPerm = false; markPipelineUnqualified(1);
ok(PIPELINE[0].etape === 'Nouveau prospect' && /non qualifie/.test(alerts[alerts.length - 1] || ''), 'sans permission : refuse avec un message clair', alerts);
prospectPerm = true; markPipelineUnqualified(1); choisir('Faux numero');
ok(PIPELINE[0].etape === 'Non qualifie', 'avec la permission « Modifier informations prospect » : autorise');

// 5. « Marquer perdu » fonctionne toujours comme avant
superAdmin = true; PIPELINE.push({ id: 4, nom: 'Dado', etape: 'Contacte', val: 1, type: 'B2C', ville: 'Zinder', asg: 'H' });
markPipelineLost(4);
ok(PIPELINE[3].etape === 'Perdu' && synced.some(function (s) { return s[0] === 'Dado' && s[1] === 'Client perdu'; }), '« Marquer perdu » inchange : Perdu / Client perdu');
PIPELINE.push({ id: 5, nom: 'Eli', etape: 'En negociation', val: 1, type: 'B2C', ville: 'Zinder', asg: 'H' });
advancePipelineStage(5);
ok(PIPELINE[4].etape === 'Gagne', '« Faire avancer » inchange : En negociation -> Gagne (jamais vers Perdu ou Non qualifie)');

// 6. Correspondance Pipeline <-> Clients & Prospects
ok(pipelineEtapeToClientStatut('Non qualifie') === 'Non qualifie' && clientStatutToPipelineEtape('Non qualifie') === 'Non qualifie', 'meme mot dans les deux ecrans (aller-retour)');
ok(CLIENT_STATUTS.length === 7 && CLIENT_STATUTS.indexOf('Non qualifie') === 6, 'liste des statuts Clients & Prospects : « Non qualifie » ajoute');
ok(CLIENT_STATUTS.every(function (s) { return PIPELINE_STAGES.indexOf(clientStatutToPipelineEtape(s)) >= 0; }), 'chaque statut client correspond a une colonne du Pipeline');

// 7. Autres endroits dans la page
ok(/fieldSelect\('cl-statut','Statut',CLIENT_STATUTS\)/.test(src), 'formulaire « Nouveau client » : choix « Non qualifie »');
ok(/\{label:'Non qualifie',selected:cl\.statut==='Non qualifie'\}/.test(src), 'modification d\'une fiche client : choix « Non qualifie »');
ok(/const statuts = CLIENT_STATUTS;/.test(src), 'filtre « Statut » de Clients & Prospects : « Non qualifie »');
ok(/cl\.statut !== 'Client perdu' && cl\.statut !== 'Non qualifie'/.test(src), 'tableau de bord : les non qualifies ne comptent pas dans « Clients & Prospects actifs »');
ok(/<th>Non qualifies<\/th>/.test(src) && /b\.non_qualifies/.test(src), 'Centre de Controle -> bilan par publicite : colonne « Non qualifies »');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
