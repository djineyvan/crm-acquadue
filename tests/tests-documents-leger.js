// Tests du 12/11/2026 (soir) : connexion plus legere.
// Le chargement de depart (/api/bulk-load) et la liste /api/data?entity=documents
// n'envoient PLUS le contenu des fichiers ; il est lu a l'ouverture d'un document
// (/api/data?entity=documents&id=...). Base PostgreSQL de test en memoire (PGlite).
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
global.fetch = async function () { return { ok: true, json: async function () { return {}; } }; };
const H = { init: require(REPO + '/api/init-db.js'), login: require(REPO + '/api/login.js'), data: require(REPO + '/api/data.js'), bulk: require(REPO + '/api/bulk-load.js'), backup: require(REPO + '/api/backup.js') };
const sqlRaw = getSql();

let pass = 0, fail = 0; const failures = [];
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; failures.push(n); console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = {}; if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }

(async function () {
  await call(H.init, {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  // un "gros" fichier de 3 Mo et un document ancien sans contenu
  const big = 'data:application/pdf;base64,' + 'A'.repeat(3 * 1024 * 1024);
  let r = await call(H.data, { method: 'POST', body: { entity: 'documents', row: { id: 1001, nom: 'Contrat.pdf', categorie: 'Clients', taille: '3 Mo', date_doc: '12/11/2026', par_qui: 'Yvan', data: big, mime_type: 'application/pdf' } } }, tok);
  check('televersement (inchange) : document enregistre', r.statusCode === 201, r.body);
  await sqlRaw`INSERT INTO documents (id, nom, categorie, taille, date_doc, par_qui, data, mime_type) VALUES (1002, 'Ancien.pdf', 'Autre', '1 Ko', '01/01/2026', 'Nadia', NULL, 'application/pdf')`;
  await call(H.data, { method: 'POST', body: { entity: 'clients', row: { id: 5, nom: 'Client A' } } }, tok);

  section('1. Chargement de depart (bulk-load)');
  r = await call(H.bulk, {}, tok);
  const docs = r.body && r.body.data && r.body.data.documents;
  check('bulk-load OK, autres tables intactes', r.statusCode === 200 && r.body.data.clients.length === 1, r.body && r.body.errors);
  check('les 2 documents sont listes', docs && docs.length === 2, docs);
  check('AUCUN contenu de fichier envoye', docs && docs.every(function (d) { return d.data === undefined; }), docs && docs.map(function (d) { return Object.keys(d); }));
  check('nom, taille, date, auteur, type presents', docs && docs.find(function (d) { return Number(d.id) === 1001; }).nom === 'Contrat.pdf' && docs[0].mime_type === 'application/pdf');
  check('has_data indique si le fichier existe', docs && docs.find(function (d) { return Number(d.id) === 1001; }).has_data === true && docs.find(function (d) { return Number(d.id) === 1002; }).has_data === false, docs);
  const taille = JSON.stringify(r.body).length;
  check('reponse legere (moins de 10 Ko au lieu de plus de 3 Mo)', taille < 10000, taille);

  section('2. Liste de secours (/api/data?entity=documents)');
  r = await call(H.data, { query: { entity: 'documents' } }, tok);
  check('liste sans contenu de fichier', r.statusCode === 200 && r.body.rows.length === 2 && r.body.rows.every(function (d) { return d.data === undefined; }), r.body && r.body.rows && r.body.rows.map(function (d) { return Object.keys(d); }));

  section("3. Ouverture d'un document");
  r = await call(H.data, { query: { entity: 'documents', id: '1001' } }, tok);
  check('le contenu complet est renvoye a la demande', r.statusCode === 200 && r.body.row && r.body.row.data === big && r.body.row.nom === 'Contrat.pdf');
  r = await call(H.data, { query: { entity: 'documents', id: '999' } }, tok);
  check('document inexistant -> 404', r.statusCode === 404, r.body);
  r = await call(H.data, { query: { entity: 'documents', id: "1 OR 1=1" } }, tok);
  check("identifiant pirate (injection) -> 400", r.statusCode === 400, r.body);
  r = await call(H.data, { query: { entity: 'documents', id: '1001' } });
  check('sans connexion -> 401', r.statusCode === 401);
  r = await call(H.bulk, {});
  check('bulk-load sans connexion -> 401', r.statusCode === 401);

  section('4. Rien ne change pour les sauvegardes');
  r = await call(H.backup, { method: 'POST', body: { type: 'Manuelle' } }, tok);
  const id = r.body && r.body.backup && r.body.backup.id;
  r = await call(H.backup, { query: { id: String(id) } }, tok);
  const saved = r.body && r.body.backup && r.body.backup.payload && r.body.backup.payload.documents;
  check('la sauvegarde contient toujours le contenu complet des fichiers', Array.isArray(saved) && saved.some(function (d) { return d.data === big; }), saved && saved.length);

  section('5. Autres tables : lecture inchangee');
  r = await call(H.data, { query: { entity: 'clients' } }, tok);
  check('/api/data?entity=clients inchange', r.statusCode === 200 && r.body.rows.length === 1 && r.body.rows[0].nom === 'Client A');

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
