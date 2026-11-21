// Teste la nouvelle etape « A relancer » (21/11/2026, demande explicite) cote ecran.
// Elle se place entre « Contacte » et « Offre envoyee », dans le Pipeline ET dans
// le parcours du prospect (Clients & Prospects).
// Usage : node test-ecran-a-relancer.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
const window = globalThis;
let CU = { nom: 'Yvan' }, superAdmin = true, prospectPerm = false;
function isSuperAdmin() { return superAdmin; } function canModifyProspectInfo() { return prospectPerm; }
let alerts = [], logs = [], synced = [], dbUpdates = [], html = {};
function alert(m) { alerts.push(m); } function confirm() { return true; }
function logAction(a, d, c) { logs.push([a, d, c]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; }
function ensureClientExists(nom, prod, statut) { synced.push([nom, statut]); }
function closeModal() {} function go() {} function triggerPipelineWon() { return true; }
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
function el(id) { if (!html[id]) html[id] = { innerHTML: '' }; return html[id]; }
function fcfa(v) { return v + ' F'; } function searchMatch() { return true; } function visiblePipeFilter() { return true; }
var PIPE_DATE_DU = '', PIPE_DATE_AU = ''; function pipeDansPeriode() { return true; }
function isResponsableOrAbove() { return false; } let PIPE_TYPE_FILTER = 'Tous', PIPE_AGENT_FILTER = 'Tous';
function tag(t, c) { return '<span class="' + c + '">' + t + '</span>'; }
function raisonNqBadge() { return ''; } function raisonPerteBadge() { return ''; } function findLinkedClient() { return null; }
function pipeCardSuiviHtml() { return ''; }
let STOCK = [], PIPELINE = [], CLIENTS = [];
eval(grab('const PIPELINE_STAGES =', '// ── CLIENTS / PROSPECTS').replace(/^const /gm, 'var '));
eval(grab('function statusTag(s){', '\n}\n') + '\n}');
eval(grab('function renderPipeBoard(){', 'function viewPipeCard(id){'));
eval(grab('function advancePipelineStage(id){', '// Demande explicite : jusqu\'ici, aucune action de suppression'));
eval(grab('function clientStatutToPipelineEtape(statut){', 'function syncClientToPipeline'));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));

let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

// 1. Place de l'etape
const iC = PIPELINE_STAGES.indexOf('Contacte');
ok(PIPELINE_STAGES[iC + 1] === 'A relancer' && PIPELINE_STAGES[iC + 2] === 'Offre envoyee', 'Pipeline : « A relancer » juste apres « Contacte », avant « Offre envoyee »', PIPELINE_STAGES);
const jC = CLIENT_STATUTS.indexOf('Contacte');
ok(CLIENT_STATUTS[jC + 1] === 'A relancer' && CLIENT_STATUTS[jC + 2] === 'Offre envoyee', 'parcours du prospect : meme place dans Clients & Prospects', CLIENT_STATUTS);
ok(!isPipelineClosed('A relancer'), '« A relancer » n\'est pas une etape finale (le prospect reste en cours)');
ok(/tag-orange/.test(statusTag('A relancer')) && /\.tag-orange\{/.test(src) && /--orange:#/.test(src), 'etiquette orange « A relancer »');

// 2. Colonne visible dans le tableau
PIPELINE = [
  { id: 1, nom: 'Awa', etape: 'Contacte', val: 30000, type: 'B2C', ville: 'Niamey', asg: 'Harouna X' },
  { id: 2, nom: 'Bio', etape: 'A relancer', val: 50000, type: 'B2C', ville: 'Maradi', asg: 'Harouna X' },
  { id: 3, nom: 'Cisse', etape: 'Offre envoyee', val: 70000, type: 'B2B', ville: 'Niamey', asg: 'Nadia Y' }
];
renderPipeBoard();
const board = html['pipe-board'].innerHTML;
const titres = (board.match(/<span style="color:var\(--[a-z0-9]+\)">[^<]+<\/span>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); });
ok(titres.join() === PIPELINE_STAGES.join(), 'les 8 colonnes s\'affichent dans le bon ordre', titres);
ok(/color:var\(--orange\)">A relancer</.test(board), 'titre de la colonne « A relancer » en orange');
const colR = board.slice(board.indexOf('>A relancer<'), board.indexOf('>Offre envoyee<'));
ok(/Bio/.test(colR) && !/Awa/.test(colR) && !/Cisse/.test(colR), 'la fiche « A relancer » est dans sa colonne, et seulement elle');
ok(/Total: 50000 F/.test(colR), 'total de la colonne calcule');

// 3. « Faire avancer » passe par la nouvelle etape
advancePipelineStage(1);
ok(PIPELINE[0].etape === 'A relancer', '« Faire avancer » : Contacte -> A relancer', PIPELINE[0].etape);
advancePipelineStage(2);
ok(PIPELINE[1].etape === 'Offre envoyee', '« Faire avancer » : A relancer -> Offre envoyee', PIPELINE[1].etape);

// 4. Correspondance Pipeline <-> Clients & Prospects
ok(pipelineEtapeToClientStatut('A relancer') === 'A relancer' && clientStatutToPipelineEtape('A relancer') === 'A relancer', 'meme mot dans les deux ecrans (aller-retour)');
ok(CLIENT_STATUTS.every(function (s) { return PIPELINE_STAGES.indexOf(clientStatutToPipelineEtape(s)) >= 0; }), 'chaque statut client correspond toujours a une colonne du Pipeline');

// 5. Autres endroits
ok(/\{label:'A relancer',selected:cl\.statut==='A relancer'\}/.test(src), 'fiche Clients & Prospects : choix « A relancer » dans « Statut »');
ok(/fieldSelect\('pr-etape','Etape',PIPELINE_STAGES\)/.test(src) && /fieldSelect\('cl-statut','Statut',CLIENT_STATUTS\)/.test(src), 'formulaires « Nouveau prospect » et « Nouveau client » : choix « A relancer »');
ok(/const statuts = CLIENT_STATUTS;/.test(src), 'filtre « Statut » de Clients & Prospects : « A relancer »');
ok(/repeat\(8,1fr\)/.test(src) && /repeat\(8,200px\)/.test(src), 'mise en page : 8 colonnes sur ordinateur et sur telephone');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
