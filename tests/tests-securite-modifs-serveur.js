// Tests du 19/11/2026 : securite niveau 2, le SERVEUR verifie les MODIFICATIONS sensibles.
//  - Produits (catalogue, prix) : Super Admin, ou role avec « modifier_stock » ;
//    prix d'achat : en plus « modifier_prix_achat ».
//  - Fiche d'un AUTRE commercial (clients, pipeline) : permission
//    « modifier_client » ou « modifier_prospect » du role.
//  - Changer le commercial assigne : Super Admin seulement (ignore sinon).
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
// Usage : node tests/tests-securite-modifs-serveur.js
const { PGlite } = require('@electric-sql/pglite');
const REPO = '/tmp/crm-acquadue';
const db = new PGlite();
function norm(v) { return (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v; }
async function runQuery(text, params) { return (await db.query(text, (params || []).map(norm))).rows; }
function getSql() {
  const sql = function (strings, ...values) { let text = ''; strings.forEach(function (s, i) { text += s + (i < values.length ? '$' + (i + 1) : ''); }); return runQuery(text, values); };
  sql.query = runQuery; return sql;
}
const dbPath = require.resolve(REPO + '/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql } };
const H = {}; ['login', 'data', 'init-db'].forEach(function (n) { H[n] = require(REPO + '/api/' + n + '.js'); });
const sqlRaw = getSql();
let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = {}; if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }
const put = function (entity, id, patch, tok) { return call(H.data, { method: 'PUT', body: { entity: entity, id: id, patch: patch } }, tok); };
const post = function (entity, row, tok) { return call(H.data, { method: 'POST', body: { entity: entity, row: row } }, tok); };
const val = async function (table, col, idCol, id) { const r = await sqlRaw.query('SELECT ' + col + ' AS v FROM ' + table + ' WHERE ' + idCol + '::text = $1', [String(id)]); return r.length ? r[0].v : undefined; };

(async function () {
  await call(H['init-db'], {});
  const saTok = (await call(H.login, { method: 'POST', body: { email: 'admin@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!saTok);
  const toks = {};
  for (const [nom, role] of [['Awa', 'collaborateur'], ['Moussa', 'collaborateur'], ['RespT', 'responsable'], ['AdminT', 'admin']]) {
    await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES (${nom}, ${nom + '@x.ne'}, 'x', ${role}, 'Commercial', 'T', 'av-blue', 'Niamey', true)`;
    toks[nom] = (await sqlRaw`INSERT INTO sessions (token, user_id) SELECT 'tt' || md5(random()::text), id FROM users WHERE nom = ${nom} RETURNING token`)[0].token;
  }
  await sqlRaw`INSERT INTO produits (sku, nom, prix_achat, prix_vente) VALUES ('AQD-01', 'Purificateur', 40000, 70000)`;
  await sqlRaw`INSERT INTO clients (id, nom, statut, asg, tel) VALUES (1, 'Client de Awa', 'Contacte', 'Awa', '90')`;
  await sqlRaw`INSERT INTO pipeline (id, nom, etape, asg) VALUES (2, 'Client de Awa', 'Contacte', 'Awa')`;

  section('1. Produits');
  let r = await put('produits', 'AQD-01', { prix_vente: 1 }, toks.Awa);
  check('collaborateur : ne peut pas changer un prix de vente (403)', r.statusCode === 403 && r.body.error === 'modification_produits_non_autorisee' && await val('produits', 'prix_vente', 'sku', 'AQD-01') === 70000, [r.statusCode, r.body]);
  r = await post('produits', { sku: 'PIRATE', nom: 'x' }, toks.AdminT);
  check('admin sans « modifier_stock » : ne peut pas ajouter un produit', r.statusCode === 403 && await val('produits', 'nom', 'sku', 'PIRATE') === undefined);
  await sqlRaw`UPDATE sensitive_perms SET modifier_stock = true WHERE role IN ('admin','responsable')`;
  r = await put('produits', 'AQD-01', { prix_vente: 75000 }, toks.RespT);
  check('responsable AVEC « modifier_stock » : peut changer le prix de vente', r.statusCode === 200 && await val('produits', 'prix_vente', 'sku', 'AQD-01') === 75000, r.body);
  r = await put('produits', 'AQD-01', { prix_achat: 1 }, toks.RespT);
  check('... mais pas le prix d\'achat (« modifier_prix_achat » absent)', r.statusCode === 403 && r.body.error === 'modification_prix_achat_non_autorisee' && await val('produits', 'prix_achat', 'sku', 'AQD-01') === 40000);
  r = await put('produits', 'AQD-01', { nom: 'Purificateur Famille', prix_achat: 40000 }, toks.RespT);
  check('... renvoyer le meme prix d\'achat avec la fiche : accepte (rien ne change)', r.statusCode === 200 && await val('produits', 'nom', 'sku', 'AQD-01') === 'Purificateur Famille', r.body);
  r = await put('produits', 'AQD-01', { prix_achat: 42000 }, toks.AdminT);
  check('admin (« modifier_prix_achat ») : peut changer le prix d\'achat', r.statusCode === 200 && await val('produits', 'prix_achat', 'sku', 'AQD-01') === 42000, r.body);
  r = await put('produits', 'AQD-01', { prix_achat: 41000 }, saTok);
  check('Super Admin : peut tout changer', r.statusCode === 200 && await val('produits', 'prix_achat', 'sku', 'AQD-01') === 41000);

  section('2. Fiches d\'un autre commercial');
  r = await put('clients', 1, { notes: 'note de Awa' }, toks.Awa);
  check('Awa modifie SA fiche client', r.statusCode === 200 && await val('clients', 'notes', 'id', 1) === 'note de Awa');
  r = await put('clients', 1, { notes: 'note de Moussa' }, toks.Moussa);
  check('Moussa (permission « modifier client/prospect » active par defaut) : peut aider sur la fiche', r.statusCode === 200);
  await sqlRaw`UPDATE sensitive_perms SET modifier_client = false, modifier_prospect = false WHERE role = 'collaborateur'`;
  r = await put('clients', 1, { notes: 'pirate' }, toks.Moussa);
  check('permission retiree : Moussa ne peut plus modifier la fiche de Awa (403)', r.statusCode === 403 && r.body.error === 'fiche_d_un_autre_commercial' && await val('clients', 'notes', 'id', 1) === 'note de Moussa', [r.statusCode, r.body]);
  r = await put('pipeline', 2, { etape: 'Perdu' }, toks.Moussa);
  check('... ni son opportunite du Pipeline', r.statusCode === 403 && await val('pipeline', 'etape', 'id', 2) === 'Contacte');
  r = await put('pipeline', 2, { etape: 'En negociation' }, toks.Awa);
  check('Awa garde la main sur ses propres fiches', r.statusCode === 200 && await val('pipeline', 'etape', 'id', 2) === 'En negociation');

  section('3. Changer le commercial assigne : Super Admin seulement');
  r = await put('clients', 1, { asg: 'Awa', tel: '91' }, toks.Awa);
  check('meme commercial renvoye avec la fiche : accepte normalement', r.statusCode === 200 && !r.body.ignore && await val('clients', 'tel', 'id', 1) === '91');
  r = await put('clients', 1, { asg: 'Moussa', tel: '92' }, toks.Awa);
  check('Awa essaie de donner sa fiche a Moussa : le reste passe, le commercial ne change pas', r.statusCode === 200 && (r.body.ignore || []).indexOf('asg') >= 0 && await val('clients', 'asg', 'id', 1) === 'Awa' && await val('clients', 'tel', 'id', 1) === '92', r.body);
  r = await put('pipeline', 2, { asg: 'Moussa' }, toks.Awa);
  check('... seul changement demande : rien n\'est fait, sans erreur', r.statusCode === 200 && await val('pipeline', 'asg', 'id', 2) === 'Awa', r.body);
  r = await put('clients', 1, { asg: 'Moussa' }, saTok);
  check('Super Admin : reassigne la fiche', r.statusCode === 200 && await val('clients', 'asg', 'id', 1) === 'Moussa');

  section('4. Le reste ne change pas');
  r = await put('clients', 1, { notes: 'x' });
  check('sans connexion : refuse (401)', r.statusCode === 401);
  await sqlRaw`INSERT INTO stock (id, sku, entrepot, qte, reserve) VALUES (9, 'AQD-01', 'Niamey', 10, 0)`;
  r = await put('stock', 9, { reserve: 1 }, toks.Awa);
  check('reservation de stock lors d\'une vente (collaborateur) : toujours possible', r.statusCode === 200 && await val('stock', 'reserve', 'id', 9) === 1);
  r = await post('clients', { id: 50, nom: 'Nouveau', asg: 'Awa' }, toks.Awa);
  check('creer un client : toujours possible', r.statusCode === 201);

  section('5. Niveau 3 (19/11) : depenses, taches, conges, factures, devis');
  await sqlRaw`INSERT INTO depenses (id, libelle, montant, statut, cree_par) VALUES (60, 'Carburant', 5000, 'En attente', 'Awa')`;
  r = await put('depenses', 60, { statut: 'Rembourse', montant: 99999 }, toks.Awa);
  check('depense : meme sa creatrice ne peut pas la modifier (Super Admin seul, comme a l\'ecran)', r.statusCode === 403 && r.body.error === 'modification_depense_reservee_super_admin' && await val('depenses', 'montant', 'id', 60) === 5000, r.body);
  r = await put('depenses', 60, { statut: 'Rembourse' }, toks.AdminT);
  check('... ni un admin', r.statusCode === 403);
  r = await put('depenses', 60, { statut: 'Rembourse' }, saTok);
  check('Super Admin : modifie la depense', r.statusCode === 200 && await val('depenses', 'statut', 'id', 60) === 'Rembourse');
  await sqlRaw`INSERT INTO tasks (id, titre, asg, statut) VALUES (61, 'Appeler 10 leads', 'Awa', 'A faire')`;
  r = await put('tasks', 61, { statut: 'Termine', rapport: 'fait' }, toks.Awa);
  check('tache : la personne assignee la termine', r.statusCode === 200 && await val('tasks', 'statut', 'id', 61) === 'Termine');
  r = await put('tasks', 61, { statut: 'A faire' }, toks.Moussa);
  check('... un autre collaborateur ne peut pas la modifier', r.statusCode === 403 && r.body.error === 'tache_d_un_autre_membre' && await val('tasks', 'statut', 'id', 61) === 'Termine');
  r = await put('tasks', 61, { pri: 'Haute' }, toks.RespT);
  check('... un responsable peut (gestion d\'equipe)', r.statusCode === 200);
  await sqlRaw`INSERT INTO rh_conges (id, nom, statut) VALUES (62, 'Awa', 'En attente')`;
  r = await put('rh_conges', 62, { statut: 'Approuve' }, toks.Awa);
  check('conge : un collaborateur ne peut pas approuver (meme le sien)', r.statusCode === 403 && r.body.error === 'validation_conge_non_autorisee' && await val('rh_conges', 'statut', 'id', 62) === 'En attente');
  r = await put('rh_conges', 62, { statut: 'Approuve' }, toks.RespT);
  check('... un responsable peut', r.statusCode === 200 && await val('rh_conges', 'statut', 'id', 62) === 'Approuve');
  await sqlRaw`INSERT INTO factures (id, client, statut, cree_par, geste_statut) VALUES ('F-9', 'Client', 'Impayee', 'Awa', 'en_attente')`;
  r = await put('factures', 'F-9', { geste_statut: 'valide' }, toks.Awa);
  check('facture : valider son propre geste commercial est refuse a un collaborateur', r.statusCode === 403 && r.body.error === 'validation_geste_non_autorisee' && await val('factures', 'geste_statut', 'id', 'F-9') === 'en_attente');
  r = await put('factures', 'F-9', { geste_statut: 'valide' }, toks.RespT);
  check('... un responsable valide le geste', r.statusCode === 200 && await val('factures', 'geste_statut', 'id', 'F-9') === 'valide');
  r = await put('factures', 'F-9', { statut: 'Payee' }, toks.Moussa);
  check('... marquer « Payee » la facture d\'une autre personne : refuse', r.statusCode === 403 && r.body.error === 'statut_facture_non_autorise' && await val('factures', 'statut', 'id', 'F-9') === 'Impayee');
  r = await put('factures', 'F-9', { statut: 'Payee', sortie_appliquee: true }, toks.Awa);
  check('... sa creatrice la marque « Payee »', r.statusCode === 200 && await val('factures', 'statut', 'id', 'F-9') === 'Payee');
  r = await put('factures', 'F-9', { statut: 'Payee', mode_paiement: 'Especes' }, toks.Moussa);
  check('... renvoyer le meme statut avec une modification : accepte', r.statusCode === 200);
  await sqlRaw`INSERT INTO devis (id, client, statut, cree_par, geste_statut) VALUES ('D-9', 'Client', 'Envoye', 'Awa', 'en_attente')`;
  r = await put('devis', 'D-9', { geste_statut: 'valide' }, toks.Awa);
  check('devis : geste commercial valide seulement par un superieur', r.statusCode === 403);
  r = await put('devis', 'D-9', { statut: 'Accepte', reservation_faite: true }, toks.Moussa);
  check('devis : accepter un devis reste possible pour l\'equipe', r.statusCode === 200);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); process.exit(fail ? 1 : 0);
})();
