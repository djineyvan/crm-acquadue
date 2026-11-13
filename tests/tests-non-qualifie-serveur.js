// Tests du 13/11/2026 : statut « Non qualifie » cote serveur.
// Le bilan par publicite (Centre de Controle -> Connexion Meta) compte les leads
// classes « Non qualifie », sans changer les autres colonnes.
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
const { PGlite } = require('@electric-sql/pglite');
const crypto = require('crypto');
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
const H = { version: require(REPO + '/api/version.js'), init: require(REPO + '/api/init-db.js'), login: require(REPO + '/api/login.js'), data: require(REPO + '/api/data.js') };
const sqlRaw = getSql();

let pass = 0, fail = 0; const failures = [];
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; failures.push(n); console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = {}; if (tok) headers.authorization = 'Bearer ' + tok; await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); return res; }
async function post(raw) {
  const res = mkRes(); const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST'; req.query = {}; req.headers = { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex') };
  await H.version(req, res); return res;
}
function payload(id) { return JSON.stringify({ object: 'page', entry: [{ id: 'P1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: 'P1', form_id: 'F7', ad_id: 'AD1' } }] }] }); }
const PEOPLE = {};
['A1', 'A2', 'A3', 'A4', 'A5'].forEach(function (k, i) { PEOPLE[k] = [{ name: 'full_name', values: ['Lead ' + k] }, { name: 'phone_number', values: ['+2279000000' + i] }]; });
global.fetch = async function (url) {
  const u = new URL(url); const path = u.pathname.replace(/^\/v[0-9.]+\//, ''); const fields = u.searchParams.get('fields') || '';
  const ok = function (j) { return { ok: true, status: 200, json: async () => j }; };
  if (PEOPLE[path]) return fields ? ok({ id: path, ad_id: 'AD1', ad_name: 'Video famille 30s', campaign_name: 'Purificateur Novembre', platform: 'fb' }) : ok({ id: path, field_data: PEOPLE[path] });
  if (path === 'F7') return ok({ id: 'F7', name: 'Formulaire devis' });
  return { ok: false, status: 400, json: async () => ({ error: { message: 'x', code: 100 } }) };
};

(async function () {
  await call(H.init, {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Harouna','h@x.ne','x','collaborateur','Commercial','H','av-blue','Niamey',true)`;
  for (const k of Object.keys(PEOPLE)) await post(payload(k));

  section('1. Enregistrer le statut « Non qualifie »');
  const c3 = (await sqlRaw`SELECT id FROM clients WHERE nom='Lead A3'`)[0];
  let r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: Number(c3.id), patch: { statut: 'Non qualifie' } } }, tok);
  check('fiche client : statut « Non qualifie » accepte et enregistre', r.statusCode === 200 && r.body.row.statut === 'Non qualifie', r.body);
  const p3 = (await sqlRaw`SELECT id FROM pipeline WHERE nom='Lead A3'`)[0];
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: Number(p3.id), patch: { etape: 'Non qualifie' } } }, tok);
  check('pipeline : etape « Non qualifie » acceptee et enregistree', r.statusCode === 200 && r.body.row.etape === 'Non qualifie', r.body);
  await sqlRaw`UPDATE clients SET statut='Non qualifie' WHERE nom='Lead A4'`;
  await sqlRaw`UPDATE clients SET statut='Client actif' WHERE nom='Lead A1'`;
  await sqlRaw`UPDATE clients SET statut='Contacte' WHERE nom='Lead A2'`;
  await sqlRaw`UPDATE clients SET statut='Client perdu' WHERE nom='Lead A5'`;

  section('2. Bilan par publicite');
  r = await call(H.version, { query: { meta: 'status' } }, tok);
  const b = (r.body.bilan_publicites || []).find(function (x) { return x.annonce === 'Video famille 30s'; });
  check('5 leads pour la pub', b && b.leads === 5, r.body.bilan_publicites);
  check('nouvelle colonne : 2 non qualifies', b && b.non_qualifies === 2, b);
  check('autres colonnes inchangees : 1 gagne, 1 en discussion, 1 perdu', b && b.clients === 1 && b.en_cours === 1 && b.perdus === 1, b);
  check('un non qualifie n\'est PAS compte « en discussion »', b && b.en_cours === 1, b);
  check('aucun secret dans la reponse', !/secret-app-test|page-token-test|mot-secret-test/.test(JSON.stringify(r.body)));
  r = await call(H.version, { query: { meta: 'status' } });
  check('bilan toujours refuse sans connexion (401)', r.statusCode === 401);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
