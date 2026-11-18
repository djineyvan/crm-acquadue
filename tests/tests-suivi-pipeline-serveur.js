// Tests du 18/11/2026 : suivi d'appel du Pipeline cote SERVEUR.
//  - /api/init-db ajoute les nouvelles colonnes (quartier, pub, appele, rappel_soir,
//    relance_j2, resultat_appel, date_livraison, montant).
//  - /api/data enregistre et relit ces colonnes (creation et modification).
//  - Si une colonne manque encore (base pas encore reparee), l'ecriture la cree
//    et reussit quand meme.
//  - created_at est bien renvoye (sert de secours pour la date de reception).
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
// Usage : node tests/tests-suivi-pipeline-serveur.js
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
const sqlRaw = getSql();

let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = Object.assign({}, o.headers || {}); if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }
const NOUVELLES = ['quartier', 'pub', 'appele', 'rappel_soir', 'relance_j2', 'resultat_appel', 'date_livraison', 'montant'];

(async function () {
  await call(H['init-db'], {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!tok);

  section('1. Colonnes creees par /api/init-db');
  const cols = (await sqlRaw.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline'")).map(function (r) { return r.column_name; });
  NOUVELLES.forEach(function (c) { check('colonne pipeline.' + c + ' presente', cols.indexOf(c) >= 0); });
  const r0 = await call(H['init-db'], {}, tok);
  check('/api/init-db peut etre relance sans erreur', r0.statusCode === 200, r0.body);

  section('2. Creation et modification du suivi');
  let r = await call(H.data, { method: 'POST', body: { entity: 'pipeline', row: { id: 1763400000000, nom: 'Ali Garba', etape: 'Nouveau prospect', asg: 'Yvan', quartier: 'Plateau', pub: 'V2' } } }, tok);
  check('creation avec quartier et pub', r.statusCode === 201 && r.body.row.quartier === 'Plateau' && r.body.row.pub === 'V2', r.body);
  check('valeurs par defaut : cases non cochees', r.body.row.appele === false && r.body.row.rappel_soir === false && r.body.row.relance_j2 === false, r.body.row);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { appele: true, rappel_soir: true, resultat_appel: 'Vocal envoye' } } }, tok);
  check('cocher Appele + Rappel soir, resultat « Vocal envoye »', r.statusCode === 200 && r.body.row.appele === true && r.body.row.rappel_soir === true && r.body.row.resultat_appel === 'Vocal envoye', r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { date_livraison: '2026-11-20', montant: 30000 } } }, tok);
  check('date de livraison et montant enregistres', r.statusCode === 200 && r.body.row.date_livraison === '2026-11-20' && Number(r.body.row.montant) === 30000, r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { montant: null } } }, tok);
  check('montant vide accepte (null)', r.statusCode === 200 && r.body.row.montant === null, r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { quartier: '<script>x</script>' } } }, tok);
  check('texte dangereux neutralise dans le quartier', r.statusCode === 200 && r.body.row.quartier.indexOf('<') < 0, r.body.row && r.body.row.quartier);
  r = await call(H.data, { method: 'GET', query: { entity: 'pipeline' } }, tok);
  const lu = (r.body.rows || []).find(function (x) { return String(x.id) === '1763400000000'; });
  check('relecture : suivi present et created_at renvoye', !!lu && lu.appele === true && lu.resultat_appel === 'Vocal envoye' && !!lu.created_at, lu);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { appele: true } } });
  check('sans connexion : modification refusee (401)', r.statusCode === 401);

  section('3. Base pas encore reparee : la colonne manquante est creee a la volee');
  await sqlRaw.query('ALTER TABLE pipeline DROP COLUMN relance_j2');
  await sqlRaw.query('ALTER TABLE pipeline DROP COLUMN montant');
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { relance_j2: true } } }, tok);
  check('modification reussie malgre la colonne absente', r.statusCode === 200 && r.body.row.relance_j2 === true, r.body);
  r = await call(H.data, { method: 'POST', body: { entity: 'pipeline', row: { id: 1763400000500, nom: 'Soul', etape: 'Nouveau prospect', montant: 25000 } } }, tok);
  check('creation reussie malgre la colonne absente', r.statusCode === 201 && Number(r.body.row.montant) === 25000, r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'pipeline', id: 1763400000000, patch: { colonne_inconnue: 1 } } }, tok);
  check('une colonne inconnue reste refusee (400)', r.statusCode === 400, r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 999, patch: { nom: 'x' } } }, tok);
  check('les autres tables ne sont pas touchees (client inexistant : 404)', r.statusCode === 404, r.body);

  console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
