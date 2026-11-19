// Teste (18/11/2026) : fiches modifiables DES L'OUVERTURE (plus de bouton
// « Modifier »), bouton « 💾 Enregistrer », puis « ✓ Enregistre ».
// Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-fiche-directe.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

// Faux environnement
var CU = { nom: 'Yvan', role: 'superadmin' }, SUPER = true;
function isSuperAdmin() { return SUPER; }
function canEditRecord() { return false; }
var ELEMS = {}; function el(id) { return ELEMS[id] || null; }
function btnGhost(t, a) { return '<button class="btn btn-ghost" onclick="' + a + '">' + t + '</button>'; }
function btnRed(t, a) { return '<button class="btn btn-red" onclick="' + a + '">' + t + '</button>'; }
function modStampHtml() { return ''; }
var FERMES = 0, CONFIRM = true, CONFIRMS = 0, LOGS = [], SYNC = [], TIMERS = [];
function closeModal(id) { FERMES++; }
function confirm() { CONFIRMS++; return CONFIRM; }
function stampModification(r) { r.lastModifiedBy = CU.nom; }
function logAction(a, d) { LOGS.push(d); }
function setTimeout(f) { TIMERS.push(f); }
var MODAL_HTML = '';
function modalShell(id, t, body, footer) { MODAL_HTML = body + '||' + footer; return ''; }
function openModal() {}
function refreshSensitivePerms() { return { then: function () {} }; }

eval(grab('let DETAIL_CTX = null;', 'function syncDetailEditToDb').replace('let DETAIL_CTX', 'var DETAIL_CTX'));
function syncDetailEditToDb(e, r) { SYNC.push(e + ':' + r.tel + ':' + r.notes); }
ELEMS.app = { insertAdjacentHTML: function () {} };

const rows = [['Nom du prospect', 'Ali'], ['Telephone', '+227 1'], ['Notes', '-'], ['Action', '<button>Changer</button>']];
const fields = [['Nom', 'nom', 'Ali'], ['Telephone', 'tel', '+227 1'], ['Notes', 'notes', 'a < b', 'textarea'], ['Date estimee', 'dateEstimee', '2026-12-01', 'date'], ['SKU', 'sku', 'X', 'readonly']];
const cfg = { record: { id: 1, nom: 'Ali', tel: '+227 1', notes: '' }, entity: 'pipeline', owner: 'Harouna', fields: fields,
  rowKeys: { 'Nom du prospect': 'nom', 'Telephone': 'tel', 'Notes': 'notes' } };

console.log('— 1. Tableau de la fiche');
let h = detailTableHtml(rows, cfg, true);
ok(/id="detail-edit-nom"/.test(h) && /id="detail-edit-tel"/.test(h) && /<textarea[^>]*id="detail-edit-notes"/.test(h), 'cases modifiables a leur place (nom, telephone, notes)');
ok(h.indexOf('detail-edit-tel') < h.indexOf('detail-edit-notes') && h.indexOf('detail-edit-notes') < h.indexOf('Changer'), 'ordre de la fiche respecte, boutons d\'action gardes en dessous');
ok(/type="date" class="form-input" id="detail-edit-dateEstimee"[^>]*value="2026-12-01"/.test(h), 'champ sans ligne (date estimee) ajoute, avec un calendrier');
ok(h.indexOf('detail-edit-dateEstimee') < h.indexOf('Changer'), '... juste apres la derniere case modifiable');
ok(!/detail-edit-sku/.test(h), 'champ « non modifiable » jamais transforme en case');
ok(/a &lt; b/.test(h), 'texte des notes affiche sans danger');
ok(/oninput="markDetailDirty\(\)"/.test(h), 'chaque case signale qu\'elle a ete modifiee');
h = detailTableHtml(rows, cfg, false);
ok(!/detail-edit-/.test(h) && /Changer/.test(h), 'sans le droit de modifier : fiche en lecture seule');
const h2 = detailTableHtml([['Ville / Zone', 'Niamey']], { fields: [['Ville', 'ville', 'Niamey'], ['Zone / Quartier', 'zone', '']], rowKeys: { 'Ville / Zone': ['ville', 'zone'] } }, true);
ok(/detail-edit-ville/.test(h2) && /detail-edit-zone/.test(h2) && /Zone \/ Quartier/.test(h2), 'une ligne peut contenir deux cases (Ville / Zone)');

