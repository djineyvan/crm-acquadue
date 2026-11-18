// Teste (18/11/2026) : recherche d'un client dans Devis & Facturation.
// Une case de recherche filtre la liste des clients (nom, sans tenir compte
// des accents, ou telephone). Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-recherche-client.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

let CLIENTS = [
  { nom: 'Ali Garba Issa', tel: '+227 96 57 70 43' }, { nom: 'Aïcha Moussa', tel: '+227 90 11 22 33' },
  { nom: 'Bio Amadou', tel: '' }, { nom: 'Hotel Gaweye', tel: '20 73 23 00' }, { nom: 'Société A&B "Eau"', tel: '' }
];
function visibleClientsPourFacturation() { return CLIENTS; }
// Faux DOM : une liste qui garde ses options
const DOM = {};
function fauxSelect() {
  return { _html: '', value: '', set innerHTML(h) { this._html = h; const vals = []; h.replace(/<option value="([^"]*)"/g, function (m, v) { vals.push(v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')); }); this.options = vals; if (vals.indexOf(this.value) < 0) this.value = ''; }, get innerHTML() { return this._html; } };
}
function el(id) { return DOM[id] || null; }
eval(grab('// ── RECHERCHE DE CLIENT', 'function fieldClientPicker('));
eval(grab('function toggleNewClientField(selectId, textId){', '\n}\n') + '\n}');
function prepare() { DOM.sel = fauxSelect(); DOM.sel.innerHTML = clientOptionsHtml(clientsPourListe('')); DOM['sel-info'] = { textContent: '' }; DOM.txt = { value: '', style: {} }; }

console.log('— 1. Liste de depart');
prepare();
ok(DOM.sel.options.length === 6 && DOM.sel.options[0] === '', 'tous les clients + « Nouveau client »', DOM.sel.options);
ok(/Ali Garba Issa — \+227 96 57 70 43/.test(DOM.sel.innerHTML), 'le telephone est affiche a cote du nom (aide pour les homonymes)');
ok(DOM.sel.options.indexOf('Société A&B "Eau"') > 0 && DOM.sel.innerHTML.indexOf('"Eau""') < 0, 'noms avec guillemets ou & : sans casse');

console.log('— 2. Recherche');
prepare(); filtrerClientSelect('sel', 'txt', 'gar');
ok(DOM.sel.options.length === 2 && DOM.sel.value === 'Ali Garba Issa', 'un seul resultat : choisi tout seul', DOM.sel.options);
ok(DOM.txt.value === 'Ali Garba Issa' && DOM.txt.style.display === 'none', 'le nom du client est repris pour le devis');
ok(/1 client\(s\) trouve\(s\)/.test(DOM['sel-info'].textContent), 'message : 1 client trouve');
prepare(); filtrerClientSelect('sel', 'txt', 'aicha');
ok(DOM.sel.value === 'Aïcha Moussa', 'sans accent : « aicha » trouve « Aïcha »');
prepare(); filtrerClientSelect('sel', 'txt', 'A');
ok(DOM.sel.options.length > 2 && DOM.sel.value === '', 'plusieurs resultats : on choisit dans la liste', DOM.sel.options);
prepare(); filtrerClientSelect('sel', 'txt', '9011');
ok(DOM.sel.value === 'Aïcha Moussa', 'recherche par telephone');
prepare(); filtrerClientSelect('sel', 'txt', 'Kader Nouveau');
ok(DOM.sel.options.length === 1 && DOM.sel.value === '' && DOM.txt.value === 'Kader Nouveau' && DOM.txt.style.display === 'block', 'aucun resultat : nouveau client, nom pre-rempli');
ok(/Aucun client trouve/.test(DOM['sel-info'].textContent), 'message : aucun client trouve');
prepare(); DOM.sel.value = 'Bio Amadou'; filtrerClientSelect('sel', 'txt', '');
ok(DOM.sel.options.length === 6 && DOM.sel.value === 'Bio Amadou', 'recherche effacee : toute la liste, le choix est garde');

console.log('— 3. Branchements dans la page');
ok(/id="'\+selectId\+'-search"[^>]*oninput="filtrerClientSelect\(/.test(src), 'case de recherche au-dessus de la liste');
ok(/fieldClientPicker\('db-client-select','db-client'\)/.test(src) && /fieldClientPicker\('fb-client-select','fb-client'\)/.test(src), 'dans le Devis et dans la Facture');
ok(/clientOptionsHtml\(clientsPourListe\(champ \? champ\.value : ''\)\)/.test(src), 'la recherche reste appliquee quand la liste est rafraichie');
ok(/el\('db-client-select-search'\)\.value = ''/.test(src) && /el\('fb-client-select-search'\)\.value = ''/.test(src), 'la recherche est videe a chaque nouveau devis / facture');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec'); process.exit(fail ? 1 : 0);
