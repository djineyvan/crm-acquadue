// Teste (13/11/2026) : changement d'etape DIRECT dans le Pipeline.
// Mis a jour le 13/11/2026 (soir) : la migration ponctuelle "Perdus hors Niamey"
// a ete retiree (9ea29cb) et le passage en "Non qualifie" demande une raison.
// Faux environnement, aucune donnee reelle.
// Usage : node test-ecran-etape-directe.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
// --- faux environnement ---
let CU = { nom: 'Yvan' }, superAdmin = true, prospectPerm = false;
function isSuperAdmin() { return superAdmin; } function canModifyProspectInfo() { return prospectPerm; }
let alerts = [], logs = [], dbUpdates = [], created = [], confirmAnswer = true, confirms = [];
function alert(m) { alerts.push(m); } function confirm(m) { confirms.push(m); return confirmAnswer; }
function logAction(a, d) { logs.push([a, d]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; p.lastModifiedAt = 'now'; }
function ensureClientExists(nom, prod, statut) { created.push([nom, prod, statut]); }
function closeModal() {} function go() {}
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
// Faux DOM pour la petite fenetre de raison du « Non qualifie »
const DOM = {};
DOM.app = { insertAdjacentHTML: function () { const m = { style: {}, classList: { add: function () {} }, remove: function () { delete DOM['modal-raison-nq']; } }; DOM['modal-raison-nq'] = m; DOM['raison-nq-select'] = { value: '' }; } };
function el(id) { return DOM[id] || null; }
function modalShell(id, t, b, f) { return '<div id="' + id + '">' + t + b + f + '</div>'; }
function btnGhost(l, o) { return '<button onclick="' + o + '">' + l + '</button>'; } function btnRed(l, o) { return btnGhost(l, o); }
function choisir(r) { DOM['raison-nq-select'].value = r; confirmRaisonNq(); }
let stockSynced = [];
function syncStockRow(r) { stockSynced.push(r.sku); }
let STOCK = [], PIPELINE = [], CLIENTS = [];
function getStockRow(sku, e) { return STOCK.find(function (s) { return s.sku === sku && s.entrepot === e; }); }
let wonCalls = 0, wonOk = true;
function triggerPipelineWon(p) { wonCalls++; if (wonOk) { getStockRow(p.sku, p.entrepot).reserve += p.qte; p.reservationFaite = true; } return wonOk; }
eval(grab('const PIPELINE_STAGES =', '// ── CLIENTS / PROSPECTS').replace(/^const /gm, 'var '));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));
eval(grab('function findLinkedClient(p, oldNom){', 'function findLinkedPipeline'));
eval(grab('// ── CHANGEMENT D\'ETAPE DIRECT', '// Demande explicite : jusqu\'ici, aucune action de suppression'));

let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function reset() {
  STOCK = [{ sku: 'P1', entrepot: 'E1', reserve: 4, qte: 10 }];
  PIPELINE = [
    { id: 1, nom: 'Awa', etape: 'Nouveau prospect', ville: 'Niamey', sku: '', qte: 1 },
    { id: 2, nom: 'Bio', etape: 'Gagne', ville: 'Niamey', sku: 'P1', qte: 2, entrepot: 'E1', reservationFaite: true },
    { id: 3, nom: 'Cisse', etape: 'Contacte', ville: 'Maradi', sku: 'P1', qte: 3, entrepot: 'E1' },
    { id: 4, nom: 'Dado', etape: 'Perdu', ville: 'Zinder' },
    { id: 5, nom: 'Eli', etape: 'Perdu', ville: 'Niamey' },
    { id: 6, nom: 'Fati', etape: 'Perdu', ville: ' NIAMEY ' },
    { id: 7, nom: 'Gado', etape: 'Perdu', ville: '' },
    { id: 8, nom: 'Hawa', etape: 'Perdu', ville: 'Tahoua' },
    { id: 9, nom: 'Issa', etape: 'Perdu', ville: 'Niamey - Plateau' },
    { id: 10, nom: 'Jean', etape: 'Non qualifie', ville: 'Dosso' }
  ];
  CLIENTS = [
    { id: 101, nom: 'Awa', statut: 'Nouveau prospect', produit: 'Purificateur maison' },
    { id: 102, nom: 'Bio', statut: 'Client actif', produit: '2x P1' },
    { id: 103, nom: 'Cisse', statut: 'Contacte', produit: '3x P1' },
    { id: 104, nom: 'Dado', statut: 'Client perdu', produit: 'Bougie' },
    { id: 108, nom: 'Hawa', statut: 'Client perdu', produit: 'X' }
  ];
  alerts = []; logs = []; dbUpdates = []; created = []; confirms = []; stockSynced = []; wonCalls = 0;
}
const P = function (id) { return PIPELINE.find(function (x) { return x.id === id; }); };
const C = function (id) { return CLIENTS.find(function (x) { return x.id === id; }); };

