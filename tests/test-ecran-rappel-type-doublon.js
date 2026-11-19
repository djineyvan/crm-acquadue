// Teste (19/11/2026, 2e partie) : jour de rappel + cause dans le suivi d'appel ;
// choix B2B / B2C dans la fiche Pipeline ; lead Meta deja connu visible ;
// bouton « ✉️ Email » des comptes. Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-rappel-type-doublon.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

var CU = { nom: 'Yvan', role: 'superadmin' };
function isSuperAdmin() { return true; } function canModifyProspectInfo() { return true; }
var ELEMS = {}; function el(id) { return ELEMS[id] || null; }
function fcfa(v) { return v + ' FCFA'; }
function formatDateFr(iso) { if (!iso) return '-'; const p = iso.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function stampModification(r) { r.lastModifiedBy = CU.nom; }
var UPDATES = [], LOGS = [];
function dbUpdate(e, id, patch) { UPDATES.push({ e: e, id: id, patch: patch }); }
function logAction(a, d) { LOGS.push(a + ' | ' + d); }
function renderPipeBoard() {} function alert() {}
var PIPELINE = [], CLIENTS = [];
eval(grab('const PIPELINE_STAGES =', '\n').replace(/^const /, 'var '));
eval(grab('const PIPELINE_CLOSED_STAGES', '\n').replace(/^const /, 'var '));
function isPipelineClosed(e) { return PIPELINE_CLOSED_STAGES.indexOf(e) >= 0; }
eval(grab('const PIPE_RESULTATS_APPEL', '// Statuts Clients & Prospects').replace(/^const /gm, 'var '));
eval(grab('// Nombre de jours avant le rappel demande', 'function viewPipeCard(id){').replace(/^const /gm, 'var '));
eval(grab('function estLeadMeta(cl){', 'function leadMetaRows(cl){'));
function leadEsc(v) { return String(v); } function leadDateTexte() { return ''; } function leadNomEtId() { return ''; } function origineLeadHtml() { return ''; }
eval(grab('function leadMetaRows(cl){', '// « Produit d\'interet » de la fiche client'));
eval(grab('function findLinkedClient(p, oldNom){', 'function findLinkedPipeline'));
const iso = function (dec) { const d = new Date(); d.setDate(d.getDate() + dec); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

console.log('— 1. Jour de rappel + cause');
PIPELINE = [{ id: 1, nom: 'Awa', etape: 'Contacte', asg: 'Yvan' }];
savePipeSuivi(1, 'rappelDate', iso(3));
ok(PIPELINE[0].rappelDate === iso(3) && UPDATES.some(function (u) { return u.patch.rappel_date === iso(3); }), 'jour de rappel enregistre tout de suite (base : rappel_date)');
savePipeSuivi(1, 'rappelCause', '  Rappeler apres la paie  ');
ok(PIPELINE[0].rappelCause === 'Rappeler apres la paie' && UPDATES.some(function (u) { return u.patch.rappel_cause === 'Rappeler apres la paie'; }), 'cause enregistree (base : rappel_cause)');
savePipeSuivi(1, 'rappelDate', 'pas une date');
ok(PIPELINE[0].rappelDate === '', 'date invalide : videe');
savePipeSuivi(1, 'rappelCause', 'x'.repeat(500));
ok(PIPELINE[0].rappelCause.length === 300, 'cause limitee a 300 caracteres');
ok(LOGS.some(function (l) { return /Jour de rappel/.test(l); }) && LOGS.some(function (l) { return /Cause du rappel/.test(l); }), 'notes dans le Journal');
const bloc = pipeSuiviBlocHtml({ id: 1, asg: 'Yvan', rappelDate: iso(3), rappelCause: 'apres la paie' });
ok(/📅 Jour de rappel<\/span><input type="date"[^>]*value="[0-9-]+"[^>]*savePipeSuivi\(1,'rappelDate'/.test(bloc) && /Cause du rappel<\/span><input type="text"[^>]*value="apres la paie"[^>]*savePipeSuivi\(1,'rappelCause'/.test(bloc), 'fiche : case calendrier, puis la cause juste en dessous');
ok(bloc.indexOf('Jour de rappel') < bloc.indexOf('Cause du rappel') && bloc.indexOf('Resultat de l') < bloc.indexOf('Jour de rappel'), 'dans l\'ordre : resultat, jour de rappel, cause');
ok(/rappelDate:r\.rappel_date\|\|'', rappelCause:r\.rappel_cause\|\|''/.test(src), 'relus depuis la base');

console.log('— 2. Alerte sur la carte');
ok(pipeJoursAvantRappel({ rappelDate: iso(0), etape: 'Contacte' }) === 0 && pipeJoursAvantRappel({ rappelDate: iso(-2), etape: 'Contacte' }) === -2 && pipeJoursAvantRappel({ rappelDate: '', etape: 'Contacte' }) === null, 'jours avant le rappel');
ok(pipeJoursAvantRappel({ rappelDate: iso(-2), etape: 'Gagne' }) === null, 'affaire terminee : plus d\'alerte');
let c = pipeCardSuiviHtml({ id: 2, rappelDate: iso(0), rappelCause: 'voir son mari', etape: 'Contacte' });
ok(/A rappeler aujourd'hui/.test(c) && /voir son mari/.test(c) && /var\(--gold\)/.test(c), 'le jour J : « 📞 A rappeler aujourd\'hui » en orange, avec la cause');
c = pipeCardSuiviHtml({ id: 2, rappelDate: iso(-1), etape: 'Contacte' });
ok(/Rappel en retard/.test(c) && /var\(--red\)/.test(c), 'date depassee : en rouge');
c = pipeCardSuiviHtml({ id: 2, rappelDate: iso(5), etape: 'Contacte' });
ok(/📅 Rappel le/.test(c), 'plus tard : « 📅 Rappel le … »');
c = pipeCardSuiviHtml({ id: 2, rappelCause: '<b>x</b>', rappelDate: iso(1), etape: 'Contacte' });
ok(c.indexOf('<b>x</b>') < 0, 'cause affichee sans danger');
ok(/'Jour de rappel','Cause du rappel'/.test(src), 'colonnes dans l\'export CSV');

console.log('— 3. Lead Meta deja connu');
const cl1 = { nom: 'Awa', source: 'Meta Ads', origineLead: 'Tel : 1\n\n[Nouveau formulaire Meta — recu le 16/11/2026, pub « V3 »]\nTel : 1\n\n[Nouveau formulaire Meta — recu le 18/11/2026]\nQuartier : X' };
ok(nbFormulairesMeta(cl1) === 3 && doublonMetaTexte(cl1) === '🔁 Formulaire Meta rempli 3 fois (dernier le 18/11/2026)', 'compte les formulaires et donne la derniere date', doublonMetaTexte(cl1));
ok(nbFormulairesMeta({ source: 'Meta Ads', origineLead: 'Tel : 1' }) === 1 && doublonMetaTexte({ source: 'Meta Ads' }) === '', 'un seul formulaire : rien a signaler');
ok(nbFormulairesMeta({ source: 'Prospection terrain' }) === 0, 'contact non Meta : 0');
ok(leadMetaRows(cl1).some(function (r) { return r[0] === 'Lead deja connu' && /3 fois/.test(r[1]); }), 'fiche client : ligne « Lead deja connu »');
CLIENTS = [cl1]; c = pipeCardSuiviHtml({ id: 3, nom: 'awa', etape: 'Contacte' });
ok(/🔁 Formulaire Meta rempli 3 fois/.test(c), 'carte du Pipeline : 🔁 en haut');
ok(/rows\.splice\(iPub >= 0 \? iPub : rows\.length, 0, \['Lead deja connu'/.test(src), 'fiche Pipeline : ligne « Lead deja connu »');

console.log('— 4. B2B / B2C dans la fiche Pipeline');
const fiche = grab('function viewPipeCard(id){', 'function advancePipelineStage');
ok(/\['Type', 'type', \[\{label:'B2C'/.test(fiche) && /'Type':'type'/.test(fiche), 'case « Type » B2C / B2B a sa place dans la fiche');
ok(/dbUpdate\('pipeline', record\.id, \{ nom:record\.nom, type:record\.type,/.test(src), 'enregistre en base');
const sync = grab('function syncPipelineToClient(p, oldNom){', '// ── DETECTION DE DOUBLONS');
ok(/if\(p\.type && cl\.type !== p\.type\)\{ cl\.type = p\.type;/.test(sync) && /type:cl\.type/.test(sync), 'repercute sur la fiche Clients & Prospects');

console.log('— 5. Email des comptes');
ok(/onclick="changerEmailUtilisateur\('\+u\.id\+'\)">✉️ Email/.test(src) && /if\(isSuperAdmin\(\)\) actions \+= '<button[^']*changerEmailUtilisateur/.test(src), 'bouton « ✉️ Email » pour chaque compte, y compris le sien (Super Admin)');
ok(/action: 'update_email', value: nouvel/.test(src), 'envoye au serveur (update_email)');
ok(!/acquadue\.ne", pass:/.test(src) && src.indexOf('djineyvan@') < 0, 'aucune adresse personnelle ecrite dans le code');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
