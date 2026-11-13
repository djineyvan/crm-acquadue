// Teste (13/11/2026, 2e partie) : raison du "Non qualifie", retrait du bouton
// ponctuel, recapitulatif hebdomadaire des taches en retard, bouton du son.
// Faux environnement, aucune donnee reelle.
// Usage : node test-ecran-raison-nq-recap-son.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
// --- faux environnement ---
let CU = { id: 1, nom: 'Yvan' }, superAdmin = true, prospectPerm = false;
function isSuperAdmin() { return superAdmin; } function canModifyProspectInfo() { return prospectPerm; }
let alerts = [], logs = [], dbUpdates = [], confirms = [], confirmAnswer = true, gos = [];
function alert(m) { alerts.push(m); } function confirm(m) { confirms.push(m); return confirmAnswer; }
function logAction(a, d) { logs.push([a, d]); }
function stampModification(p) { p.lastModifiedBy = CU.nom; }
function closeModal() {} function go(v) { gos.push(v); }
function dbUpdate(t, id, patch) { dbUpdates.push([t, id, patch]); }
function syncStockRow() {} function getStockRow() { return null; } function triggerPipelineWon() { return true; }
let PIPELINE = [], CLIENTS = [], TASKS = [], NOTIFICATIONS = [];
// Faux DOM minimal pour la petite fenetre de raison
const DOM = {}; let lastHtml = '';
function el(id) { return DOM[id] || null; }
DOM.app = { insertAdjacentHTML: function (w, h) { lastHtml = h; const m = { style: {}, classList: { add: function () { m.open = true; } }, remove: function () { delete DOM['modal-raison-nq']; } }; DOM['modal-raison-nq'] = m; DOM['raison-nq-select'] = { value: '' }; } };
function modalShell(id, t, b, f) { return '<div id="' + id + '">' + t + b + f + '</div>'; }
function btnGhost(l, o) { return '<button onclick="' + o + '">' + l + '</button>'; } function btnRed(l, o) { return btnGhost(l, o); }
function choisir(r) { DOM['raison-nq-select'].value = r; confirmRaisonNq(); }
const ls = {}; const localStorage = { getItem: function (k) { return ls[k] === undefined ? null : ls[k]; }, setItem: function (k, v) { ls[k] = v; } };
let pushed = [];
function pushNotif(icon, text, target) { const n = { icon: icon, text: text, target: target }; NOTIFICATIONS.unshift(n); pushed.push(n); return n; }
eval(grab('const PIPELINE_STAGES =', '// ── CLIENTS / PROSPECTS').replace(/^const /gm, 'var '));
eval(grab('function pipelineEtapeToClientStatut(etape){', 'function addProspect(){'));
eval(grab('function findLinkedClient(p, oldNom){', 'function findLinkedPipeline'));
eval(grab('function markPipelineLost(id, etapeFinale){', '// Demande explicite : jusqu\'ici, aucune action de suppression'));
function ensureClientExists(nom, prod, statut) { const cl = CLIENTS.find(function (c) { return c.nom === nom; }); if (cl) { cl.statut = statut; if (cl.statut !== 'Non qualifie' && cl.raisonNq) setClientRaisonNq(cl, ''); } }
eval(grab('function todayISO(){', '// ── GLOBAL SEARCH BAR'));
eval(grab('function lundiDeLaSemaineISO(d){', '// Triggers an automatic backup'));
eval(grab('function notifSoundKey(){', 'function updateAllBadges(){').replace('if(!isNotifSoundOn()) return;', 'if(!isNotifSoundOn()) return; played++;')); var played = 0; (0);
eval(grab('function nqDetailMeta(b){', 'function diagMeta(){'));
// Version "enveloppee" (wrapAfter) qui enregistre l'etape en base, comme dans l'application.
var window = { markPipelineLost: function (id, e) { markPipelineLost(id, e); const p = PIPELINE.find(function (x) { return x.id === id; }); if (p) dbUpdate('pipeline', id, { etape: p.etape }); } };

let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function reset() {
  PIPELINE = [
    { id: 1, nom: 'Awa', etape: 'Contacte', ville: 'Niamey' },
    { id: 2, nom: 'Bio', etape: 'Nouveau prospect', ville: 'Zinder' },
    { id: 3, nom: 'Cisse', etape: 'Non qualifie', ville: 'Dosso' }
  ];
  CLIENTS = [
    { id: 101, nom: 'Awa', statut: 'Contacte' },
    { id: 102, nom: 'Bio', statut: 'Nouveau prospect' },
    { id: 103, nom: 'Cisse', statut: 'Non qualifie', raisonNq: 'Hors zone' }
  ];
  alerts = []; logs = []; dbUpdates = []; confirms = []; gos = []; delete DOM['modal-raison-nq'];
}
const P = function (id) { return PIPELINE.find(function (x) { return x.id === id; }); };
const C = function (id) { return CLIENTS.find(function (x) { return x.id === id; }); };

