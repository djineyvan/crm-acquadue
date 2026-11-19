// Teste (19/11/2026) : fiche d'un prospect du Pipeline.
//  - choisir le produit (quantite, entrepot) directement dans la fiche ;
//  - l'etape choisie n'est appliquee QU'au clic sur « 💾 Enregistrer » ;
//  - le produit se repercute partout (fiche client, stock reserve, valeur),
//    et le produit choisi dans la fiche client revient dans le Pipeline.
// Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-pipeline-produit.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

let CU = { nom: 'Yvan' };
function isSuperAdmin() { return true; } function canModifyProspectInfo() { return true; }
let alerts = [], logs = [], dbUpdates = [], fermes = 0, gos = 0, demandes = [];
function alert(m) { alerts.push(m); } function logAction(a, d) { logs.push([a, d]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; }
function closeModal() { fermes++; } function go() { gos++; } function updateAllBadges() {}
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
function ensureClientExists() {}
function clearRaisonNqIfNeeded() {}
function setClientRaisonPerte(cl, r) { if (cl) cl.raisonPerte = r; }
function setClientRaisonNq(cl, r) { if (cl) cl.raisonNq = r; }
function askRaisonPerte(nom, onOk, onAnnule) { demandes.push(['perte', onOk, onAnnule]); }
function askRaisonNq(nom, onOk, onAnnule) { demandes.push(['nq', onOk, onAnnule]); }
function syncDetailEditToDb() {}
let STOCK = [];
function getStockRow(sku, ent) { return STOCK.find(function (s) { return s.sku === sku && s.entrepot === ent; }) || null; }
function syncStockRow(r) { dbUpdates.push(['stock', r.sku, { reserve: r.reserve }]); }
function triggerPipelineWon(p) { const r = getStockRow(p.sku, p.entrepot); if (!r || r.qte - r.reserve < p.qte) return false; r.reserve += p.qte; p.reservationFaite = true; return true; }
const PRODUITS = [{ sku: 'AQD-01', nom: 'Purificateur Famille', prix_vente: 70000 }, { sku: 'AQD-02', nom: 'Fontaine Bureau', prix_vente: 150000 }];
const ENTREPOTS = [{ nom: 'Niamey Centre' }, { nom: 'Zinder' }];
let PIPELINE = [], CLIENTS = [];
const DOM = {}; function el(id) { return DOM[id] || null; }
setTimeout = function (f) { f(); };
var DETAIL_CTX = null;
eval(grab('const PIPELINE_STAGES =', '\n').replace(/^const /, 'var '));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));
eval(grab('function findLinkedClient(p, oldNom){', '// ── DETECTION DE DOUBLONS'));
eval(grab('// ── CHANGEMENT D\'ETAPE DIRECT', '// Demande explicite : jusqu\'ici, aucune action de suppression'));
eval(grab('function saveDetailEdit(){', '// Maps the in-memory'));
eval(grab('function produitLisible(label){', 'function viewClientDetail(id){'));
function clientStatutToPipelineEtape(s) { return { 'Client actif': 'Gagne', 'Client perdu': 'Perdu' }[s] || s; }

function reset(etape) {
  PIPELINE = [{ id: 1, nom: 'Awa', tel: '90', etape: etape || 'Contacte', ville: 'Niamey', sku: '', qte: 1, entrepot: '', val: 30000, reservationFaite: false }];
  CLIENTS = [{ id: 101, nom: 'Awa', tel: '90', statut: 'Contacte', produit: '-', raisonNq: '', raisonPerte: '' }];
  STOCK = [{ sku: 'AQD-01', entrepot: 'Niamey Centre', qte: 10, reserve: 0 }, { sku: 'AQD-02', entrepot: 'Niamey Centre', qte: 10, reserve: 0 }];
  alerts = []; logs = []; dbUpdates = []; fermes = 0; gos = 0; demandes = [];
}
const P = function () { return PIPELINE[0]; }, C = function () { return CLIENTS[0]; };
// Simule la fiche ouverte : les cases que la personne a changees.
function ouvrirFiche(cases) {
  Object.keys(DOM).forEach(function (k) { delete DOM[k]; });
  Object.keys(cases).forEach(function (k) { DOM['detail-edit-' + k] = { value: String(cases[k]) }; });
  DOM['detail-save-btn'] = { style: {} };
  DETAIL_CTX = { title: 'Detail — Awa', record: P(), entity: 'pipeline', skipFields: ['etape', 'sku', 'qte', 'entrepot'], dirty: true,
    fields: [['Nom', 'nom', P().nom], ['Etape du pipeline', 'etape', [], 'select'], ['Produit lie', 'sku', [], 'select'], ['Quantite', 'qte', P().qte], ['Entrepot', 'entrepot', [], 'select'], ['Notes', 'notes', '', 'textarea']],
    onSave: function () {}, editConfig: { beforeSave: pipeAvantEnregistrement, afterSave: pipeApresEnregistrement } };
}

