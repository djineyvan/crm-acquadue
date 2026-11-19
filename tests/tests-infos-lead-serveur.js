// Tests du 18/11/2026 : informations du lead Meta, une par colonne de la fiche client.
//  - Lecture du formulaire : questions en francais reconnues (telephone, ville, quartier, email).
//  - Date de reception tiree de Meta (created_time).
//  - Relecture de l'ancien texte « Origine du lead ».
//  - Remplissage UNE SEULE FOIS des fiches deja recues (init-db), copie de secours, Journal.
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
// Usage : node tests/tests-infos-lead-serveur.js
const { PGlite } = require('@electric-sql/pglite');
const REPO = '/tmp/crm-acquadue';
const db = new PGlite();
function norm(v) { return (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v; }
async function runQuery(text, params) { return (await db.query(text, (params || []).map(norm))).rows; }
function getSql() {
  const sql = function (strings, ...values) {
    let text = ''; strings.forEach(function (s, i) { text += s + (i < values.length ? '$' + (i + 1) : ''); });
    return runQuery(text, values);
  };
  sql.query = runQuery; return sql;
}
const dbPath = require.resolve(REPO + '/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql } };
const H = {};
['login', 'data', 'init-db'].forEach(function (n) { H[n] = require(REPO + '/api/' + n + '.js'); });
const M = require(REPO + '/lib/meta.js');
const sqlRaw = getSql();

let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = Object.assign({}, o.headers || {}); if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }

(async function () {
  section('1. Lecture du formulaire Meta');
  const p = M.parseLead({ field_data: [
    { name: 'nom_et_prénom', values: ['Ali Garba'] },
    { name: 'numéro_whatsapp', values: ['p:+227 96 57 70 43'] },
    { name: 'votre_quartier_?', values: ['Plateau'] },
    { name: 'ville', values: ['Niamey'] },
    { name: 'adresse_e-mail', values: ['ali@test.ne'] },
    { name: 'quel_produit_vous_intéresse_?', values: ['Purificateur'] }
  ] });
  check('nom reconnu (« nom et prenom »)', p.nom === 'Ali Garba', p.nom);
  check('telephone reconnu (« numero WhatsApp »), nettoye', p.tel === '+22796577043', p.tel);
  check('quartier reconnu', p.quartier === 'Plateau', p.quartier);
  check('ville et email reconnus', p.ville === 'Niamey' && p.email === 'ali@test.ne', p);
  check('contenu complet du formulaire, dans l\'ordre', p.champs.length === 6 && p.champs[0].label === 'Nom et prénom' && p.champs[1].value === '+22796577043' && p.champs[5].value === 'Purificateur', p.champs);
  check('les autres questions restent a part', p.autres.length === 1 && /produit/i.test(p.autres[0].label), p.autres);
  check('formulaire anglais standard toujours reconnu', M.parseLead({ field_data: [{ name: 'full_name', values: ['Awa'] }, { name: 'phone_number', values: ['+22790000000'] }, { name: 'city', values: ['Maradi'] }] }).tel === '+22790000000');

  section('2. Date de reception');
  check('created_time de Meta (+0000) converti', M.dateReceptionLead('2026-11-17T10:30:00+0000') === '2026-11-17T10:30:00.000Z', M.dateReceptionLead('2026-11-17T10:30:00+0000'));
  check('sans date Meta : maintenant', Math.abs(new Date(M.dateReceptionLead(null)) - Date.now()) < 5000);

  section('3. Relecture de l\'ancien texte « Origine du lead »');
  const ancien = 'Lead recu via Meta (Facebook) le 17/11/2026.\nCampagne : Purificateur Novembre\nEnsemble de publicites : Niamey 25-45\nAnnonce : Video V2 (ID 1203)\nFormulaire : Devis (ID 88)\nNumero whatsapp : +227 90 11 22 33\n\n[Nouveau formulaire Meta]\nLead recu via Meta (Instagram) le 18/11/2026.\nAnnonce : (ID) 999\nQuartier : Koira Kano';
  const t = M.lireOrigineMeta(ancien);
  check('via et date', t.via === 'Meta (Facebook)' && t.recuLe === '2026-11-17', t);
  check('campagne, ensemble', t.campagne === 'Purificateur Novembre' && t.ensemble === 'Niamey 25-45', t);
  check('annonce + ID, formulaire + ID', t.annonce === 'Video V2' && t.annonceId === '1203' && t.formulaire === 'Devis' && t.formulaireId === '88', t);
  check('le 1er formulaire garde ses infos (pas ecrasees par le 2e)', t.annonceId === '1203');
  check('il ne reste que les reponses (+ un repere pour le 2e formulaire)', t.contenu === 'Numero whatsapp : +227 90 11 22 33\n\n[Nouveau formulaire Meta — recu le 18/11/2026]\nQuartier : Koira Kano', t.contenu);
  check('« Annonce : (ID) x » : ID seul', M.lireOrigineMeta('Lead recu via Meta (Facebook) le 01/11/2026.\nAnnonce : (ID) 77').annonceId === '77');
  check('texte sans en-tete Meta : inchange', M.lireOrigineMeta('Salon de Niamey').contenu === 'Salon de Niamey' && M.lireOrigineMeta('Salon de Niamey').via === '');

  section('4. Operation « une seule fois » retiree (19/11) ; Pub V1/V2/V3 remplie d\'apres l\'annonce');
  await call(H['init-db'], {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'admin@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!tok);
  check('nom d\'annonce -> pub', M.pubDepuisAnnonce('V1 14-11-2026') === 'V1' && M.pubDepuisAnnonce('V3 14-11-2026') === 'V3' && M.pubDepuisAnnonce('v2 12-11-2026') === 'V2', [M.pubDepuisAnnonce('V1 14-11-2026'), M.pubDepuisAnnonce('V3 14-11-2026')]);
  check('autres ecritures reconnues (« Video 2 », « vidéo-3 », « Pub V1 »)', M.pubDepuisAnnonce('Video 2') === 'V2' && M.pubDepuisAnnonce('vidéo-3 famille') === 'V3' && M.pubDepuisAnnonce('Pub V1 Niamey') === 'V1');
  check('la date du nom (12-11-2026) n\'est pas prise pour un numero de pub', M.pubDepuisAnnonce('Carrousel 12-11-2026') === 'Autre');
  check('V4, autre annonce -> « Autre » ; pas d\'annonce -> rien', M.pubDepuisAnnonce('V4 20-11-2026') === 'Autre' && M.pubDepuisAnnonce('Promo Tabaski') === 'Autre' && M.pubDepuisAnnonce('') === '' && M.pubDepuisAnnonce(null) === '');
  await sqlRaw`INSERT INTO clients (id, nom, source, tel, ville, origine_lead, lead_annonce, lead_formulaire_id) VALUES (101, 'Awa', 'Meta Ads', '+227 90', 'Niamey', ${ancien}, 'V3 14-11-2026', 'F7')`;
  await sqlRaw`INSERT INTO clients (id, nom, source, tel, lead_annonce) VALUES (102, 'Bio', 'Meta Ads', '+227 91', 'V1 14-11-2026')`;
  await sqlRaw`INSERT INTO clients (id, nom, source, tel) VALUES (103, 'Client salon', 'Salon professionnel', '+227 92')`;
  await sqlRaw`INSERT INTO clients (id, nom, source, tel, lead_annonce) VALUES (104, 'Choix manuel', 'Meta Ads', '+227 93', 'V2 14-11-2026')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, tel, etape) VALUES (201, 'awa ', '', 'Nouveau prospect')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, tel, etape) VALUES (202, 'Bio Renomme', '+227 91', 'Contacte')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, tel, etape) VALUES (203, 'Client salon', '+227 92', 'Contacte')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, tel, etape, pub) VALUES (204, 'Choix manuel', '+227 93', 'Contacte', 'Autre')`;
  const avant = await sqlRaw`SELECT origine_lead FROM clients WHERE id = 101`;
  let r = await call(H['init-db'], {}, tok);
  check('init-db repond 200 sans l\'operation unique', r.statusCode === 200 && r.body.infos_leads === undefined, r.body);
  check('... et ne touche plus au contenu des fiches', (await sqlRaw`SELECT origine_lead FROM clients WHERE id = 101`)[0].origine_lead === avant[0].origine_lead);
  const pp = {}; (await sqlRaw`SELECT id, pub FROM pipeline`).forEach(function (x) { pp[x.id] = x.pub; });
  check('pub remplie : par le nom (V3) et, nom change, par le telephone (V1)', pp[201] === 'V3' && pp[202] === 'V1', pp);
  check('contact sans annonce Meta : pas touche', !pp[203], pp[203]);
  check('pub choisie a la main : jamais changee', pp[204] === 'Autre', pp[204]);
  check('compte rendu : 2 pubs remplies', r.body.pubs_remplies === 2, r.body.pubs_remplies);
  r = await call(H['init-db'], {}, tok);
  check('2e passage : rien a faire', r.body.pubs_remplies === 0);
  const src = require('fs').readFileSync(REPO + '/lib/meta.js', 'utf8');
  check('nouveaux leads Meta : la pub est mise a l\'arrivee', /quartier, pub\)\s*VALUES[^`]*pubDepuisAnnonce\(L\.annonce\)\}\)/.test(src));

  section('5. Lecture par l\'application');
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, tok);
  const lu = (r.body.rows || []).find(function (x) { return x.id == 101; });
  check('les colonnes du lead sont renvoyees avec la fiche', !!lu && lu.lead_annonce === 'V3 14-11-2026' && lu.lead_formulaire_id === 'F7', lu);
  await sqlRaw.query('ALTER TABLE clients DROP COLUMN lead_campagne');
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 101, patch: { lead_campagne: 'Test' } } }, tok);
  check('colonne absente : recreee a la volee', r.statusCode === 200 && r.body.row.lead_campagne === 'Test', r.body);

  console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
