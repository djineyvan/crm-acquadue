// Tests du 19/11/2026 (2e partie) : changement de l'email d'un compte (Super
// Admin, y compris le sien), connexion insensible aux majuscules, colonnes du
// jour de rappel. Base PostgreSQL de test en memoire (PGlite).
// Usage : node tests/tests-email-rappel-serveur.js
const { PGlite } = require('@electric-sql/pglite');
const REPO = '/tmp/crm-acquadue';
const db = new PGlite();
function norm(v) { return (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v; }
async function runQuery(text, params) { return (await db.query(text, (params || []).map(norm))).rows; }
function getSql() { const sql = function (strings, ...values) { let text = ''; strings.forEach(function (s, i) { text += s + (i < values.length ? '$' + (i + 1) : ''); }); return runQuery(text, values); }; sql.query = runQuery; return sql; }
const dbPath = require.resolve(REPO + '/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql } };
const H = {}; ['login', 'data', 'init-db', 'users'].forEach(function (n) { H[n] = require(REPO + '/api/' + n + '.js'); });
const sqlRaw = getSql();
let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = {}; if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }
const login = function (email, password) { return call(H.login, { method: 'POST', body: { email: email, password: password } }); };

(async function () {
  section('1. Premier compte');
  await call(H['init-db'], {});
  const saId = (await sqlRaw`SELECT id, email FROM users WHERE role = 'superadmin'`)[0];
  check('1er compte cree avec l\'adresse du reglage (ici adresse neutre, aucune adresse personnelle dans le code)', saId.email === 'admin@acquadue.ne', saId.email);
  const src = require('fs').readFileSync(REPO + '/api/init-db.js', 'utf8');
  check('init-db : adresse lue dans SEED_ADMIN_EMAIL / RECOVERY_EMAIL', /process\.env\.SEED_ADMIN_EMAIL \|\| process\.env\.RECOVERY_EMAIL/.test(src) && src.indexOf('yvan@acquadue.ne') < 0);
  const tok = (await login('admin@acquadue.ne', 'Admin@2026')).body.token;
  check('connexion', !!tok);
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Awa', 'awa@x.ne', 'x', 'collaborateur', 'Commercial', 'A', 'av-blue', 'Niamey', true)`;
  const awa = (await sqlRaw`SELECT id FROM users WHERE nom = 'Awa'`)[0].id;
  const awaTok = (await sqlRaw`INSERT INTO sessions (token, user_id) VALUES ('tokawa0123456789abcdef', ${awa}) RETURNING token`)[0].token;

  section('2. Changer l\'email');
  const put = function (body, t) { return call(H.users, { method: 'PUT', body: body }, t); };
  let r = await put({ id: saId.id, action: 'update_email', value: '  Nouveau.Email@Exemple.FR ' }, tok);
  check('Super Admin change SON email (mis en minuscules)', r.statusCode === 200 && r.body.email === 'nouveau.email@exemple.fr' && (await sqlRaw`SELECT email FROM users WHERE id = ${saId.id}`)[0].email === 'nouveau.email@exemple.fr', r.body);
  r = await login('admin@acquadue.ne', 'Admin@2026');
  check('l\'ancienne adresse ne marche plus', r.statusCode === 401);
  r = await login('nouveau.email@exemple.fr', 'Admin@2026');
  check('la nouvelle adresse marche, meme mot de passe', r.statusCode === 200 && !!r.body.token);
  r = await login('Nouveau.Email@EXEMPLE.fr ', 'Admin@2026');
  check('majuscules ou espace en trop a la connexion : accepte', r.statusCode === 200);
  r = await call(H.login, { method: 'POST', body: { action: 'verify-token', token: tok } });
  check('la session ouverte reste valide (pas besoin de se reconnecter)', r.statusCode === 200 && r.body.user && r.body.user.email === 'nouveau.email@exemple.fr', r.body);
  r = await put({ id: awa, action: 'update_email', value: 'nouveau.email@exemple.fr' }, tok);
  check('adresse deja utilisee par un autre compte : refusee', r.statusCode === 409 && r.body.error === 'email_deja_utilise');
  r = await put({ id: awa, action: 'update_email', value: 'pas-un-email' }, tok);
  check('adresse invalide : refusee', r.statusCode === 400 && r.body.error === 'email_invalide');
  r = await put({ id: awa, action: 'update_email', value: 'pirate@x.ne' }, awaTok);
  check('un collaborateur ne peut pas changer un email', r.statusCode === 403 && r.body.error === 'acces_refuse' && (await sqlRaw`SELECT email FROM users WHERE id = ${awa}`)[0].email === 'awa@x.ne', [r.statusCode, r.body]);
  const j = await sqlRaw`SELECT detail FROM audit_log WHERE action = 'Email du compte modifie'`;
  check('Journal : une ligne, sans l\'adresse', j.length === 1 && j[0].detail.indexOf('@') < 0, j);
  r = await put({ id: saId.id, action: 'update_profile', role: 'collaborateur', departement: 'Direction', ville: 'Niamey' }, tok);
  check('un compte Super Admin ne peut pas perdre son role', r.statusCode === 400 && (await sqlRaw`SELECT role FROM users WHERE id = ${saId.id}`)[0].role === 'superadmin');

  section('3. Jour de rappel');
  await sqlRaw`INSERT INTO pipeline (id, nom, etape) VALUES (7, 'Awa', 'Contacte')`;
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 7, patch: { rappel_date: '2026-11-25', rappel_cause: 'Apres la <paie>' } } }, tok);
  check('rappel_date et rappel_cause enregistres (texte neutralise)', r.statusCode === 200 && r.body.row.rappel_date === '2026-11-25' && r.body.row.rappel_cause === 'Apres la ‹paie›', r.body);
  await sqlRaw.query('ALTER TABLE pipeline DROP COLUMN rappel_cause');
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 7, patch: { rappel_cause: 'Test' } } }, tok);
  check('colonne absente : recreee a la volee', r.statusCode === 200 && r.body.row.rappel_cause === 'Test', r.body);
  await call(H['init-db'], {}, tok);
  const cols = (await sqlRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline'`).map(function (x) { return x.column_name; });
  check('init-db cree les deux colonnes', cols.indexOf('rappel_date') >= 0 && cols.indexOf('rappel_cause') >= 0);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); process.exit(fail ? 1 : 0);
})();
