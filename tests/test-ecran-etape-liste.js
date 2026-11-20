// Teste (18/11/2026) : fiche d'une opportunite du Pipeline sans boutons
// « Faire avancer », « Marquer perdu », « Non qualifie », « Changer d'etape ».
// Tout passe par la liste deroulante des etapes ; « Perdu » et « Non qualifie »
// ouvrent la fenetre des raisons. Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-etape-liste.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

let CU = { nom: 'Yvan' }, superAdmin = true;
function isSuperAdmin() { return superAdmin; } function canModifyProspectInfo() { return false; }
let alerts = [], logs = [], dbUpdates = [], confirmAnswer = true, confirms = [], fermes = 0, saves = 0;
function alert(m) { alerts.push(m); } function confirm(m) { confirms.push(m); return confirmAnswer; }
function logAction(a, d) { logs.push([a, d]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; }
function ensureClientExists() {} function closeModal() { fermes++; } function go() {}
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
const DOM = {};
DOM.app = { insertAdjacentHTML: function (w, html) { DOM.dernierHtml = html; const m = { style: {}, classList: { add: function () {} }, remove: function () { delete DOM['modal-raison-nq']; } }; DOM['modal-raison-nq'] = m; DOM['raison-nq-select'] = { value: '' }; } };
function el(id) { return DOM[id] || null; }
function modalShell(id, t, b, f) { return '<div id="' + id + '">' + t + b + f + '</div>'; }
function btnGhost(l, o) { return '<button onclick="' + o + '">' + l + '</button>'; } function btnRed(l, o) { return btnGhost(l, o); }
function choisir(r) { DOM['raison-nq-select'].value = r; confirmRaisonNq(); }
function syncStockRow() {} function getStockRow() { return null; } function triggerPipelineWon() { return true; }
let PIPELINE = [], CLIENTS = [];
var DETAIL_CTX = null; function saveDetailEdit() { saves++; DETAIL_CTX = null; }
eval(grab('const PIPELINE_STAGES =', '// ── CLIENTS / PROSPECTS').replace(/^const /gm, 'var '));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));
eval(grab('function findLinkedClient(p, oldNom){', 'function findLinkedPipeline'));
eval(grab('// ── CHANGEMENT D\'ETAPE DIRECT', '// Demande explicite : jusqu\'ici, aucune action de suppression'));
function reset() {
  PIPELINE = [{ id: 1, nom: 'Awa', etape: 'Contacte', ville: 'Niamey', sku: '', qte: 1 }];
  CLIENTS = [{ id: 101, nom: 'Awa', statut: 'Contacte', raisonNq: '', raisonPerte: '' }];
  alerts = []; logs = []; dbUpdates = []; confirms = []; fermes = 0; saves = 0; DETAIL_CTX = null;
  DOM['pipe-etape-direct'] = { value: 'Contacte' };
}
const P = function () { return PIPELINE[0]; }, C = function () { return CLIENTS[0]; };