console.log('— 2. Ouverture de la fiche');
openDetailModal('Detail — Ali', rows, cfg);
ok(/detail-edit-tel/.test(MODAL_HTML) && /💾 Enregistrer/.test(MODAL_HTML) && !/Modifier/.test(MODAL_HTML.split('||')[1]), 'Super Admin : cases modifiables tout de suite, bouton « Enregistrer » (plus de « Modifier »)');
ok(DETAIL_CTX.inline === true && DETAIL_CTX.dirty === false, 'fiche en mode modification, rien de change pour l\'instant');
SUPER = false; CU = { nom: 'Harouna', role: 'collaborateur' };
openDetailModal('Detail — Ali', rows, cfg);
ok(/detail-edit-tel/.test(MODAL_HTML), 'le commercial de la fiche peut aussi modifier directement');
CU = { nom: 'Moussa', role: 'collaborateur' };
openDetailModal('Detail — Ali', rows, cfg);
ok(!/detail-edit-/.test(MODAL_HTML) && !/Enregistrer/.test(MODAL_HTML) && DETAIL_CTX.inline === false, 'un autre commercial : lecture seule, seulement « Fermer »');
SUPER = true; CU = { nom: 'Yvan', role: 'superadmin' };

console.log('— 3. Enregistrer');
openDetailModal('Detail — Ali', rows, cfg);
ELEMS['detail-save-btn'] = { innerHTML: '💾 Enregistrer', style: {} };
markDetailDirty();
ok(DETAIL_CTX.dirty && /Enregistrer les modifications/.test(ELEMS['detail-save-btn'].innerHTML), 'apres une modification, le bouton le rappelle');
ELEMS['detail-edit-nom'] = { value: 'Ali' }; ELEMS['detail-edit-tel'] = { value: '+227 90' }; ELEMS['detail-edit-notes'] = { value: 'Rappeler' }; ELEMS['detail-edit-dateEstimee'] = { value: '2026-12-05' };
const f0 = FERMES;
saveDetailEdit();
ok(cfg.record.tel === '+227 90' && cfg.record.notes === 'Rappeler' && cfg.record.dateEstimee === '2026-12-05', 'les valeurs saisies sont enregistrees dans la fiche', cfg.record);
ok(SYNC.length === 1 && /pipeline:\+227 90:Rappeler/.test(SYNC[0]), 'envoyees a la base');
ok(/Enregistre/.test(ELEMS['detail-save-btn'].innerHTML) && ELEMS['detail-save-btn'].disabled === true && FERMES === f0, 'le bouton devient « ✓ Enregistre »');
TIMERS.forEach(function (f) { f(); });
ok(FERMES === f0 + 1, 'puis la fiche se ferme');

console.log('— 4. Fermer sans avoir enregistre');
openDetailModal('Detail — Ali', rows, cfg); ELEMS['detail-save-btn'] = { innerHTML: '', style: {} };
let c0 = CONFIRMS, n0 = SYNC.length, g0 = FERMES;
closeDetailModal();
ok(CONFIRMS === c0 && FERMES === g0 + 1 && SYNC.length === n0, 'rien de modifie : se ferme sans question');
openDetailModal('Detail — Ali', rows, cfg); markDetailDirty(); CONFIRM = false; c0 = CONFIRMS; g0 = FERMES;
closeDetailModal();
ok(CONFIRMS === c0 + 1 && FERMES === g0 + 1 && SYNC.length === n0, 'modifie puis « Fermer » : question posee ; « Annuler » ferme sans enregistrer');
openDetailModal('Detail — Ali', rows, cfg); markDetailDirty(); CONFIRM = true;
closeDetailModal();
ok(SYNC.length === n0 + 1, '... « OK » enregistre');

console.log('— 5. Branchements dans la page');
ok(/rowKeys: \{ 'Nom du prospect':'nom', 'Type':'type', 'Ville':'ville', 'Telephone':'tel', 'Valeur estimee':'val',\s*'Date estimee de signature':'dateEstimee', 'Notes':'notes', 'Etape du pipeline':'etape',\s*'Produit lie':\['sku','qte'\], 'Entrepot concerne':'entrepot' \}/.test(src), 'Pipeline : nom, type, ville, telephone, valeur, date estimee, notes, etape, produit, entrepot');
ok(/rowKeys: \{ 'Nom':'nom', 'Type':'type', 'Ville \/ Zone':\['ville','zone'\]/.test(src) && /'Statut':\['statut','raisonNq','raisonPerte'\]/.test(src), 'Clients & Prospects : toutes les cases modifiables');
ok(/entity: 'tasks',[\s\S]{0,80}rowKeys:/.test(src) && /entity: 'produits',\s*rowKeys:/.test(src) && /entity: 'stock',\s*rowKeys:/.test(src), 'Taches, Produits et Stock aussi');
ok(/'date'\],/.test(grab('function viewPipeCard(id){', 'function deletePipeline')) || /\? 'date' : 'text'\]/.test(src), 'date estimee de signature : calendrier');
ok(/if\(cl\.asg\) noms\.push\(cl\.asg\);/.test(src), 'commercial assigne : le nom actuel reste dans la liste (pas efface a l\'enregistrement)');
ok(/croix\.setAttribute\('onclick', 'closeDetailModal\(\)'\)/.test(src), 'la croix ✕ verifie aussi les modifications non enregistrees');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