// 1. Bouton « ⊘ Non qualifie » : demande la raison
reset(); markPipelineUnqualified(1);
ok(!!DOM['modal-raison-nq'] && P(1).etape === 'Contacte', 'le bouton ouvre la fenetre de raison, rien ne change avant validation');
RAISONS_NQ.forEach(function (r) { ok(lastHtml.indexOf('>' + r + '<') >= 0, 'raison proposee : ' + r); });
confirmRaisonNq();
ok(/Choisissez une raison/.test(alerts[0] || '') && P(1).etape === 'Contacte', 'valider sans choisir : message, rien ne change');
choisir('Faux numero');
ok(P(1).etape === 'Non qualifie' && C(101).statut === 'Non qualifie', 'apres choix : classe en « Non qualifie »');
ok(C(101).raisonNq === 'Faux numero', 'la raison est enregistree sur la fiche client');
ok(dbUpdates.some(function (u) { return u[0] === 'clients' && u[1] === 101 && u[2].raison_nq === 'Faux numero'; }), 'raison enregistree en base');
ok(dbUpdates.some(function (u) { return u[0] === 'pipeline' && u[2].etape === 'Non qualifie'; }), 'etape enregistree en base');
ok(!DOM['modal-raison-nq'], 'la fenetre se ferme');
reset(); markPipelineUnqualified(1); closeRaisonNq();
ok(P(1).etape === 'Contacte' && dbUpdates.length === 0, '« Annuler » : rien ne change');

// 2. Liste « Changer d'etape » vers Non qualifie
reset(); setPipelineStage(2, 'Non qualifie');
ok(!!DOM['modal-raison-nq'] && confirms.length === 0 && P(2).etape === 'Nouveau prospect', 'vers « Non qualifie » : la raison remplace la confirmation');
choisir('Hors zone');
ok(P(2).etape === 'Non qualifie' && C(102).raisonNq === 'Hors zone', 'changement applique avec la raison « Hors zone »');
reset(); setPipelineStage(2, 'Contacte');
ok(!DOM['modal-raison-nq'] && confirms.length === 1 && P(2).etape === 'Contacte', 'autres etapes : confirmation habituelle, pas de fenetre de raison');

// 3. Quitter « Non qualifie » efface la raison
reset(); setPipelineStage(3, 'Contacte');
ok(P(3).etape === 'Contacte' && C(103).statut === 'Contacte', 'rouvrir un « Non qualifie »');
ok(C(103).raisonNq === '' && dbUpdates.some(function (u) { return u[0] === 'clients' && u[1] === 103 && u[2].raison_nq === ''; }), 'la raison est effacee (et en base)');
reset(); C(103).statut = 'Client actif';
ok(raisonNqOf(C(103)) === '', 'une raison restee sur une fiche non « Non qualifie » n\'est jamais affichee');

// 4. Permissions
reset(); superAdmin = false; prospectPerm = false; markPipelineUnqualified(1);
ok(!DOM['modal-raison-nq'] && /permission/.test(alerts[0] || '') && P(1).etape === 'Contacte', 'sans permission : refuse, pas de fenetre');
superAdmin = true;

// 5. Affichage
reset();
ok(/Hors zone/.test(raisonNqBadge(C(103))), 'badge : raison affichee');
C(103).raisonNq = ''; ok(/non indiquee/.test(raisonNqBadge(C(103))), 'badge : « raison non indiquee » pour les anciennes fiches');
ok(raisonNqBadge(C(101)) === '', 'badge : rien pour les autres statuts');
ok(/raisonNqBadge\(findLinkedClient\(card\)\)/.test(src), 'carte du Pipeline : raison affichee');
ok(/statusTag\(cl\.statut\)\+raisonNqBadge\(cl\)/.test(src), 'liste Clients & Prospects : raison affichee');
ok(/'Raison \(si Non qualifie\)', 'raisonNq'/.test(src), 'fiche client : champ « Raison » modifiable');
ok(/raison_nq:record\.raisonNq/.test(src), 'modification d\'une fiche client : raison enregistree en base');
ok(/client\.statut === 'Non qualifie'/.test(src) && /etape === 'Non qualifie'/.test(src), 'creation directe en « Non qualifie » : la raison est demandee');
ok(/raisonNq:r\.raison_nq/.test(src), 'chargement depuis la base : raison relue');

// 6. Bilan Meta
const b = { non_qualifies: 6, nq_faux_numero: 3, nq_hors_zone: 1, nq_pas_interesse: 0, nq_curieux: 1, nq_autre: 0 };
const t = nqDetailMeta(b);
ok(/3 faux numero/.test(t) && /1 hors zone/.test(t) && /1 curieux/.test(t) && /1 sans raison/.test(t) && !/pas interesse/.test(t), 'bilan Meta : detail des raisons par pub', t);
ok(nqDetailMeta({ non_qualifies: 0 }) === '', 'bilan Meta : rien quand aucun non qualifie');
ok(/nqDetailMeta\(b\)/.test(src), 'bilan Meta : detail branche dans le tableau');