console.log('— 1. Les boutons ont disparu de la fiche');
const fiche = grab('function viewPipeCard(id){', 'function deletePipeline');
ok(!/Faire avancer a l/.test(fiche), '« Faire avancer a l\'etape suivante » retire');
ok(!/✗ Marquer perdu/.test(fiche), '« Marquer perdu » retire');
ok(!/onclick="markPipelineUnqualified\(/.test(fiche) && !/⊘ Non qualifie<\/button>/.test(fiche), '« Non qualifie » retire');
ok(!/✓ Changer d\\'etape/.test(fiche) && !/Changer d'etape<\/button>/.test(fiche), '« Changer d\'etape » retire');
ok(/\['Etape du pipeline', 'etape', PIPELINE_STAGES\.map\(/.test(fiche) && !/onchange="setPipelineStage\(/.test(fiche), 'la liste des etapes est une case de la fiche (19/11 : appliquee seulement a l\'enregistrement)');
ok(/deletePipeline\(/.test(fiche), '« Supprimer » (Super Admin) garde');

console.log('— 2. Choisir « Perdu » : fenetre des raisons de perte');
reset(); setPipelineStage(1, 'Perdu');
ok(!!DOM['modal-raison-nq'] && /Perdu/.test(DOM.dernierHtml) && /Pas interesse/.test(DOM.dernierHtml) && /Hors zone/.test(DOM.dernierHtml) && /Pas pret/.test(DOM.dernierHtml) && /Injoignable/.test(DOM.dernierHtml) && /Autre/.test(DOM.dernierHtml), 'fenetre avec Pas interesse, Injoignable, Hors zone, Pas pret, Autre');
ok(P().etape === 'Contacte' && confirms.length === 0, 'rien ne change avant d\'avoir choisi (pas de 2e confirmation)');
choisir('Pas pret');
ok(P().etape === 'Perdu' && C().statut === 'Client perdu', 'apres le choix : Perdu (fiche client « Client perdu »)');
ok(C().raisonPerte === 'Pas pret' && dbUpdates.some(function (u) { return u[2].raison_perte === 'Pas pret'; }), 'raison enregistree sur la fiche client (base)');
ok(/Pas pret/.test(raisonPerteBadge(C())), 'raison affichee sous l\'etiquette « Perdu »');
reset(); setPipelineStage(1, 'Perdu'); closeRaisonNq();
ok(P().etape === 'Contacte' && DOM['pipe-etape-direct'].value === 'Contacte', '« Annuler » : rien ne change, la liste revient a l\'etape actuelle');
reset(); setPipelineStage(1, 'Perdu'); confirmRaisonNq();
ok(P().etape === 'Contacte' && /Choisissez une raison/.test(alerts[0] || ''), 'valider sans raison : refuse');
closeRaisonNq();

console.log('— 3. Choisir « Non qualifie » : fenetre des raisons (comme avant)');
reset(); setPipelineStage(1, 'Non qualifie');
ok(/non qualifie/.test(DOM.dernierHtml) && /Faux numero/.test(DOM.dernierHtml) && /Simple curieux/.test(DOM.dernierHtml) && /Injoignable/.test(DOM.dernierHtml), 'fenetre des raisons du « Non qualifie » (avec Injoignable)');
choisir('Faux numero');
ok(P().etape === 'Non qualifie' && C().raisonNq === 'Faux numero', 'Non qualifie + raison enregistree');

console.log('— 4. Autres etapes, et sortie de « Perdu »');
reset(); setPipelineStage(1, 'En negociation');
ok(P().etape === 'En negociation' && /a "En negociation"/.test(confirms[0] || ''), 'autre etape : simple confirmation puis changement');
reset(); confirmAnswer = false; setPipelineStage(1, 'Gagne'); confirmAnswer = true;
ok(P().etape === 'Contacte' && DOM['pipe-etape-direct'].value === 'Contacte', 'confirmation refusee : la liste revient a l\'etape actuelle');
reset(); P().etape = 'Perdu'; C().statut = 'Client perdu'; C().raisonPerte = 'Hors zone';
setPipelineStage(1, 'Contacte');
ok(C().raisonPerte === '' && dbUpdates.some(function (u) { return u[2].raison_perte === ''; }), 'la fiche quitte « Perdu » : la raison est effacee');
reset(); setPipelineStage(1, 'Contacte');
ok(dbUpdates.length === 0 && alerts.length === 0, 'meme etape : rien');

console.log('— 5. Cases modifiees dans la fiche : enregistrees avant le changement d\'etape');
reset(); DETAIL_CTX = { dirty: true, record: P() }; setPipelineStage(1, 'Offre envoyee');
ok(saves === 1 && P().etape === 'Offre envoyee', 'les notes ecrites juste avant ne sont plus perdues');
reset(); DETAIL_CTX = { dirty: true, record: P() }; setPipelineStage(1, 'Perdu'); choisir('Autre');
ok(saves === 1 && P().etape === 'Perdu', '... aussi pour « Perdu »');

console.log('— 6. Fiche client');
ok(/'Statut':\['statut','raisonNq','raisonPerte'\]/.test(src) && /\['Raison \(si Client perdu\)', 'raisonPerte'/.test(src), 'fiche client : raison de perte modifiable');
ok(/raison_perte:record\.raisonPerte/.test(src), 'enregistree en base avec la fiche');
ok(/raisonPerte:r\.raison_perte\|\|''/.test(src), 'relue depuis la base');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
