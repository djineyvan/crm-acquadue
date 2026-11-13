// Tests de bout en bout des routes /api/* du CRM Acqua Due contre une vraie base
// PostgreSQL de test (PGlite, en memoire). Aucune donnee reelle n'est touchee.
const Module = require('module');
const { PGlite } = require('@electric-sql/pglite');

const REPO = '/tmp/crm-acquadue';
const db = new PGlite();

function norm(v) {
  return (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v;
}
async function runQuery(text, params) {
  const r = await db.query(text, (params || []).map(norm));
  return r.rows;
}
function getSql() {
  const sql = function (strings, ...values) {
    if (!Array.isArray(strings)) throw new Error('appel direct non supporte');
    let text = '';
    strings.forEach(function (s, i) { text += s + (i < values.length ? '$' + (i + 1) : ''); });
    return runQuery(text, values);
  };
  sql.query = function (text, params) { return runQuery(text, params); };
  return sql;
}
// On remplace uniquement la connexion a la base (lib/db.js) par la base de test.
const dbPath = require.resolve(REPO + '/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql } };

const H = {};
['login', 'users', 'data', 'bulk-load', 'audit', 'backup', 'export-data', 'reset-data',
 'restore-backup', 'init-db', 'forgot-password', 'version'].forEach(function (n) {
  H[n] = require(REPO + '/api/' + n + '.js');
});
const sqlRaw = getSql();

// ── mini outillage de test ──────────────────────────────────────────────────
let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t); }

async function call(handler, opts, token) {
  opts = opts || {};
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(x) { this.body = x; return this; },
    end() { return this; }
  };
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['authorization'] = 'Bearer ' + token;
  const req = { method: opts.method || 'GET', query: opts.query || {}, body: opts.body || {}, headers };
  try { await handler(req, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; }
  return res;
}
const status = function (r) { return r.statusCode; };

async function login(email, password) {
  return call(H.login, { method: 'POST', body: { email, password } });
}

// Pas d'envoi d'email reel : on simule la reponse du service d'envoi.
process.env.RESEND_API_KEY = 'test';
global.fetch = async function () { return { ok: true, json: async function () { return { id: 'fake' }; } }; };

