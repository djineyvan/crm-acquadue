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

  section('4. Fiches deja recues : remplies une seule fois');
  await call(H['init-db'], {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!tok);
  await sqlRaw`DELETE FROM audit_log WHERE action = 'Infos des leads Meta remplies'`;
  // meta_leads tel que cree par lib/meta.js
  await sqlRaw`CREATE TABLE IF NOT EXISTS meta_leads (leadgen_id TEXT PRIMARY KEY, page_id TEXT, form_id TEXT, ad_id TEXT, status TEXT NOT NULL DEFAULT 'en_cours', attempts INT NOT NULL DEFAULT 0, error TEXT, client_id BIGINT, nom TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), campagne TEXT, ensemble TEXT, annonce TEXT, formulaire TEXT, plateforme TEXT)`;
  await sqlRaw`INSERT INTO meta_leads (leadgen_id, form_id, ad_id, status, client_id, created_at, campagne, ensemble, annonce, formulaire, plateforme)
               VALUES ('L1', 'F7', 'AD1', 'ok', 101, '2026-11-17 09:15:00', 'Purif Nov', 'Niamey 25-45', 'Video famille', 'Devis purificateur', 'Instagram')`;
  await sqlRaw`INSERT INTO clients (id, nom, source, tel, ville, origine_lead) VALUES (101, 'Awa', 'Meta Ads', '', 'Niamey', ${ancien})`;
  await sqlRaw`INSERT INTO clients (id, nom, source, tel, origine_lead) VALUES (102, 'Bio', 'Meta Ads', '+22711111111', ${'Lead recu via Meta (Facebook) le 05/11/2026.\nAnnonce : (ID) 555\nVille : Maradi'})`;
  await sqlRaw`INSERT INTO clients (id, nom, source, notes) VALUES (103, 'Client salon', 'Salon professionnel', 'RAS')`;
  await sqlRaw`INSERT INTO clients (id, nom, source, lead_campagne) VALUES (104, 'Deja rempli', 'Meta Ads', 'Campagne manuelle')`;
  let r = await call(H['init-db'], {}, tok);
  check('init-db repond 200 : 3 fiches Meta traitees', r.statusCode === 200 && r.body.infos_leads && r.body.infos_leads.fiches === 3, r.body.infos_leads || r.body);
  const c = {}; (await sqlRaw`SELECT * FROM clients`).forEach(function (x) { c[x.id] = x; });
  check('fiche avec meta_leads : infos de Meta (prioritaires)', c[101].lead_via === 'Meta (Instagram)' && c[101].lead_campagne === 'Purif Nov' && c[101].lead_ensemble === 'Niamey 25-45' && c[101].lead_annonce === 'Video famille' && c[101].lead_annonce_id === 'AD1' && c[101].lead_formulaire === 'Devis purificateur' && c[101].lead_formulaire_id === 'F7', c[101]);
  check('date de reception = date du lead Meta', /^2026-11-17T09:15/.test(c[101].lead_recu_le), c[101].lead_recu_le);
  check('contenu : seulement les reponses', /^Numero whatsapp : \+227 90 11 22 33/.test(c[101].origine_lead) && !/Campagne :/.test(c[101].origine_lead), c[101].origine_lead);
  check('telephone vide : repris du formulaire ; quartier repris dans « zone »', c[101].tel === '+22790112233' && c[101].zone === 'Koira Kano', [c[101].tel, c[101].zone]);
  check('fiche ancienne sans meta_leads : infos lues dans le texte', c[102].lead_via === 'Meta (Facebook)' && c[102].lead_recu_le === '2026-11-05' && c[102].lead_annonce_id === '555', c[102]);
  check('telephone deja rempli : garde ; ville vide : reprise', c[102].tel === '+22711111111' && c[102].ville === 'Maradi', c[102]);
  check('fiche non Meta : pas touchee', !c[103].lead_via && c[103].notes === 'RAS', c[103]);
  check('case deja remplie : jamais ecrasee', c[104].lead_campagne === 'Campagne manuelle', c[104].lead_campagne);
  const sv = await sqlRaw`SELECT id FROM sauvegarde_infos_leads ORDER BY id`;
  check('copie de secours des 3 fiches', sv.length === 3, sv);
  const j = await sqlRaw`SELECT detail FROM audit_log WHERE action = 'Infos des leads Meta remplies'`;
  check('compte rendu dans le Journal d\'audit', j.length === 1 && /^3 fiche\(s\) Meta/.test(j[0].detail) && /3 coordonnee\(s\)/.test(j[0].detail) && /0 fiche\(s\) Meta sans aucune information de pub/.test(j[0].detail), j);
  await sqlRaw`UPDATE clients SET lead_campagne = 'X' WHERE id = 102`;
  r = await call(H['init-db'], {}, tok);
  check('2e passage : ne refait rien', r.body.infos_leads === null && (await sqlRaw`SELECT lead_campagne FROM clients WHERE id = 102`)[0].lead_campagne === 'X');

  section('5. Lecture par l\'application');
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, tok);
  const lu = (r.body.rows || []).find(function (x) { return x.id == 101; });
  check('les colonnes du lead sont renvoyees avec la fiche', !!lu && lu.lead_annonce === 'Video famille' && lu.lead_formulaire_id === 'F7', lu);
  await sqlRaw.query('ALTER TABLE clients DROP COLUMN lead_campagne');
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 101, patch: { lead_campagne: 'Test' } } }, tok);
  check('colonne absente : recreee a la volee', r.statusCode === 200 && r.body.row.lead_campagne === 'Test', r.body);

  console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
