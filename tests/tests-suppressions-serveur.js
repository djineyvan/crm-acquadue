// Tests du 13/11/2026 (4e partie) : le SERVEUR verifie qui peut supprimer.
//  - Super Admin : peut tout supprimer.
//  - Admin / Responsable / Collaborateur : suppression refusee (403),
//    sauf ligne de stock (permission « modifier_stock ») et mouvement de stock
//    (permission « supprimer_mouvement »), si le Super Admin a coche la case.
//  - Rien n'est efface quand c'est refuse.
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
// Usage : node tests/tests-suppressions-serveur.js
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

let pass = 0, fail = 0; const failures = [];
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; failures.push(n); console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = Object.assign({}, o.headers || {}); if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }
const del = function (entity, id, tok) { return call(H.data, { method: 'DELETE', body: { entity: entity, id: id } }, tok); };
const existe = async function (table, col, id) { return (await sqlRaw.query('SELECT 1 FROM ' + table + ' WHERE ' + col + '::text = $1', [String(id)])).length === 1; };

(async function () {
  await call(H['init-db'], {});
  const saTok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!saTok);
  const toks = {};
  for (const [nom, role] of [['AdminT', 'admin'], ['RespT', 'responsable'], ['CollabT', 'collaborateur']]) {
    await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES (${nom}, ${nom + '@x.ne'}, 'x', ${role}, 'Commercial', 'T', 'av-blue', 'Niamey', true)`;
    toks[role] = (await sqlRaw`INSERT INTO sessions (token, user_id) SELECT 'tt' || md5(random()::text), id FROM users WHERE nom = ${nom} RETURNING token`)[0].token;
  }
  // Donnees de test
  await sqlRaw`INSERT INTO clients (id, nom, statut) VALUES (1, 'Client A', 'Contacte')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, etape) VALUES (2, 'Opp A', 'Contacte')`;
  await sqlRaw`INSERT INTO factures (id, client, statut) VALUES ('F-1', 'Client A', 'Payee')`;
  await sqlRaw`INSERT INTO tasks (id, titre, statut) VALUES (3, 'Tache A', 'A faire')`;
  await sqlRaw`INSERT INTO depenses (id, libelle, montant) VALUES (4, 'Depense A', 1000)`;
  await sqlRaw`INSERT INTO stock (id, sku, entrepot, qte) VALUES (5, 'SKU1', 'Niamey', 10)`;
  await sqlRaw`INSERT INTO mouvements_stock (id, sku, qte, type) VALUES (6, 'SKU1', 2, 'Entree')`;

  section('1. Admin, Responsable, Collaborateur : suppression refusee par le serveur');
  const cibles = [['clients', 1, 'clients', 'id'], ['pipeline', 2, 'pipeline', 'id'], ['factures', 'F-1', 'factures', 'id'], ['tasks', 3, 'tasks', 'id'], ['depenses', 4, 'depenses', 'id'], ['stock', 5, 'stock', 'id'], ['mouvements_stock', 6, 'mouvements_stock', 'id']];
  for (const role of ['admin', 'responsable', 'collaborateur']) {
    for (const [ent, id, table, col] of cibles) {
      const r = await del(ent, id, toks[role]);
      check(role + ' ne peut pas supprimer : ' + ent + ' (403, rien efface)', r.statusCode === 403 && r.body.error === 'suppression_reservee_super_admin' && await existe(table, col, id), [r.statusCode, r.body]);
    }
  }
  let r = await del('clients', 1);
  check('sans connexion : refuse (401), rien efface', r.statusCode === 401 && await existe('clients', 'id', 1));

  section('2. Exceptions reglables (Administration -> Permissions)');
  await sqlRaw`UPDATE sensitive_perms SET supprimer_mouvement = true WHERE role = 'admin'`;
  r = await del('mouvements_stock', 6, toks.admin);
  check('admin AVEC la case « supprimer un mouvement » : peut supprimer un mouvement', r.statusCode === 200 && !(await existe('mouvements_stock', 'id', 6)), r.body);
  r = await del('stock', 5, toks.admin);
  check('... mais toujours pas une ligne de stock (autre permission)', r.statusCode === 403 && await existe('stock', 'id', 5));
  await sqlRaw`UPDATE sensitive_perms SET modifier_stock = true WHERE role = 'responsable'`;
  r = await del('stock', 5, toks.responsable);
  check('responsable AVEC la case « modifier le stock » : peut supprimer une ligne de stock (fusion)', r.statusCode === 200 && !(await existe('stock', 'id', 5)), r.body);
  r = await del('clients', 1, toks.responsable);
  check('... mais toujours pas un client', r.statusCode === 403 && await existe('clients', 'id', 1));
  r = await del('sensitive_perms', 'admin', toks.admin);
  check('admin ne peut pas supprimer la matrice des permissions', r.statusCode === 403);

  section('3. Super Admin : peut tout supprimer');
  await sqlRaw`INSERT INTO mouvements_stock (id, sku, qte, type) VALUES (7, 'SKU1', 1, 'Sortie')`;
  for (const [ent, id, table, col] of [['clients', 1, 'clients', 'id'], ['pipeline', 2, 'pipeline', 'id'], ['factures', 'F-1', 'factures', 'id'], ['tasks', 3, 'tasks', 'id'], ['depenses', 4, 'depenses', 'id'], ['mouvements_stock', 7, 'mouvements_stock', 'id']]) {
    r = await del(ent, id, saTok);
    check('Super Admin supprime : ' + ent, r.statusCode === 200 && !(await existe(table, col, id)), r.body);
  }

  section('4. Les autres actions restent permises a l\'equipe');
  r = await call(H.data, { method: 'POST', body: { entity: 'clients', row: { id: 50, nom: 'Nouveau', statut: 'Nouveau prospect' } } }, toks.collaborateur);
  check('collaborateur : peut toujours creer une fiche', r.statusCode === 201, r.body);
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 50, patch: { statut: 'Contacte' } } }, toks.collaborateur);
  check('collaborateur : peut toujours modifier une fiche', r.statusCode === 200, r.body);
  r = await call(H.data, { query: { entity: 'clients' } }, toks.collaborateur);
  check('collaborateur : peut toujours lire', r.statusCode === 200 && r.body.rows.length >= 1);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