// 7. Bouton ponctuel retire
ok(src.indexOf('migratePerdusHorsNiamey') < 0 && src.indexOf('perdusHorsNiamey') < 0, 'bouton « Perdus hors Niamey » et son code retires');

// 8. Recap hebdomadaire des taches en retard
ok(lundiDeLaSemaineISO(new Date(2026, 10, 13)) === '2026-11-09', 'semaine : vendredi 13/11 -> lundi 09/11');
ok(lundiDeLaSemaineISO(new Date(2026, 10, 15)) === '2026-11-09', 'semaine : dimanche 15/11 -> lundi 09/11');
ok(lundiDeLaSemaineISO(new Date(2026, 10, 16)) === '2026-11-16', 'semaine : lundi 16/11 -> nouvelle semaine');
function resetT() {
  NOTIFICATIONS = []; pushed = [];
  TASKS = [
    { id: 1, titre: 'Rappeler Awa', asg: 'Yvan', date: '2020-01-01', statut: 'A faire' },
    { id: 2, titre: 'Devis Bio', asg: 'Yvan', date: '2020-01-02', statut: 'En cours' },
    { id: 3, titre: 'Visite', asg: 'Nadia', date: '2020-01-03', statut: 'A faire' },
    { id: 4, titre: 'Fini', asg: 'Yvan', date: '2020-01-01', statut: 'Termine' },
    { id: 5, titre: 'Futur', asg: 'Yvan', date: '2099-01-01', statut: 'A faire' },
    { id: 6, titre: 'Install', asg: 'Harouna', date: '2020-02-01', statut: 'A faire' }
  ];
}
resetT(); superAdmin = true; CU = { id: 1, nom: 'Yvan' }; checkTachesEnRetard();
ok(pushed.length === 2, 'Super Admin : 1 recap personnel + 1 recap equipe (au lieu d\'une alerte par tache)', pushed.length);
const perso = pushed.find(function (n) { return /^Recap de la semaine/.test(n.text); });
ok(perso && /2 tache\(s\) en retard/.test(perso.text) && /Rappeler Awa/.test(perso.text) && !/Fini|Futur/.test(perso.text), 'recap personnel : seulement ses taches en retard non terminees', perso && perso.text);
const eq = pushed.find(function (n) { return /^Recap equipe/.test(n.text); });
ok(eq && /4 tache\(s\)/.test(eq.text) && /Harouna 1, Nadia 1, Yvan 2/.test(eq.text), 'recap equipe : total et detail par personne', eq && eq.text);
checkTachesEnRetard(); checkTachesEnRetard();
ok(pushed.length === 2, 'verifications suivantes (toutes les 20 s) : aucun doublon dans la semaine');
NOTIFICATIONS.forEach(function (n) { n.read = true; }); checkTachesEnRetard();
ok(pushed.length === 2, 'meme apres lecture : pas de nouveau recap avant la semaine suivante');
NOTIFICATIONS = NOTIFICATIONS.map(function (n) { return { text: n.text.replace(/semaine du [0-9/]+/, 'semaine du 02/11/2026'), target: n.target }; });
checkTachesEnRetard();
ok(pushed.length === 4, 'nouvelle semaine : nouveau recap');
resetT(); superAdmin = false; CU = { id: 2, nom: 'Nadia' }; checkTachesEnRetard();
ok(pushed.length === 1 && pushed[0].target === 'Nadia' && /1 tache/.test(pushed[0].text), 'membre : seulement son propre recap');
resetT(); CU = { id: 3, nom: 'Moussa' }; checkTachesEnRetard();
ok(pushed.length === 0, 'personne sans tache en retard : aucune notification');
resetT(); TASKS = []; for (let i = 0; i < 8; i++) TASKS.push({ id: i, titre: 'T' + i, asg: 'Moussa', date: '2020-01-01', statut: 'A faire' }); checkTachesEnRetard();
ok(/et 3 autre\(s\)/.test(pushed[0].text), 'plus de 5 taches : liste raccourcie « et 3 autre(s) »');
ok(src.indexOf("'tache-retard-'") < 0, 'anciennes alertes « une par tache » supprimees');
superAdmin = true; CU = { id: 1, nom: 'Yvan' };

// 9. Bouton du son
ok(isNotifSoundOn() === true, 'son active par defaut');
played = 0; playNotifSound(); ok(played === 1, 'son active : le ding joue');
toggleNotifSound(); ok(isNotifSoundOn() === false && gos.indexOf('notifs') >= 0, 'clic : son coupe, ecran rafraichi');
played = 0; playNotifSound(); ok(played === 0 && ls['crm_son_notif_1'] === 'off', 'son coupe : plus de ding, reglage memorise sur l\'appareil');
toggleNotifSound(); ok(isNotifSoundOn() === true, 'reclic : son reactive');
CU = { id: 2, nom: 'Nadia' }; ls['crm_son_notif_1'] = 'off';
ok(isNotifSoundOn() === true, 'reglage propre a chaque personne (Yvan coupe ≠ Nadia)');
ok(/id="btn-son-notif"/.test(src), 'bouton present en haut de l\'ecran Notifications');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