console.log('— 1. La fiche propose le produit, la quantite, l\'entrepot et l\'etape');
const fiche = grab('function viewPipeCard(id){', 'function advancePipelineStage');
ok(/\['Produit lie', 'sku', pipeProduitOptions\(p\.sku\), 'select'\]/.test(fiche) && /\['Quantite', 'qte', p\.qte \|\| 1\]/.test(fiche) && /\['Entrepot', 'entrepot',/.test(fiche), 'cases Produit lie, Quantite et Entrepot dans la fiche');
ok(/\['Etape du pipeline', 'etape', PIPELINE_STAGES\.map\(/.test(fiche) && !/onchange="setPipelineStage/.test(fiche), 'etape : une case de la fiche, sans changement immediat');
ok(/skipFields: \['etape','sku','qte','entrepot'\]/.test(fiche) && /beforeSave: pipeAvantEnregistrement/.test(fiche) && /afterSave: pipeApresEnregistrement/.test(fiche), 'appliques seulement a l\'enregistrement');
const opts = pipeProduitOptions('AQD-02');
ok(opts[0].value === '' && opts.length === 3 && opts[2].selected && opts[2].label === 'Fontaine Bureau (AQD-02)', 'liste : « Aucun produit » + catalogue, produit actuel choisi', opts);
ok(pipeProduitOptions('VIEUX').some(function (o) { return o.value === 'VIEUX' && o.selected; }), 'un ancien produit hors catalogue reste affiche (jamais efface par erreur)');
ok(/o\.value !== undefined \? ' value="'/.test(src), 'les listes de la fiche savent porter une valeur cachee (la reference du produit)');

console.log('— 2. Choisir une etape ne fait rien tant qu\'on n\'enregistre pas');
reset(); ouvrirFiche({ etape: 'En negociation' });
ok(P().etape === 'Contacte' && dbUpdates.length === 0, 'etape choisie dans la liste : rien ne change encore');
saveDetailEdit();
ok(P().etape === 'En negociation' && C().statut === 'En negociation', '« 💾 Enregistrer » : l\'etape est appliquee (et la fiche client suit)');
ok(dbUpdates.some(function (u) { return u[0] === 'pipeline' && u[2].etape === 'En negociation'; }), 'enregistree en base');
ok(DETAIL_CTX === null && fermes === 1, 'la fiche se ferme apres l\'enregistrement');

console.log('— 3. « Perdu » / « Non qualifie » : raison demandee a l\'enregistrement');
reset(); ouvrirFiche({ etape: 'Perdu' }); saveDetailEdit();
ok(demandes.length === 1 && demandes[0][0] === 'perte' && P().etape === 'Contacte', 'la raison est demandee, rien n\'est encore change');
demandes[0][1]('Pas pret');
ok(P().etape === 'Perdu' && C().statut === 'Client perdu' && C().raisonPerte === 'Pas pret', 'raison choisie : Perdu + raison enregistree');
reset(); ouvrirFiche({ etape: 'Perdu' }); saveDetailEdit(); demandes[0][2]();
ok(P().etape === 'Contacte' && DETAIL_CTX !== null && fermes === 0, '« Annuler » : rien n\'est enregistre, la fiche reste ouverte');
reset(); ouvrirFiche({ etape: 'Non qualifie' }); saveDetailEdit();
ok(demandes[0][0] === 'nq', 'Non qualifie : fenetre des raisons de non-qualification');
demandes[0][1]('Faux numero');
ok(P().etape === 'Non qualifie' && C().raisonNq === 'Faux numero', 'Non qualifie + raison');
reset(); ouvrirFiche({ etape: 'Contacte' }); saveDetailEdit();
ok(demandes.length === 0 && !dbUpdates.some(function (u) { return u[2].etape; }), 'meme etape : l\'etape n\'est pas touchee');

console.log('— 4. Choisir le produit : repercute partout');
reset(); ouvrirFiche({ sku: 'AQD-01', qte: 2, entrepot: 'Niamey Centre' }); saveDetailEdit();
ok(P().sku === 'AQD-01' && P().qte === 2 && P().entrepot === 'Niamey Centre', 'produit, quantite et entrepot enregistres dans le Pipeline');
ok(dbUpdates.some(function (u) { return u[0] === 'pipeline' && u[2].sku === 'AQD-01' && u[2].qte === 2; }), '... et en base');
ok(C().produit === '2x AQD-01' && dbUpdates.some(function (u) { return u[0] === 'clients' && u[2].produit === '2x AQD-01'; }), 'fiche Clients & Prospects : « Produit d\'interet » mis a jour');
ok(P().val === 140000, 'valeur estimee calculee depuis le prix (2 x 70 000)', P().val);
reset(); P().val = 55000; ouvrirFiche({ sku: 'AQD-02', qte: 1, entrepot: '' }); saveDetailEdit();
ok(P().val === 55000 && P().entrepot === 'Niamey Centre', 'une valeur choisie a la main n\'est pas ecrasee ; entrepot propose par defaut');
reset(); ouvrirFiche({ sku: 'AQD-01', qte: 1, entrepot: 'Niamey Centre', etape: 'Gagne' }); saveDetailEdit();
ok(P().etape === 'Gagne' && P().reservationFaite && STOCK[0].reserve === 1, 'produit + « Gagne » en meme temps : le BON produit est reserve');
reset('Gagne'); P().sku = 'AQD-01'; P().entrepot = 'Niamey Centre'; P().reservationFaite = true; STOCK[0].reserve = 1; C().statut = 'Client actif';
ouvrirFiche({ sku: 'AQD-02', qte: 1, entrepot: 'Niamey Centre' }); saveDetailEdit();
ok(STOCK[0].reserve === 0 && STOCK[1].reserve === 1 && P().reservationFaite, 'opportunite gagnee : l\'ancien produit est libere, le nouveau reserve');
reset(); ouvrirFiche({ sku: '', qte: 1, entrepot: '' }); saveDetailEdit();
ok(!dbUpdates.some(function (u) { return u[2].sku !== undefined; }), 'rien change : aucune ecriture inutile');

console.log('— 5. Dans l\'autre sens : la fiche client -> le Pipeline');
ok(JSON.stringify(produitUniqueDepuisLabel('3x AQD-02')) === '{"sku":"AQD-02","qte":3}' && produitUniqueDepuisLabel('1x AQD-01, 1x AQD-02') === null && produitUniqueDepuisLabel('-') === null && produitUniqueDepuisLabel('Inconnu') === null, 'lecture de « 3x AQD-02 » (plusieurs produits ou inconnu : ignore)');
const co = clientProduitOptions('2x AQD-01');
ok(co[0].value === '-' && co[1].value === '2x AQD-01' && co[1].selected && co[2].value === '1x AQD-02', 'fiche client : liste des produits, quantite gardee', co);
ok(clientProduitOptions('1x AQD-01, 1x AQD-02')[0].label === '1x AQD-01, 1x AQD-02 (actuel)', 'fiche client : un ancien texte a plusieurs produits reste propose');
ok(/\['Produit', 'produit', clientProduitOptions\(cl\.produit\), 'select'\]/.test(src), 'branchee dans la fiche client');
const sync = grab('function syncClientToPipeline(cl, oldNom){', 'function lignesTotalMontant');
ok(/produitUniqueDepuisLabel\(cl\.produit\)/.test(sync) && /setPipelineProduit\(p, pu\.sku, pu\.qte, p\.entrepot, oldNom\)/.test(sync), 'produit de la fiche client repris dans le Pipeline');
ok(/const puNouveau = produitUniqueDepuisLabel\(cl\.produit\)/.test(sync), '... aussi quand la fiche Pipeline est creee depuis Clients & Prospects');
ok(produitLisible('2x AQD-01') === 'Purificateur Famille (AQD-01) x2', 'fiche client : produit affiche avec son nom', produitLisible('2x AQD-01'));

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
