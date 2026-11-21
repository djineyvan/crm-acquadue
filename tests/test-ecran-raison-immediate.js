// Tests du 19/11/2026 (5e partie) :
// 1) « il faut enregistrer deux fois » : l'actualisation automatique ne part pas
//    pendant un enregistrement ; dbUpdate refait un essai apres une erreur serveur.
// 2) la raison de « Perdu » / « Non qualifie » est demandee DES le choix dans la
//    liste (fiche Pipeline et fiche Clients & Prospects), et n'est plus redemandee
//    a l'enregistrement.
// Usage : node tests/test-ecran-raison-immediate.js /tmp/crm-acquadue/index.html
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(start, end) { const i = src.indexOf(start), j = src.indexOf(end, i); if (i < 0 || j < 0) throw new Error('introuvable ' + start); return src.slice(i, j); }
const code = grab('function pipeRaisonChoisieHtml(', "// Apres l'enregistrement des cases")
  + grab('function detailInputHtml(f){', 'function detailTableHtml(')
  + grab('function dbUpdate(', 'function dbDelete(')
  + grab('function autoRefreshTick(){', 'setInterval(autoRefreshTick');

// --- faux environnement ---
const PIPELINE_STAGES = ['Nouveau prospect', 'Contacte', 'A relancer', 'Offre envoyee', 'En negociation', 'Gagne', 'Perdu', 'Non qualifie'];
let ELS = {}, DETAIL_CTX = null, demandes = [], dirty = 0;
function fauxEl(id, value) { const o = { id: id, value: value, apres: '', insertAdjacentHTML(pos, html) { this.apres += html; const m = /id="([^"]+)"/.exec(html); if (m) ELS[m[1]] = { remove() { delete ELS[m[1]]; } }; } }; ELS[id] = o; return o; }
function el(id) { return ELS[id] || null; }
function pipeEsc(s) { return String(s); }
function markDetailDirty() { dirty++; }
function askRaisonNq(nom, onOk, onAnnule) { demandes.push({ type: 'nq', nom: nom, onOk: onOk, onAnnule: onAnnule }); }
function askRaisonPerte(nom, onOk, onAnnule) { demandes.push({ type: 'perte', nom: nom, onOk: onOk, onAnnule: onAnnule }); }
// reseau simule pour dbUpdate
let reponses = [], envois = 0, SYNC_FAILURES = 0, alerte = 0;
function apiPut() { envois++; const r = reponses.shift(); return r === 'reseau' ? Promise.reject(new Error('reseau')) : Promise.resolve(r); }
function trackPendingWrite(p) { return p; }
function showSyncWarning() { alerte++; }
const _st = setTimeout; global.setTimeout = function (f) { return _st(f, 1); }; // 3 s -> immediat
// actualisation automatique
let CU = { nom: 'Yvan' }, PENDING_WRITES = 0, WRITE_GEN = 0, chargements = 0, modalOuverte = false;
const document = { querySelector() { return modalOuverte ? {} : null; } };
function loadAllDataFromDb() { chargements++; return Promise.resolve(); }
function updateAllBadges() {} function restoreSubTabs() {} function renderView() {} let CURRENT_VIEW = 'pipe';
eval(code);

let pass = 0, fail = 0; function ok(c, m) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m); } }
function fichePipe(etape) {
  ELS = {}; demandes = []; dirty = 0;
  const p = { id: 7, nom: 'Awa', etape: etape, sku: '', qte: 1, entrepot: '' };
  DETAIL_CTX = { entity: 'pipeline', record: p };
  return { p: p, sel: fauxEl('detail-edit-etape', etape) };
}
(async () => {
  console.log('== 1. Enregistrement fiable');
  PENDING_WRITES = 1; autoRefreshTick();
  ok(chargements === 0, 'enregistrement en cours : pas d\'actualisation automatique');
  PENDING_WRITES = 0; autoRefreshTick();
  ok(chargements === 1, 'aucun enregistrement en cours : actualisation normale');
  modalOuverte = true; autoRefreshTick(); modalOuverte = false;
  ok(chargements === 1, 'fiche ouverte : pas d\'actualisation (inchange)');
  reponses = [{ ok: false, status: 500, data: {} }, { ok: true, status: 200, data: {} }]; envois = 0; alerte = 0;
  let r = await dbUpdate('pipeline', 7, { nom: 'x' });
  ok(envois === 2 && r.ok && alerte === 0, 'erreur serveur : nouvel essai, enregistre, aucun bandeau rouge');
  reponses = ['reseau', { ok: true, status: 200, data: {} }]; envois = 0; alerte = 0;
  r = await dbUpdate('pipeline', 7, { nom: 'x' });
  ok(envois === 2 && r.ok && alerte === 0, 'pas de reponse du serveur : nouvel essai, enregistre');
  reponses = [{ ok: false, status: 403, data: { error: 'acces_refuse' } }]; envois = 0; alerte = 0;
  r = await dbUpdate('pipeline', 7, { nom: 'x' });
  ok(envois === 1 && alerte === 1, 'refus de droits : pas de nouvel essai, bandeau rouge');
  reponses = [{ ok: false, status: 500, data: {} }, { ok: false, status: 500, data: {} }]; envois = 0; alerte = 0;
  r = await dbUpdate('pipeline', 7, { nom: 'x' });
  ok(envois === 2 && alerte === 1, 'deux erreurs de suite : bandeau rouge (rien de cache)');

  console.log('\n== 2. Fiche Pipeline : raison demandee tout de suite');
  let f = fichePipe('Contacte');
  f.sel.value = 'Perdu'; pipeEtapeChoisie(f.sel);
  ok(demandes.length === 1 && demandes[0].type === 'perte' && demandes[0].nom === 'Awa', 'choisir « Perdu » : fenetre des raisons de perte ouverte tout de suite');
  demandes[0].onOk('Hors zone');
  ok(DETAIL_CTX.raisonChoisie && DETAIL_CTX.raisonChoisie.raison === 'Hors zone' && /Raison : <strong>Hors zone/.test(f.sel.apres), 'raison gardee et affichee sous la liste');
  ok(dirty > 0, 'fiche marquee « a enregistrer »');
  ok(f.p.etape === 'Contacte', 'rien n\'est enregistre avant « 💾 Enregistrer »');
  let continue_ = 0; demandes = [];
  pipeAvantEnregistrement(DETAIL_CTX, function () { continue_++; });
  ok(continue_ === 1 && demandes.length === 0 && DETAIL_CTX.pending.raison === 'Hors zone' && DETAIL_CTX.pending.etape === 'Perdu', 'a l\'enregistrement : raison reprise, pas redemandee');

  f = fichePipe('Contacte');
  f.sel.value = 'Non qualifie'; pipeEtapeChoisie(f.sel);
  ok(demandes.length === 1 && demandes[0].type === 'nq', 'choisir « Non qualifie » : fenetre des raisons de non-qualification');
  demandes[0].onAnnule();
  ok(f.sel.value === 'Contacte' && !DETAIL_CTX.raisonChoisie, '« Annuler » : la liste revient a l\'etape d\'avant');

  f = fichePipe('Contacte');
  f.sel.value = 'Perdu'; pipeEtapeChoisie(f.sel); demandes[0].onOk('Pas pret');
  f.sel.value = 'Gagne'; pipeEtapeChoisie(f.sel);
  ok(!DETAIL_CTX.raisonChoisie && !ELS['pipe-raison-choisie'] && demandes.length === 1, 'changer d\'avis pour « Gagne » : raison effacee, pas de fenetre');
  f.sel.value = 'Non qualifie'; pipeEtapeChoisie(f.sel); demandes[1].onAnnule();
  ok(f.sel.value === 'Gagne', 'puis « Non qualifie » + Annuler : retour a « Gagne » (le dernier choix)');

  f = fichePipe('Contacte');
  f.sel.value = 'Perdu'; pipeEtapeChoisie(f.sel); demandes[0].onOk('Pas pret');
  pipeEtapeChoisie(f.sel, true);
  ok(demandes.length === 2 && demandes[1].type === 'perte', 'lien « changer » : la fenetre se rouvre');
  demandes[1].onAnnule();
  ok(DETAIL_CTX.raisonChoisie && DETAIL_CTX.raisonChoisie.raison === 'Pas pret' && f.sel.value === 'Perdu' && !!ELS['pipe-raison-choisie'], '« changer » puis Annuler : la raison d\'avant est gardee');
  pipeEtapeChoisie(f.sel, true); demandes[2].onOk('Autre');
  ok(DETAIL_CTX.raisonChoisie.raison === 'Autre', '« changer » puis nouvelle raison : remplacee');

  f = fichePipe('Perdu');
  f.sel.value = 'Perdu'; pipeEtapeChoisie(f.sel);
  ok(demandes.length === 0, 'etape deja « Perdu » : rien n\'est redemande');

  f = fichePipe('Contacte'); continue_ = 0;
  f.sel.value = 'Perdu'; // choix non passe par la liste (ancien navigateur) : filet de securite
  pipeAvantEnregistrement(DETAIL_CTX, function () { continue_++; });
  ok(demandes.length === 1 && continue_ === 0, 'filet de securite : sans raison choisie, elle est demandee a l\'enregistrement');
  demandes[0].onOk('Hors zone');
  ok(continue_ === 1 && DETAIL_CTX.pending.raison === 'Hors zone', '... puis l\'enregistrement continue');

  const fichePipeSrc = src.slice(src.indexOf("['Etape du pipeline', 'etape'"), src.indexOf("['Etape du pipeline', 'etape'") + 260);
  ok(/'select', 'pipeEtapeChoisie\(this\)'\]/.test(fichePipeSrc), 'la liste « Etape du pipeline » lance pipeEtapeChoisie au changement');
  const html = detailInputHtml(['Etape', 'etape', [{ label: 'Perdu', value: 'Perdu' }], 'select', 'pipeEtapeChoisie(this)']);
  ok(/onchange="markDetailDirty\(\);pipeEtapeChoisie\(this\)"/.test(html), 'la case de la fiche porte l\'action au changement');
  ok(/onchange="markDetailDirty\(\)"/.test(detailInputHtml(['Type', 'type', [{ label: 'B2C' }], 'select'])), 'les autres listes ne changent pas');

  console.log('\n== 3. Fiche Clients & Prospects : raison demandee tout de suite');
  function ficheClient(statut) {
    ELS = {}; demandes = []; dirty = 0;
    const cl = { id: 3, nom: 'Moussa', statut: statut };
    DETAIL_CTX = { entity: 'clients', record: cl };
    return { cl: cl, sel: fauxEl('detail-edit-statut', statut), nq: fauxEl('detail-edit-raisonNq', '—'), perte: fauxEl('detail-edit-raisonPerte', '—') };
  }
  let c = ficheClient('Contacte');
  c.sel.value = 'Client perdu'; clientStatutChoisi(c.sel);
  ok(demandes.length === 1 && demandes[0].type === 'perte', 'choisir « Client perdu » : fenetre des raisons tout de suite');
  demandes[0].onOk('Pas interesse');
  ok(c.perte.value === 'Pas interesse' && c.nq.value === '—' && dirty > 0, 'la case « Raison (si Client perdu) » est remplie');
  c = ficheClient('Contacte');
  c.sel.value = 'Non qualifie'; clientStatutChoisi(c.sel); demandes[0].onOk('Faux numero');
  ok(c.nq.value === 'Faux numero', '« Non qualifie » : la case « Raison (si Non qualifie) » est remplie');
  c = ficheClient('Contacte');
  c.sel.value = 'Non qualifie'; clientStatutChoisi(c.sel); demandes[0].onAnnule();
  ok(c.sel.value === 'Contacte' && c.nq.value === '—', '« Annuler » : le statut revient a celui d\'avant');
  c = ficheClient('Contacte');
  c.sel.value = 'Client actif'; clientStatutChoisi(c.sel);
  ok(demandes.length === 0, 'autre statut : pas de fenetre');
  ok(/'select', 'clientStatutChoisi\(this\)'\]/.test(src), 'la liste « Statut » de la fiche client lance clientStatutChoisi');

  console.log(`\n${pass} reussis, ${fail} en echec`); process.exit(fail ? 1 : 0);
})();
