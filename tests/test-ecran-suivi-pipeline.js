// Teste (18/11/2026) : suivi d'appel sur chaque contact du Pipeline, date de
// reception, et filtre par periode (calendriers). Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-suivi-pipeline.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

// Faux environnement
var CU = { nom: 'Yvan', role: 'superadmin' };
var SUPER = true, PERM_PROSPECT = false;
function isSuperAdmin() { return SUPER; }
function canModifyProspectInfo() { return PERM_PROSPECT; }
var ELEMS = {}; function el(id) { return ELEMS[id] || null; }
function fcfa(v) { return v + ' FCFA'; }
function formatDateFr(iso) { if (!iso) return '-'; const p = iso.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function stampModification(r) { r.lastModifiedBy = CU.nom; r.lastModifiedAt = new Date(); }
var UPDATES = [], LOGS = [], BOARD = 0, ALERTES = [];
function dbUpdate(e, id, patch) { UPDATES.push({ e: e, id: id, patch: patch }); }
function logAction(a, d) { LOGS.push(a + ' | ' + d); }
function renderPipeBoard() { BOARD++; }
function alert(m) { ALERTES.push(m); }
var PIPELINE = [];

eval(grab('const PIPE_RESULTATS_APPEL', '// Statuts Clients & Prospects').replace(/^const /gm, 'var '));
eval(grab('let PIPE_DATE_DU', 'function renderPipe(c){').replace(/^let /gm, 'var '));
eval(grab('function pipeCardSuiviHtml(p){', 'function viewPipeCard(id){').replace(/^const /gm, 'var '));

console.log('— 1. Date de reception');
const t = new Date(2026, 10, 17, 9, 5).getTime();
ok(pipeDateRecuISO({ id: t }) === '2026-11-17', 'tiree de l\'identifiant (heure de creation)', pipeDateRecuISO({ id: t }));
ok(pipeDateRecuTexte({ id: t }) === '17/11/2026' && pipeDateRecuTexte({ id: t }, true) === '17/11/2026 a 09h05', 'affichage jj/mm/aaaa (+ heure dans la fiche)', pipeDateRecuTexte({ id: t }, true));
ok(pipeDateRecuISO({ id: 12, createdAt: '2026-10-02T10:00:00' }) === '2026-10-02', 'ancienne fiche (petit identifiant) : date de la base');
ok(pipeDateRecuTexte({ id: 12 }) === '-', 'aucune date connue : tiret');

console.log('— 2. Changer le filtre = livraison + 90 jours');
ok(pipeChangerFiltreISO({ dateLivraison: '2026-11-20' }) === '2027-02-18', '20/11/2026 + 90 j = 18/02/2027', pipeChangerFiltreISO({ dateLivraison: '2026-11-20' }));
ok(pipeChangerFiltreISO({ dateLivraison: '' }) === '' && pipeJoursAvantFiltre({}) === null, 'sans livraison : rien');
const d = new Date(); d.setDate(d.getDate() - 85);
const iso85 = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
ok(pipeJoursAvantFiltre({ dateLivraison: iso85 }) === 5, 'livre il y a 85 jours : filtre dans 5 jours', pipeJoursAvantFiltre({ dateLivraison: iso85 }));

console.log('— 3. Filtre par periode');
const a = { id: new Date(2026, 10, 10, 12).getTime() }, b = { id: new Date(2026, 10, 17, 23, 30).getTime() }, c = { id: 5 };
ok(pipeDansPeriode(a) && pipeDansPeriode(c), 'sans periode : tout le monde passe');
setPipePeriode('2026-11-15', '2026-11-17');
ok(!pipeDansPeriode(a) && pipeDansPeriode(b) && !pipeDansPeriode(c), 'du 15 au 17/11 : seul le contact du 17 (23h30 compris), pas les fiches sans date');
setPipePeriode('2026-11-17', '2026-11-10');
ok(PIPE_DATE_DU === '2026-11-10' && PIPE_DATE_AU === '2026-11-17', 'dates inversees : remises dans l\'ordre');
setPipePeriode('2026-11-12', '');
ok(!pipeDansPeriode(a) && pipeDansPeriode(b), 'seulement « du » : a partir de cette date');
setPipePeriodeRapide('auj');
ok(PIPE_DATE_DU === PIPE_DATE_AU && PIPE_DATE_DU === pipeIsoLocal(new Date()) && PIPE_PERIODE_RAPIDE === 'auj', 'raccourci « Aujourd\'hui »');
setPipePeriodeRapide('7j');
ok(Math.round((new Date(PIPE_DATE_AU) - new Date(PIPE_DATE_DU)) / 86400000) === 6, 'raccourci « 7 derniers jours » (aujourd\'hui compris)');
setPipePeriodeRapide('moisprec');
ok(/-01$/.test(PIPE_DATE_DU) && PIPE_DATE_AU > PIPE_DATE_DU && PIPE_DATE_AU.slice(0, 7) === PIPE_DATE_DU.slice(0, 7), 'raccourci « Le mois dernier » : du 1er au dernier jour', [PIPE_DATE_DU, PIPE_DATE_AU]);
setPipePeriode('', '');
ok(!PIPE_DATE_DU && !PIPE_DATE_AU && PIPE_PERIODE_RAPIDE === '', '« Effacer » retire le filtre');

console.log('— 4. Carte du Pipeline');
let h = pipeCardSuiviHtml({ id: t, quartier: 'Plateau', pub: 'V2', appele: true, relanceJ2: true, resultatAppel: 'Interesse' });
ok(/Recu le 17\/11\/2026/.test(h) && /Plateau/.test(h) && /Pub V2/.test(h), 'date de reception, quartier et pub affiches');
ok(/Appele/.test(h) && /J\+2/.test(h) && !/Rappel soir/.test(h) && /Interesse/.test(h), 'seules les cases cochees + le resultat');
h = pipeCardSuiviHtml({ id: t, quartier: '<img src=x onerror=1>' });
ok(h.indexOf('<img') < 0, 'quartier affiche sans danger');
h = pipeCardSuiviHtml({ id: t, dateLivraison: iso85, montant: 30000 });
ok(/Livre le/.test(h) && /30000 FCFA/.test(h) && /filtre le/.test(h), 'livraison, montant et alerte filtre bientot');
const d2 = new Date(); d2.setDate(d2.getDate() - 100);
h = pipeCardSuiviHtml({ id: t, dateLivraison: pipeIsoLocal(d2) });
ok(/filtre en retard/.test(h), 'filtre en retard signale en rouge');

console.log('— 5. Enregistrement du suivi');
ELEMS['pipe-board'] = {}; const BOARD0 = BOARD;
PIPELINE = [{ id: 42, nom: 'Ali', asg: 'Harouna', appele: false, montant: null, dateLivraison: '' }];
savePipeSuivi(42, 'appele', true);
ok(PIPELINE[0].appele === true && UPDATES.length === 1 && UPDATES[0].patch.appele === true && UPDATES[0].patch.last_modified_by === 'Yvan', 'case « Appele » : enregistree en base avec l\'auteur', UPDATES[0]);
ok(LOGS.length === 1 && /Appele → Oui/.test(LOGS[0]) && BOARD === BOARD0 + 1, 'trace dans le journal + carte mise a jour', LOGS);
savePipeSuivi(42, 'appele', true);
ok(UPDATES.length === 1, 'meme valeur : rien de renvoye');
savePipeSuivi(42, 'montant', '30 000');
ok(UPDATES[1].patch.montant === 30000, 'montant « 30 000 » compris comme 30000');
savePipeSuivi(42, 'dateLivraison', '2026-11-20');
ok(UPDATES[2].patch.date_livraison === '2026-11-20', 'date de livraison enregistree (colonne date_livraison)');
savePipeSuivi(42, 'resultatAppel', 'Nimporte quoi');
ok(PIPELINE[0].resultatAppel === '', 'resultat inconnu refuse (reste vide)');
savePipeSuivi(42, 'champInconnu', 'x');
ok(UPDATES.length === 3 || UPDATES.length === 4, 'champ inconnu ignore');
const nb = UPDATES.length;
SUPER = false; CU = { nom: 'Moussa', role: 'collaborateur' };
savePipeSuivi(42, 'rappelSoir', true);
ok(UPDATES.length === nb && ALERTES.length === 1 && PIPELINE[0].rappelSoir !== true, 'un autre commercial ne peut pas modifier la fiche d\'Harouna');
CU = { nom: 'Harouna', role: 'collaborateur' };
savePipeSuivi(42, 'rappelSoir', true);
ok(UPDATES.length === nb + 1 && PIPELINE[0].rappelSoir === true, 'le commercial de la fiche peut remplir son suivi');
CU = { nom: 'Moussa', role: 'admin' }; PERM_PROSPECT = true;
ok(peutSuivrePipe(PIPELINE[0]), 'un role avec « Modifier informations prospect » peut aussi');
PERM_PROSPECT = false;
const bloc = pipeSuiviBlocHtml(PIPELINE[0]);
ok(!/<input/.test(bloc) && /Rappel soir/.test(bloc) && /✅ Oui/.test(bloc), 'sans droit : suivi visible en lecture seule');
SUPER = true; CU = { nom: 'Yvan', role: 'superadmin' };
const bloc2 = pipeSuiviBlocHtml(PIPELINE[0]);
ok(/type="checkbox"/.test(bloc2) && /type="date"/.test(bloc2) && /pipe-suivi-filtre/.test(bloc2) && /18\/02\/2027/.test(bloc2), 'avec droit : cases, calendrier de livraison et « Changer le filtre le » calcule');

console.log('— 6. Branchements dans la page');
ok(/\.filter\(pipeDansPeriode\)/.test(src), 'le tableau du Pipeline applique le filtre de periode');
ok(/id="pipe-date-du"/.test(src) && /id="pipe-date-au"/.test(src) && /type="date" id="pipe-date-du"/.test(src), 'deux calendriers « du » / « au » dans la barre du Pipeline');
ok(/\['Date de reception', '📥 ' \+ pipeDateRecuTexte\(p, true\)\]/.test(src), 'date de reception dans la fiche detaillee');
ok(/id="pipe-suivi-bloc"/.test(src) && /\+ pipeSuiviBlocHtml\(p\) \+/.test(src), 'bloc « Suivi d\'appel » dans la fiche detaillee (pleine largeur)');
ok(/pipeCardSuiviHtml\(card\)/.test(src), 'suivi affiche sur chaque carte');
ok(/relanceJ2:r\.relance_j2===true/.test(src) && /createdAt:r\.created_at/.test(src), 'colonnes relues depuis la base');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
