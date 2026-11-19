// Teste (18/11/2026, mis a jour le 19/11/2026) : choix du client dans Devis &
// Facturation. Deux boutons : « 👤 Client deja enregistre » (liste avec case
// de recherche : nom sans accents, ou telephone) et « ➕ Nouveau client »
// (nom, telephone, ville, adresse / quartier, type). Faux environnement.
// Usage : node tests/test-ecran-recherche-client.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

let CLIENTS = [
  { nom: 'Ali Garba Issa', tel: '+227 96 57 70 43' }, { nom: 'Aïcha Moussa', tel: '+227 90 11 22 33' },
  { nom: 'Bio Amadou', tel: '' }, { nom: 'Hotel Gaweye', tel: '20 73 23 00' }, { nom: 'Société A&B "Eau"', tel: '' }
];
const VILLES_NIGER = ['Niamey', 'Zinder', 'Maradi'];
let CU = { nom: 'Yvan', ville: 'Zinder' };
let alerts = []; function alert(m) { alerts.push(m); }
function visibleClientsPourFacturation() { return CLIENTS; }
const DOM = {};
function fauxSelect() {
  return { _html: '', value: '', set innerHTML(h) { this._html = h; const vals = []; h.replace(/<option value="([^"]*)"/g, function (m, v) { vals.push(v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')); }); this.options = vals; if (vals.indexOf(this.value) < 0) this.value = ''; }, get innerHTML() { return this._html; } };
}
function champ(v) { return { value: v || '', style: {}, textContent: '', innerHTML: '', className: '' }; }
function el(id) { return DOM[id] || null; }
eval(grab('// ── RECHERCHE DE CLIENT', 'function fillClientSelect('));
eval(grab('function toggleNewClientField(selectId, textId){', '\n}\n') + '\n}');
function prepare() {
  ['sel-search', 'sel-info', 'txt', 'txt-tel', 'txt-zone', 'sel-mode-existant', 'sel-mode-nouveau'].forEach(function (k) { DOM[k] = champ(); });
  DOM['txt-ville'] = champ('Niamey'); DOM['txt-type'] = champ('B2C');
  DOM['sel-bloc-existant'] = champ(); DOM['sel-bloc-nouveau'] = champ(); DOM['sel-bloc-nouveau'].style.display = 'none';
  DOM.sel = fauxSelect(); DOM.sel.innerHTML = clientOptionsHtml(clientsPourListe(''));
  alerts = [];
}

console.log('— 1. Liste de depart (« Client deja enregistre »)');
prepare();
ok(DOM.sel.options.length === 6 && DOM.sel.options[0] === '' && /— Choisir un client —/.test(DOM.sel.innerHTML), 'tous les clients + « — Choisir un client — »', DOM.sel.options);
ok(/Ali Garba Issa — \+227 96 57 70 43/.test(DOM.sel.innerHTML), 'le telephone est affiche a cote du nom (aide pour les homonymes)');
ok(DOM.sel.options.indexOf('Société A&B "Eau"') > 0 && DOM.sel.innerHTML.indexOf('"Eau""') < 0, 'noms avec guillemets ou & : sans casse');

console.log('— 2. Recherche en tapant');
prepare(); filtrerClientSelect('sel', 'txt', 'gar');
ok(DOM.sel.options.length === 2 && DOM.sel.value === 'Ali Garba Issa', 'un seul resultat : choisi tout seul', DOM.sel.options);
ok(DOM.txt.value === 'Ali Garba Issa', 'le nom du client est repris pour le devis');
ok(/1 client\(s\) trouve\(s\)/.test(DOM['sel-info'].textContent), 'message : 1 client trouve');
prepare(); filtrerClientSelect('sel', 'txt', 'aicha');
ok(DOM.sel.value === 'Aïcha Moussa', 'sans accent : « aicha » trouve « Aïcha »');
prepare(); filtrerClientSelect('sel', 'txt', 'A');
ok(DOM.sel.options.length > 2 && DOM.sel.value === '', 'plusieurs resultats : on choisit dans la liste', DOM.sel.options);
prepare(); filtrerClientSelect('sel', 'txt', '9011');
ok(DOM.sel.value === 'Aïcha Moussa', 'recherche par telephone');
prepare(); filtrerClientSelect('sel', 'txt', 'Kader Nouveau');
ok(DOM.sel.options.length === 1 && DOM.sel.value === '' && /Aucun client trouve/.test(DOM['sel-info'].innerHTML) && /creerDepuisRecherche\('sel','txt'\)/.test(DOM['sel-info'].innerHTML), 'aucun resultat : propose « ➕ Creer comme nouveau client »');
prepare(); DOM.sel.value = 'Bio Amadou'; filtrerClientSelect('sel', 'txt', '');
ok(DOM.sel.options.length === 6 && DOM.sel.value === 'Bio Amadou', 'recherche effacee : toute la liste, le choix est garde');

console.log('— 3. « ➕ Nouveau client » : nom, telephone, ville, adresse');
prepare(); setClientPickerMode('sel', 'txt', 'nouveau');
ok(clientPickerMode('sel') === 'nouveau' && DOM['sel-bloc-existant'].style.display === 'none' && DOM['sel-bloc-nouveau'].style.display === 'block', 'le bloc du nouveau client s\'affiche, la liste se cache');
ok(DOM['txt-ville'].value === 'Zinder' && DOM['sel-mode-nouveau'].className.indexOf('btn-red') >= 0, 'ville du commercial proposee, bouton actif en rouge');
DOM.txt.value = '  Kader Issoufou '; DOM['txt-tel'].value = '+227 99 00 11 22'; DOM['txt-zone'].value = 'Plateau, rue 12'; DOM['txt-type'].value = 'B2B';
let c = lireClientPicker('sel', 'txt');
ok(c && c.nouveau && c.nom === 'Kader Issoufou' && c.tel === '+227 99 00 11 22' && c.ville === 'Zinder' && c.zone === 'Plateau, rue 12' && c.type === 'B2B', 'toutes les informations sont lues', c);
prepare(); setClientPickerMode('sel', 'txt', 'nouveau'); c = lireClientPicker('sel', 'txt');
ok(c === null && /nom du nouveau client/.test(alerts[0] || ''), 'nom vide : refuse avec un message');
prepare(); filtrerClientSelect('sel', 'txt', 'Kader Nouveau'); DOM['sel-search'].value = 'Kader Nouveau'; creerDepuisRecherche('sel', 'txt');
ok(clientPickerMode('sel') === 'nouveau' && DOM.txt.value === 'Kader Nouveau', '« Creer comme nouveau client » : nom repris de la recherche');
prepare(); DOM['sel-search'].value = '96 12 34 56'; creerDepuisRecherche('sel', 'txt');
ok(DOM['txt-tel'].value === '96 12 34 56' && DOM.txt.value === '', 'un numero tape : il va dans la case Telephone');

console.log('— 4. « 👤 Client deja enregistre »');
prepare(); c = lireClientPicker('sel', 'txt');
ok(c === null && /Choisissez un client/.test(alerts[0] || ''), 'aucun client choisi : message clair');
prepare(); DOM.sel.value = 'Hotel Gaweye'; c = lireClientPicker('sel', 'txt');
ok(c && !c.nouveau && c.nom === 'Hotel Gaweye', 'client choisi dans la liste');
prepare(); preparerClientPicker('sel', 'txt', 'hotel gaweye');
ok(clientPickerMode('sel') === 'existant' && DOM.sel.value === 'Hotel Gaweye', 'modifier un devis d\'un client connu : il est deja choisi');
prepare(); preparerClientPicker('sel', 'txt', 'Ancien Client');
ok(clientPickerMode('sel') === 'nouveau' && DOM.txt.value === 'Ancien Client', 'ancien devis d\'un nom inconnu : « Nouveau client » avec le nom');
prepare(); preparerClientPicker('sel', 'txt', '');
ok(clientPickerMode('sel') === 'existant' && DOM.sel.value === '', 'nouveau devis : on commence par la liste des clients');

console.log('— 5. Branchements dans la page');
ok(/id="'\+selectId\+'-search"[^>]*oninput="filtrerClientSelect\(/.test(src), 'case de recherche au-dessus de la liste');
ok(/fieldClientPicker\('db-client-select','db-client'\)/.test(src) && /fieldClientPicker\('fb-client-select','fb-client'\)/.test(src), 'dans le Devis et dans la Facture');
ok(/clientOptionsHtml\(clientsPourListe\(champ \? champ\.value : ''\)\)/.test(src), 'la recherche reste appliquee quand la liste est rafraichie');
ok(/preparerClientPicker\('db-client-select', 'db-client'/.test(src) && /preparerClientPicker\('fb-client-select', 'fb-client'/.test(src), 'chaque devis / facture commence proprement');
const saveD = grab('function saveDevisBuilder(){', '// ── FACTURE BUILDER');
ok(/lireClientPicker\('db-client-select', 'db-client'\)/.test(saveD) && /ensureClientExists\(client, [^;]*choix\.type, choix\.ville, 'Devis\/Facturation', choix\.tel, choix\.zone\)/.test(saveD), 'devis : le nouveau client est cree avec telephone, ville et adresse');
ok(/warnIfDuplicateContact\(choix\.nom, choix\.tel\)/.test(saveD), 'devis : alerte si le nom ou le numero existe deja');
const saveF = grab('function saveFactureBuilder(){', "closeModal('modal-facture-builder');");
ok(/lireClientPicker\('fb-client-select', 'fb-client'\)/.test(saveF) && /choix\.tel, choix\.zone\)/.test(saveF), 'facture : pareil');
const ens = grab('function ensureClientExists(', '// ── LIEN PIPELINE');
ok(/zone: zone \|\| ''/.test(ens) && /if\(zone && !cl\.zone\) cl\.zone = zone;/.test(ens), 'la fiche client recoit l\'adresse / le quartier (sans ecraser un quartier deja rempli)');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