// 1. Saut direct sans passer par les etapes
reset(); setPipelineStage(1, 'En negociation');
ok(P(1).etape === 'En negociation', 'saut direct : Nouveau prospect -> En negociation (sans passer par Contacte/Offre)');
ok(C(101).statut === 'En negociation', 'Clients & Prospects mis a jour');
ok(C(101).produit === 'Purificateur maison', 'le produit d\'interet du client n\'est PAS ecrase');
ok(dbUpdates.some(function (u) { return u[0] === 'pipeline' && u[1] === 1 && u[2].etape === 'En negociation'; }), 'opportunite enregistree en base');
ok(dbUpdates.some(function (u) { return u[0] === 'clients' && u[1] === 101 && u[2].statut === 'En negociation'; }), 'fiche client enregistree en base');
ok(/de "Nouveau prospect" a "En negociation"/.test(confirms[0] || ''), 'confirmation claire avant de changer', confirms);
ok(logs.some(function (l) { return /Nouveau prospect → En negociation/.test(l[1]); }), 'trace dans le journal');

// 2. Retour en arriere et reouverture
reset(); setPipelineStage(10, 'Contacte');
ok(P(10).etape === 'Contacte', 'reouvrir un « Non qualifie » (-> Contacte)');
reset(); setPipelineStage(4, 'Non qualifie'); choisir('Hors zone');
ok(P(4).etape === 'Non qualifie' && C(104).statut === 'Non qualifie', 'corriger un « Perdu » en « Non qualifie » (impossible avant)');
ok(C(104).raisonNq === 'Hors zone', '... avec la raison choisie (« Hors zone »)');

// 3. Stock
reset(); setPipelineStage(2, 'Offre envoyee');
ok(P(2).etape === 'Offre envoyee' && P(2).reservationFaite === false && STOCK[0].reserve === 2, 'quitter « Gagne » libere le stock reserve', STOCK[0]);
ok(stockSynced.length === 1, 'stock libere enregistre en base');
ok(C(102).statut === 'Offre envoyee', 'le client redevient prospect');
reset(); setPipelineStage(3, 'Gagne');
ok(P(3).etape === 'Gagne' && wonCalls === 1 && STOCK[0].reserve === 7, 'passer en « Gagne » reserve le stock', STOCK[0]);
ok(C(103).statut === 'Client actif', 'le prospect devient « Client actif »');
reset(); wonOk = false; setPipelineStage(3, 'Gagne'); wonOk = true;
ok(P(3).etape === 'Gagne' && /insuffisant/.test(alerts[0] || ''), 'stock insuffisant : etape changee + avertissement', alerts);
reset(); setPipelineStage(1, 'Gagne');
ok(P(1).etape === 'Gagne' && wonCalls === 0, 'lead sans produit lie : « Gagne » sans fausse reservation de stock');

// 4. Garde-fous
reset(); confirmAnswer = false; setPipelineStage(1, 'Perdu'); confirmAnswer = true;
ok(P(1).etape === 'Nouveau prospect' && dbUpdates.length === 0, '« Annuler » dans la confirmation : rien ne change');
reset(); setPipelineStage(1, 'Nouveau prospect');
ok(dbUpdates.length === 0 && /deja/.test(alerts[0] || ''), 'meme etape : message, rien ne change');
reset(); setPipelineStage(1, 'Etape inventee');
ok(P(1).etape === 'Nouveau prospect' && dbUpdates.length === 0, 'etape inconnue refusee');
reset(); superAdmin = false; prospectPerm = false; setPipelineStage(1, 'Contacte');
ok(P(1).etape === 'Nouveau prospect' && /permission/.test(alerts[0] || ''), 'sans permission : refuse');
prospectPerm = true; reset(); setPipelineStage(1, 'Contacte');
ok(P(1).etape === 'Contacte', 'avec « Modifier informations prospect » : autorise');
superAdmin = true; prospectPerm = false;
reset(); PIPELINE.push({ id: 11, nom: 'Sans fiche', etape: 'Contacte', ville: 'Say', tel: '9' }); setPipelineStage(11, 'Perdu');
ok(created.some(function (c) { return c[0] === 'Sans fiche' && c[2] === 'Client perdu'; }), 'pas de fiche client liee : elle est creee');

// 5. Migration « Perdus hors Niamey » : utilisee puis RETIREE (9ea29cb).
// Ses anciens controles sont remplaces par la verification qu'elle a bien disparu.
ok(typeof perdusHorsNiamey === 'undefined' && typeof migratePerdusHorsNiamey === 'undefined', 'migration ponctuelle « Perdus hors Niamey » : code retire');
ok(src.indexOf('Perdus hors Niamey') < 0, 'bouton « ↪ Perdus hors Niamey » retire du Pipeline');

// 6. Presence dans la page
ok(/id="pipe-etape-direct"/.test(src) && /setPipelineStage\(/.test(src), 'fiche d\'une opportunite : liste « Changer d\'etape »');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