(async function main() {

  section('1. Premier demarrage (base vide)');
  let r = await call(H['init-db'], {});
  check('init-db sans compte existant : autorise et reussit', r.statusCode === 200 && r.body && r.body.success === true, r.body);
  check('compte Super Admin cree', r.body && r.body.seeded === true);
  const seed = (await sqlRaw`SELECT pass, doit_changer_pass FROM users WHERE email = 'yvan@acquadue.ne'`)[0];
  check('mot de passe de depart stocke CHIFFRE (pas en clair)', seed.pass.indexOf('scrypt$') === 0 && seed.pass.indexOf('Admin@2026') < 0);
  check('changement de mot de passe impose pour le compte de depart', seed.doit_changer_pass === true);

  section('2. Acces SANS jeton : tout doit etre refuse (401)');
  const anon = [
    ['GET  /api/data?entity=clients',        H.data,            { method: 'GET', query: { entity: 'clients' } }],
    ['POST /api/data',                       H.data,            { method: 'POST', body: { entity: 'clients', row: { id: 1, nom: 'X' } } }],
    ['PUT  /api/data',                       H.data,            { method: 'PUT', body: { entity: 'clients', id: 1, patch: { nom: 'Y' } } }],
    ['DELETE /api/data',                     H.data,            { method: 'DELETE', body: { entity: 'clients', id: 1 } }],
    ['GET  /api/bulk-load',                  H['bulk-load'],    { method: 'GET' }],
    ['GET  /api/users',                      H.users,           { method: 'GET' }],
    ['GET  /api/users?reveal=...',           H.users,           { method: 'GET', query: { reveal: 'yvan@acquadue.ne', requestedBy: 'x' } }],
    ['GET  /api/users?sessions=1',           H.users,           { method: 'GET', query: { sessions: '1' } }],
    ['POST /api/users',                      H.users,           { method: 'POST', body: { nom: 'Pirate', email: 'p@x.ne', pass: 'Pirate@2026', role: 'superadmin' } }],
    ['PUT  /api/users (reset_password)',     H.users,           { method: 'PUT', body: { id: 1, action: 'reset_password', value: 'Pirate@2026' } }],
    ['PUT  /api/users (reset_via_email_code)', H.users,         { method: 'PUT', body: { id: 1, action: 'reset_via_email_code', value: 'Pirate@2026' } }],
    ['DELETE /api/users (session)',          H.users,           { method: 'DELETE', body: { action: 'delete_session', token: 'x' } }],
    ['GET  /api/audit',                      H.audit,           { method: 'GET' }],
    ['POST /api/audit',                      H.audit,           { method: 'POST', body: { user_nom: 'x', action: 'x' } }],
    ['GET  /api/audit?createurs=assign',     H.audit,           { method: 'GET', query: { createurs: 'assign', nom: 'Yvan Leunkeu Djine' } }],
    ['GET  /api/audit?search_contact',       H.audit,           { method: 'GET', query: { search_contact: 'a' } }],
    ['GET  /api/backup',                     H.backup,          { method: 'GET' }],
    ['POST /api/backup',                     H.backup,          { method: 'POST', body: { type: 'Manuelle' } }],
    ['DELETE /api/backup',                   H.backup,          { method: 'DELETE', body: { id: 1 } }],
    ['GET  /api/export-data',                H['export-data'],  { method: 'GET' }],
    ['POST /api/reset-data',                 H['reset-data'],   { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026', confirm: 'RESET' } }],
    ['POST /api/restore-backup',             H['restore-backup'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026', backupId: 1, confirm: 'RESTORE' } }],
    ['GET  /api/init-db (comptes existants)', H['init-db'],     { method: 'GET' }]
  ];
  for (const a of anon) {
    const rr = await call(a[1], a[2]);
    check(a[0] + ' -> 401', rr.statusCode === 401 && rr.body && rr.body.error === 'session_invalide', { code: rr.statusCode, body: rr.body });
  }
  const noLeak = await call(H.users, { method: 'GET', query: { reveal: 'yvan@acquadue.ne', requestedBy: 'x' } });
  check('aucun mot de passe renvoye sans jeton', JSON.stringify(noLeak.body).indexOf('revealedPassword') < 0 && JSON.stringify(noLeak.body).indexOf('scrypt') < 0);
  let bad = await call(H.data, { method: 'GET', query: { entity: 'clients' }, headers: { authorization: 'Bearer abc' } });
  check('jeton bidon refuse', bad.statusCode === 401);
  bad = await call(H.data, { method: 'GET', query: { entity: 'clients' }, headers: { authorization: "Bearer ' OR 1=1 --" } });
  check("tentative d'injection dans le jeton refusee", bad.statusCode === 401);
  r = await call(H.version, {});
  check('/api/version reste public', r.statusCode === 200 && r.body && r.body.version);

  section('3. Connexion');
  r = await login('yvan@acquadue.ne', 'mauvais');
  check('mauvais mot de passe -> 401 wrong_password', r.statusCode === 401 && r.body.error === 'wrong_password' && r.body.tentatives === 1, r.body);
  r = await login('yvan@acquadue.ne', 'Admin@2026');
  check('bon mot de passe -> 200 avec jeton', r.statusCode === 200 && r.body.success && /^[0-9a-f]{64}$/.test(r.body.token), r.body && Object.keys(r.body));
  const saToken = r.body.token;
  check('reponse sans champ secret (pass, reset_code)', r.body.user.pass === undefined && r.body.user.reset_code === undefined && r.body.user.reset_attempts === undefined);
  check('mot de passe de depart => changement impose', r.body.user.doit_changer_pass === true);
  r = await call(H.login, { method: 'POST', body: { action: 'verify-token', token: saToken } });
  check('verify-token OK et sans champ secret', r.statusCode === 200 && r.body.user.pass === undefined && r.body.user.reset_code === undefined);

  section('4. Super Admin : fonctions normales');
  r = await call(H.users, { method: 'GET' }, saToken);
  check('liste des utilisateurs sans mot de passe ni code', r.statusCode === 200 && r.body.users.length >= 1 &&
    r.body.users.every(function (u) { return u.pass === undefined && u.reset_code === undefined && u.reset_code_expires === undefined; }));
  r = await call(H.users, { method: 'GET', query: { reveal: 'yvan@acquadue.ne', requestedBy: 'Yvan' } }, saToken);
  check("l'ancienne route 'voir mot de passe' ne renvoie plus rien", r.body.revealedPassword === undefined && JSON.stringify(r.body).indexOf('Admin@2026') < 0);
  r = await call(H.users, { method: 'GET', query: { sessions: '1' } }, saToken);
  check('liste des sessions (Super Admin)', r.statusCode === 200 && r.body.sessions.length >= 1);

  // creation de comptes
  const mk = function (nom, email, role, dept) {
    return call(H.users, { method: 'POST', body: { nom, email, pass: 'Welcome@2026', role, departement: dept, ini: nom.slice(0, 2).toUpperCase() } }, saToken);
  };
  r = await mk('Nadia Test', 'nadia@acquadue.ne', 'admin', 'Commercial');
  check('creation compte Admin (Nadia)', r.statusCode === 201, r.body);
  r = await mk('Harouna Test', 'harouna@acquadue.ne', 'collaborateur', 'Commercial');
  check('creation compte Collaborateur (Harouna)', r.statusCode === 201, r.body);
  r = await mk('Marie Test', 'marie@acquadue.ne', 'collaborateur', 'Marketing');
  check('creation compte Collaborateur (Marie, Marketing)', r.statusCode === 201);
  const stored = (await sqlRaw`SELECT pass, doit_changer_pass FROM users WHERE email = 'harouna@acquadue.ne'`)[0];
  check('nouveau compte : mot de passe chiffre + changement impose', stored.pass.indexOf('scrypt$') === 0 && stored.doit_changer_pass === true);
  r = await call(H.users, { method: 'POST', body: { nom: 'Z', email: 'z@x.ne', pass: 'faible', role: 'collaborateur' } }, saToken);
  check('creation refusee si mot de passe ne respecte pas les regles', r.statusCode === 400 && r.body.error === 'mot_de_passe_trop_faible');
  r = await call(H.users, { method: 'POST', body: { nom: 'Z', email: 'z@x.ne', pass: 'Welcome@2026', role: 'chef' } }, saToken);
  check('creation refusee si role inconnu', r.statusCode === 400);
  r = await call(H.users, { method: 'POST', body: { nom: 'Dup', email: 'harouna@acquadue.ne', pass: 'Welcome@2026' } }, saToken);
  check('email deja existant -> 409', r.statusCode === 409);

  // donnees metier
  r = await call(H.data, { method: 'POST', body: { entity: 'clients', row: { id: 9001, nom: 'Client Test', ville: 'Niamey', tel: '90000000' } } }, saToken);
  check('creer un client', r.statusCode === 201, r.body);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, saToken);
  check('lire les clients', r.statusCode === 200 && r.body.rows.some(function (x) { return Number(x.id) === 9001; }));
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 9001, patch: { statut: 'Client' } } }, saToken);
  check('modifier un client', r.statusCode === 200 && r.body.row.statut === 'Client');
  r = await call(H['bulk-load'], { method: 'GET' }, saToken);
  check('bulk-load (chargement complet) OK', r.statusCode === 200 && r.body.success && r.body.data.clients.length === 1, r.body && r.body.errors);
  r = await call(H.audit, { method: 'POST', body: { user_nom: 'Yvan', dept: 'Direction', action: 'Test', detail: 'ok', color: 'dot-green', ini: 'YL', col: 'av-red' } }, saToken);
  check('ecrire dans le journal', r.statusCode === 201);
  r = await call(H.audit, { method: 'GET' }, saToken);
  check('lire le journal', r.statusCode === 200 && r.body.logs.length >= 1);
  r = await call(H.audit, { method: 'GET', query: { clients_stats: '1' } }, saToken);
  check('diagnostic (Super Admin)', r.statusCode === 200 && r.body.total === 1, r.body);
  r = await call(H.backup, { method: 'POST', body: { type: 'Manuelle' } }, saToken);
  check('creer une sauvegarde', r.statusCode === 201 && r.body.backup && r.body.backup.id, r.body);
  const backupId = r.body.backup && r.body.backup.id;
  r = await call(H.backup, { method: 'GET' }, saToken);
  check("historique des sauvegardes", r.statusCode === 200 && r.body.backups.length === 1);
  r = await call(H.backup, { method: 'GET', query: { id: String(backupId) } }, saToken);
  const usersInBackup = r.body.backup && r.body.backup.payload && r.body.backup.payload.users;
  check('la sauvegarde ne contient AUCUN mot de passe ni code', Array.isArray(usersInBackup) &&
    usersInBackup.every(function (u) { return u.pass === undefined && u.reset_code === undefined; }));
  r = await call(H['export-data'], { method: 'GET' }, saToken);
  const dump = JSON.parse(r.body);
  check("export complet OK, sans mot de passe ni code", r.statusCode === 200 && dump.users.every(function (u) { return u.pass === undefined && u.reset_code === undefined; }) && dump._meta.exported_by === 'Yvan Leunkeu Djine');
  r = await call(H.data, { method: 'PUT', body: { entity: 'sensitive_perms', id: 'collaborateur', patch: { voir_stock: false } } }, saToken);
  check('Super Admin peut modifier la matrice des permissions', r.statusCode === 200, r.body);

  section('5. Collaborateur (Harouna) : droits limites');
  r = await login('harouna@acquadue.ne', 'Welcome@2026');
  check('connexion Harouna + changement impose', r.statusCode === 200 && r.body.user.doit_changer_pass === true);
  const hToken = r.body.token;
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, hToken);
  check('peut lire les donnees metier', r.statusCode === 200);
  r = await call(H.data, { method: 'POST', body: { entity: 'clients', row: { id: 9002, nom: 'Client Harouna' } } }, hToken);
  check('peut creer un client', r.statusCode === 201);
  r = await call(H.users, { method: 'GET' }, hToken);
  check('peut lister les collegues (sans secret)', r.statusCode === 200 && r.body.users.every(function (u) { return u.pass === undefined; }));
  const forbidden = [
    ['creer un compte',                  H.users,          { method: 'POST', body: { nom: 'Z', email: 'z@x.ne', pass: 'Welcome@2026' } }],
    ['lister les sessions',              H.users,          { method: 'GET', query: { sessions: '1' } }],
    ['desactiver un compte',             H.users,          { method: 'PUT', body: { id: 1, action: 'toggle_active' } }],
    ['reinitialiser le mdp du Super Admin', H.users,       { method: 'PUT', body: { id: 1, action: 'reset_password', value: 'Pirate@2027' } }],
    ['se donner le role superadmin',     H.users,          { method: 'PUT', body: { id: 2, action: 'update_profile', role: 'superadmin', departement: 'Direction', ville: 'X' } }],
    ['reinitialiser un departement',     H.users,          { method: 'PUT', body: { id: 1, action: 'reset_department', value: 'Direction' } }],
    ['fermer la session de quelqu un',   H.users,          { method: 'DELETE', body: { action: 'delete_session', token: saToken } }],
    ['sauvegardes (lire)',               H.backup,         { method: 'GET' }],
    ['sauvegardes (creer)',              H.backup,         { method: 'POST', body: { type: 'Manuelle' } }],
    ['export complet',                   H['export-data'], { method: 'GET' }],
    ['diagnostics du journal',           H.audit,          { method: 'GET', query: { createurs: 'assign', nom: 'Harouna Test' } }],
    ['modifier la matrice de permissions', H.data,         { method: 'PUT', body: { entity: 'sensitive_perms', id: 'collaborateur', patch: { voir_stock: true } } }],
    ['reinitialiser toutes les donnees', H['reset-data'],  { method: 'POST', body: { email: 'harouna@acquadue.ne', password: 'Welcome@2026', confirm: 'RESET' } }],
    ['restaurer une sauvegarde',         H['restore-backup'], { method: 'POST', body: { email: 'harouna@acquadue.ne', password: 'Welcome@2026', backupId, confirm: 'RESTORE' } }]
  ];
  for (const f of forbidden) {
    const rr = await call(f[1], f[2], hToken);
    check('INTERDIT : ' + f[0] + ' -> 403', rr.statusCode === 403, { code: rr.statusCode, body: rr.body });
  }
  r = await call(H.users, { method: 'PUT', body: { id: 1, action: 'change_own_password', currentPass: 'Admin@2026', newPass: 'Pirate@2027' } }, hToken);
  check("ne peut pas changer le mot de passe d'un autre compte", r.statusCode === 403);
  const stillOk = await login('yvan@acquadue.ne', 'Admin@2026');
  check('le mot de passe du Super Admin est intact', stillOk.statusCode === 200);

  section('6. Changement de mot de passe personnel');
  const hId = (await sqlRaw`SELECT id FROM users WHERE email = 'harouna@acquadue.ne'`)[0].id;
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'change_own_password', currentPass: 'faux', newPass: 'Nouveau@2027' } }, hToken);
  check('mot de passe actuel faux -> 401', r.statusCode === 401 && r.body.error === 'wrong_current_password');
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'change_own_password', currentPass: 'Welcome@2026', newPass: 'Welcome@2026' } }, hToken);
  check('reutiliser le mot de passe de depart refuse', r.statusCode === 400 && r.body.error === 'mot_de_passe_trop_faible');
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'change_own_password', currentPass: 'Welcome@2026', newPass: 'court' } }, hToken);
  check('mot de passe trop faible refuse', r.statusCode === 400);
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'change_own_password', currentPass: 'Welcome@2026', newPass: 'Nouveau@2027' } }, hToken);
  check('changement valide accepte', r.statusCode === 200);
  r = await login('harouna@acquadue.ne', 'Welcome@2026');
  check("l'ancien mot de passe ne marche plus", r.statusCode === 401);
  r = await login('harouna@acquadue.ne', 'Nouveau@2027');
  check('le nouveau mot de passe marche, plus de changement impose', r.statusCode === 200 && r.body.user.doit_changer_pass === false, r.body && r.body.user);

  section('7. Admin (Nadia) : droits intermediaires');
  r = await login('nadia@acquadue.ne', 'Welcome@2026');
  const nToken = r.body.token;
  r = await call(H.users, { method: 'POST', body: { nom: 'Cree Par Nadia', email: 'cpn@acquadue.ne', pass: 'Welcome@2026', role: 'collaborateur', departement: 'Commercial', ini: 'CN' } }, nToken);
  check('Admin peut creer un collaborateur', r.statusCode === 201);
  r = await call(H.users, { method: 'POST', body: { nom: 'Faux Admin', email: 'fa@acquadue.ne', pass: 'Welcome@2026', role: 'admin', departement: 'Commercial', ini: 'FA' } }, nToken);
  check('Admin ne peut PAS creer un autre Admin -> 403', r.statusCode === 403);
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'reset_password', value: 'Reset@2027X', forceChange: true } }, nToken);
  check('Admin peut reinitialiser un compte de SON departement', r.statusCode === 200, r.body);
  const mId = (await sqlRaw`SELECT id FROM users WHERE email = 'marie@acquadue.ne'`)[0].id;
  r = await call(H.users, { method: 'PUT', body: { id: mId, action: 'reset_password', value: 'Reset@2027X' } }, nToken);
  check("Admin ne peut PAS reinitialiser un autre departement -> 403", r.statusCode === 403);
  const saId = (await sqlRaw`SELECT id FROM users WHERE email = 'yvan@acquadue.ne'`)[0].id;
  r = await call(H.users, { method: 'PUT', body: { id: saId, action: 'reset_password', value: 'Reset@2027X' } }, nToken);
  check("Admin ne peut PAS reinitialiser le Super Admin -> 403", r.statusCode === 403);
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'reset_password', value: 'Welcome@2026' } }, saToken);
  check('reinitialisation avec un mot de passe de depart connu refusee', r.statusCode === 400);
  r = await call(H.users, { method: 'PUT', body: { id: saId, action: 'reset_via_email_code', value: 'Pirate@2027' } }, saToken);
  check("l'ancienne action 'reset_via_email_code' n'existe plus", r.statusCode === 400 && r.body.error === 'Action inconnue');
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  check('mot de passe reinitialise par Nadia utilisable', r.statusCode === 200 && r.body.user.doit_changer_pass === true);

  section('8. Anciens comptes (mot de passe en clair) : migration automatique');
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini) VALUES ('Ancien A','anciena@x.ne','Ancien@Pass1','collaborateur','Commercial','AA')`;
  r = await login('anciena@x.ne', 'Ancien@Pass1');
  check('un ancien compte peut encore se connecter', r.statusCode === 200);
  let row = (await sqlRaw`SELECT pass FROM users WHERE email = 'anciena@x.ne'`)[0];
  check('... et son mot de passe est maintenant chiffre', row.pass.indexOf('scrypt$') === 0);
  r = await login('anciena@x.ne', 'Ancien@Pass1');
  check('... et fonctionne toujours apres chiffrement', r.statusCode === 200);
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini) VALUES ('Ancien B','ancienb@x.ne','Comm@2026','collaborateur','Commercial','AB')`;
  r = await login('ancienb@x.ne', 'Comm@2026');
  check("ancien compte avec mot de passe de demo connu : changement impose", r.statusCode === 200 && r.body.user.doit_changer_pass === true);
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini) VALUES ('Ancien C','anciencc@x.ne','Zz@12345','collaborateur','Commercial','AC')`;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini) VALUES ('Ancien D','ancienD@x.ne','Mkt@2026','collaborateur','Commercial','AD')`;
  r = await call(H['init-db'], {}, saToken);
  check('init-db (connecte) migre les mots de passe restants', r.statusCode === 200 && r.body.mots_de_passe_chiffres === 2, r.body);
  const c = (await sqlRaw`SELECT pass, doit_changer_pass FROM users WHERE email = 'anciencc@x.ne'`)[0];
  const d = (await sqlRaw`SELECT pass, doit_changer_pass FROM users WHERE email = 'ancienD@x.ne'`)[0];
  check('mot de passe normal : chiffre, pas de changement impose', c.pass.indexOf('scrypt$') === 0 && c.doit_changer_pass === false);
  check('mot de passe de demo connu : chiffre ET changement impose', d.pass.indexOf('scrypt$') === 0 && d.doit_changer_pass === true);
  r = await login('anciencc@x.ne', 'Zz@12345');
  check('compte migre en masse : connexion toujours possible', r.statusCode === 200);
  const plainLeft = await sqlRaw`SELECT COUNT(*) AS n FROM users WHERE pass NOT LIKE 'scrypt$%'`;
  check('plus AUCUN mot de passe en clair dans la base', Number(plainLeft[0].n) === 0, plainLeft);

  section('9. Mot de passe oublie (code par email)');
  const mLogin = await login('marie@acquadue.ne', 'Welcome@2026');
  const mOldToken = mLogin.body.token;
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'request', email: 'marie@acquadue.ne' } });
  check('demande de code acceptee', r.statusCode === 200, r.body);
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'request', email: 'marie@acquadue.ne' } });
  check('2e demande immediate bloquee (anti-spam) -> 429', r.statusCode === 429 && r.body.error === 'trop_rapide');
  let code = (await sqlRaw`SELECT reset_code FROM users WHERE email = 'marie@acquadue.ne'`)[0].reset_code;
  check('code a 6 chiffres', /^\d{6}$/.test(code));
  r = await call(H.users, { method: 'GET' }, saToken);
  check('le code de reinitialisation N\'apparait PLUS dans la liste des utilisateurs', JSON.stringify(r.body).indexOf(code) < 0 && r.body.users.every(function (u) { return u.reset_code === undefined; }));
  const wrongCode = code === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 5; i++) {
    r = await call(H['forgot-password'], { method: 'POST', body: { action: 'verify', email: 'marie@acquadue.ne', code: wrongCode, newPassword: 'Nouveau@2028' } });
    check('mauvais code n°' + i + ' -> 401 invalid_code', r.statusCode === 401 && r.body.error === 'invalid_code', r.body);
  }
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'verify', email: 'marie@acquadue.ne', code: code, newPassword: 'Nouveau@2028' } });
  check('apres 5 essais rates, MEME le bon code est refuse (429)', r.statusCode === 429 && r.body.error === 'too_many_attempts', r.body);
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'verify', email: 'marie@acquadue.ne', code: code, newPassword: 'Nouveau@2028' } });
  check('le code est detruit : un nouveau code est necessaire', r.statusCode === 401 && r.body.error === 'invalid_code');
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'request', email: 'marie@acquadue.ne' } });
  check('nouvelle demande possible une fois le code detruit', r.statusCode === 200, r.body);
  code = (await sqlRaw`SELECT reset_code FROM users WHERE email = 'marie@acquadue.ne'`)[0].reset_code;
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'verify', email: 'marie@acquadue.ne', code: code, newPassword: 'faible' } });
  check('nouveau mot de passe trop faible refuse', r.statusCode === 400 && r.body.error === 'mot_de_passe_trop_faible');
  r = await call(H['forgot-password'], { method: 'POST', body: { action: 'verify', email: 'marie@acquadue.ne', code: code, newPassword: 'Nouveau@2028' } });
  check('bon code + bon mot de passe -> reinitialisation reussie', r.statusCode === 200 && r.body.success, r.body);
  r = await login('marie@acquadue.ne', 'Nouveau@2028');
  check('connexion avec le nouveau mot de passe', r.statusCode === 200);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, mOldToken);
  check("les anciennes sessions de Marie sont fermees apres reinitialisation", r.statusCode === 401);

  section('10. Sessions : expiration, desactivation, verrouillage');
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, hToken);
  check('(controle) session de Harouna valide', r.statusCode === 200);
  await sqlRaw`UPDATE sessions SET created_at = NOW() - INTERVAL '91 days' WHERE token = ${hToken}`;
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, hToken);
  check('session de plus de 90 jours refusee', r.statusCode === 401);
  r = await call(H.login, { method: 'POST', body: { action: 'verify-token', token: hToken } });
  check('verify-token refuse aussi une session expiree', r.statusCode === 401);
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  const hToken2 = r.body.token;
  check('reconnexion possible', r.statusCode === 200);
  const left = await sqlRaw`SELECT COUNT(*) AS n FROM sessions WHERE token = ${hToken}`;
  check('session expiree supprimee a la connexion suivante (menage)', Number(left[0].n) === 0);
  // desactivation
  r = await call(H.users, { method: 'PUT', body: { id: hId, action: 'toggle_active' } }, saToken);
  check('Super Admin desactive Harouna', r.statusCode === 200 && r.body.actif === false);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, hToken2);
  check('sa session est immediatement refusee', r.statusCode === 401);
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  check('et il ne peut plus se connecter (403 inactive)', r.statusCode === 403 && r.body.error === 'inactive');
  await call(H.users, { method: 'PUT', body: { id: hId, action: 'toggle_active' } }, saToken);
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  const hToken3 = r.body.token;
  check('reactive : connexion de nouveau possible', r.statusCode === 200);
  // verrouillage par essais rates
  for (let i = 0; i < 5; i++) await login('harouna@acquadue.ne', 'mauvais');
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  check('5 mauvais essais -> compte verrouille (403 locked)', r.statusCode === 403 && r.body.error === 'locked');
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, hToken3);
  check("un tiers ne peut pas deconnecter Harouna en verrouillant son compte (session ouverte conservee)", r.statusCode === 200);
  await call(H.users, { method: 'PUT', body: { id: hId, action: 'unlock' } }, saToken);
  r = await login('harouna@acquadue.ne', 'Reset@2027X');
  check('deverrouillage par le Super Admin', r.statusCode === 200);
  // fermeture de session par le Super Admin
  const ss = await call(H.users, { method: 'GET', query: { sessions: '1' } }, saToken);
  const victim = ss.body.sessions.find(function (s) { return s.nom === 'Harouna Test'; });
  r = await call(H.users, { method: 'DELETE', body: { action: 'delete_session', token: victim.token } }, saToken);
  check('Super Admin ferme la session de quelqu un', r.statusCode === 200);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, victim.token);
  check('... qui est alors deconnecte', r.statusCode === 401);

  section('11. Deconnexion');
  r = await call(H.login, { method: 'POST', body: { action: 'logout', token: nToken } });
  check('logout', r.statusCode === 200);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, nToken);
  check('apres deconnexion, le jeton ne marche plus', r.statusCode === 401);

  section('12. Operations dangereuses (Super Admin + mot de passe + confirmation)');
  r = await call(H['restore-backup'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'faux', backupId, confirm: 'RESTORE' } }, saToken);
  check('restauration : mauvais mot de passe -> 401', r.statusCode === 401);
  r = await call(H['restore-backup'], { method: 'POST', body: { email: 'autre@x.ne', password: 'Admin@2026', backupId, confirm: 'RESTORE' } }, saToken);
  check("restauration : email different du compte connecte -> 403", r.statusCode === 403);
  r = await call(H['restore-backup'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026', backupId } }, saToken);
  check('restauration : sans confirmation -> 400', r.statusCode === 400);
  await call(H.data, { method: 'DELETE', body: { entity: 'clients', id: 9001 } }, saToken);
  r = await call(H['restore-backup'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026', backupId, confirm: 'RESTORE' } }, saToken);
  check('restauration complete reussie (mot de passe + session)', r.statusCode === 200 && r.body.success, r.body);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, saToken);
  check('... le client supprime est revenu', r.body.rows.some(function (x) { return Number(x.id) === 9001; }));
  r = await call(H['reset-data'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'faux', confirm: 'RESET' } }, saToken);
  check('reinitialisation : mauvais mot de passe -> 401', r.statusCode === 401);
  r = await call(H['reset-data'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } }, saToken);
  check('reinitialisation : sans confirmation -> 400', r.statusCode === 400);
  r = await call(H['reset-data'], { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026', confirm: 'RESET' } }, saToken);
  check('reinitialisation complete reussie', r.statusCode === 200 && r.body.success, r.body);
  const usersLeft = await sqlRaw`SELECT COUNT(*) AS n FROM users`;
  check('seul le Super Admin subsiste', Number(usersLeft[0].n) === 1);

  console.log('\n══════════════════════════════════════════');
  console.log('RESULTAT : ' + pass + ' reussis, ' + fail + ' echoues');
  if (fail) { console.log('ECHECS :\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch(function (e) { console.error('ERREUR FATALE DU TEST', e); process.exit(2); });
