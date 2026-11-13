// Tests des correctifs du 12/11/2026 (lecture des leads Meta) :
//  - le message d'essai de Meta (leadgen_id 444444444444) est marque "essai", pas "erreur"
//  - une erreur de lecture renvoie 200 a Meta (plus de boucle de renvois) et le lead reste "erreur"
//  - relance automatique des anciens leads en erreur
//  - diagnostic ?meta=diag : reserve au Super Admin, conclusions correctes, aucun secret
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
const H = { version: require(REPO + '/api/version.js'), init: require(REPO + '/api/init-db.js'), login: require(REPO + '/api/login.js'), users: require(REPO + '/api/users.js') };
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
function payload(id, page) { return JSON.stringify({ object: 'page', entry: [{ id: page || 'P1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: page || 'P1', form_id: 'F7', ad_id: 'AD9' } }] }] }); }

// Faux Graph : scenario pilote par "mode"
let mode = 'permission'; let calls = [];
const PERM = { error: { message: "Unsupported get request. Object with ID 'X' does not exist, cannot be loaded due to missing permissions", type: 'GraphMethodException', code: 100, error_subcode: 33 } };
global.fetch = async function (url) {
  const u = new URL(url); calls.push(u); const path = u.pathname.replace(/^\/v[0-9.]+\//, '');
  const ok = function (j) { return { ok: true, status: 200, json: async () => j }; };
  const ko = function (j) { return { ok: false, status: 400, json: async () => j }; };
  if (path === 'me') return mode === 'expire' ? ko({ error: { message: 'Session has expired', code: 190 } }) : ok({ id: 'P1', name: 'Acqua Due' });
  if (path === 'app') return ok({ id: 'APP1', name: 'CRM Acqua Due' });
  if (path === 'debug_token') return ok({ data: { is_valid: true, type: 'PAGE', expires_at: 0, profile_id: 'P1', scopes: mode === 'noscope' ? ['pages_show_list'] : ['pages_show_list', 'leads_retrieval', 'pages_manage_metadata'] } });
  if (path === 'F7') return ok({ id: 'F7', name: 'Formulaire purificateur', status: 'ACTIVE' });
  if (path === 'F7/leads') {
    if (mode === 'permission') return ko(PERM);
    if (mode === 'empty') return ok({ data: [] });
    if (mode === 'listonly') {
      // 2 pages : le lead est sur la 2e (pagination testee)
      if (!u.searchParams.get('after')) return ok({ data: [{ id: 'X1', field_data: [] }], paging: { cursors: { after: 'C2' }, next: 'https://graph/next' } });
      return ok({ data: [{ id: 'R2', field_data: [{ name: 'full_name', values: ['Ali Garba'] }, { name: 'phone_number', values: ['+22796554433'] }] }] });
    }
    return ok({ data: [{ id: 'R1' }] });
  }
  if (path === 'R1') return mode === 'fixed' ? ok({ id: 'R1', field_data: [{ name: 'full_name', values: ['Awa Issa'] }, { name: 'phone_number', values: ['+22799887766'] }] }) : ko(PERM);
  return ko(PERM);
};

(async function () {
  await call(H.init, {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Harouna','h@x.ne','x','admin','Commercial','H','av-blue','Niamey',true)`;
  const hTok = (await sqlRaw`INSERT INTO sessions (token, user_id) SELECT 'hh' || md5(random()::text), id FROM users WHERE nom='Harouna' RETURNING token`)[0].token;

  section("Message d'essai de Meta (444444444444)");
  calls = [];
  let r = await post(payload('444444444444'));
  check('reponse 200', r.statusCode === 200, r.body);
  let ml = (await sqlRaw`SELECT status, nom FROM meta_leads WHERE leadgen_id='444444444444'`)[0];
  check('marque "test" (pas "erreur")', ml.status === 'test', ml);
  check("aucun appel a Meta pour l'essai", calls.length === 0, calls.length);
  check('aucune fiche client creee', (await sqlRaw`SELECT 1 FROM clients`).length === 0);

  section('Lead reel illisible (permission manquante)');
  r = await post(payload('R1'));
  check('reponse 200 a Meta (plus de 500 = plus de renvois en boucle)', r.statusCode === 200 && r.body.ok === false, r.body);
  ml = (await sqlRaw`SELECT status, error FROM meta_leads WHERE leadgen_id='R1'`)[0];
  check('lead memorise en erreur avec le code Meta', ml.status === 'erreur' && /code 100\/33/.test(ml.error), ml);
  let hit = (await sqlRaw`SELECT outcome FROM meta_hits ORDER BY id DESC LIMIT 1`)[0];
  check('journal : recu_erreur', hit.outcome === 'recu_erreur');

  section('Diagnostic');
  r = await call(H.version, { query: { meta: 'diag' } });
  check('sans session -> 401', r.statusCode === 401);
  r = await call(H.version, { query: { meta: 'diag' } }, hTok);
  check('Admin (pas Super Admin) -> 403', r.statusCode === 403, r.statusCode);
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  const E = r.body.etapes || {};
  check('Super Admin -> 200', r.statusCode === 200, r.body);
  check('jeton de Page lu (Acqua Due)', E.jeton_page && E.jeton_page.ok && E.jeton_page.page_nom === 'Acqua Due', E.jeton_page);
  check('details du jeton : PAGE, leads_retrieval, expire jamais', E.details_jeton && E.details_jeton.type === 'PAGE' && E.details_jeton.permissions.indexOf('leads_retrieval') > -1 && E.details_jeton.expire === 'jamais', E.details_jeton);
  check("le lead d'essai n'est pas analyse, le vrai lead oui", E.lead_en_erreur && E.lead_en_erreur.leadgen_id === 'R1' && E.lead_en_erreur.meme_page_que_le_jeton === true, E.lead_en_erreur);
  check('formulaire lisible, prospects refuses', E.formulaire.ok === true && E.lecture_leads_du_formulaire.ok === false, [E.formulaire, E.lecture_leads_du_formulaire]);
  check('conclusion : Acces aux prospects', /Acces aux prospects/.test(r.body.conclusion.join(' ')), r.body.conclusion);
  const dbgCall = calls.find(function (u) { return /debug_token/.test(u.pathname); });
  check('debug_token appele avec le jeton de l\'app (id|secret), cote serveur seulement', dbgCall && dbgCall.searchParams.get('access_token') === 'APP1|secret-app-test');
  check('le diagnostic ne divulgue AUCUN secret', !/secret-app-test|page-token-test|mot-secret-test/.test(JSON.stringify(r.body)));

  mode = 'noscope';
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  check('permission leads_retrieval absente -> conclusion adaptee', /leads_retrieval/.test(r.body.conclusion.join(' ')), r.body.conclusion);
  mode = 'expire';
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  check('jeton expire -> conclusion adaptee', /plus valide/.test(r.body.conclusion.join(' ')), r.body.conclusion);
  await sqlRaw`UPDATE meta_leads SET page_id='P9' WHERE leadgen_id='R1'`; mode = 'permission';
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  check('lead d\'une autre Page -> conclusion adaptee', /AUTRE Page/.test(r.body.conclusion.join(' ')), r.body.conclusion);
  await sqlRaw`UPDATE meta_leads SET page_id='P1' WHERE leadgen_id='R1'`;

  section('Relance automatique, une fois le probleme regle chez Meta');
  mode = 'fixed';
  await sqlRaw`UPDATE meta_leads SET updated_at = NOW() - INTERVAL '20 minutes' WHERE leadgen_id='R1'`;
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  check('diagnostic : lead lisible -> invite a relancer', /Relancer/.test(r.body.conclusion.join(' ')), r.body.conclusion);
  r = await post(JSON.stringify({ object: 'page', entry: [{ id: 'P1', changes: [{ field: 'feed', value: {} }] }] }));
  check('(un message sans lead ne relance rien)', (await sqlRaw`SELECT status FROM meta_leads WHERE leadgen_id='R1'`)[0].status === 'erreur');
  await post(payload('444444444444'));
  ml = (await sqlRaw`SELECT status, nom FROM meta_leads WHERE leadgen_id='R1'`)[0];
  check('le message suivant de Meta relance le lead en erreur -> ok', ml.status === 'ok' && ml.nom === 'Awa Issa', ml);
  check('fiche client creee', (await sqlRaw`SELECT 1 FROM clients WHERE nom='Awa Issa'`).length === 1);

  section('Lecture de secours via la liste du formulaire');
  mode = 'empty';
  await post(payload('R3'));
  r = await call(H.version, { query: { meta: 'diag' } }, tok);
  check('liste vide -> conclusion acces avance', /Advanced Access/.test(r.body.conclusion.join(' ')) && r.body.etapes.lecture_leads_du_formulaire.nb_visibles === 0, r.body);
  ml = (await sqlRaw`SELECT status, error FROM meta_leads WHERE leadgen_id='R3'`)[0];
  check("message d'erreur indique 0 prospect visible", ml.status === 'erreur' && /0 prospect\(s\) visibles/.test(ml.error), ml);
  await sqlRaw`DELETE FROM meta_leads WHERE leadgen_id='R3'`;
  mode = 'listonly';
  r = await post(payload('R2'));
  ml = (await sqlRaw`SELECT status, nom FROM meta_leads WHERE leadgen_id='R2'`)[0];
  check('lecture directe refusee mais lead trouve dans la liste (page 2) -> importe', ml.status === 'ok' && ml.nom === 'Ali Garba', ml);
  check('fiche client creee via la liste', (await sqlRaw`SELECT 1 FROM clients WHERE nom='Ali Garba'`).length === 1);

  section('Ignorer un lead fantome');
  mode = 'permission';
  await post(payload('R9'));
  r = await call(H.version, { method: 'POST', query: { meta: 'ignore' }, body: { leadgen_id: 'R9' } });
  check('ignorer sans session -> 401', r.statusCode === 401);
  r = await call(H.version, { method: 'POST', query: { meta: 'ignore' }, body: { leadgen_id: 'R9' } }, hTok);
  check('ignorer en Admin -> 403', r.statusCode === 403);
  await sqlRaw`UPDATE meta_leads SET leadgen_id='99887766' WHERE leadgen_id='R9'`;
  r = await call(H.version, { method: 'POST', query: { meta: 'ignore' }, body: { leadgen_id: '99887766' } }, tok);
  check('ignorer en Super Admin -> ok', r.statusCode === 200 && r.body.ok === true, r.body);
  ml = (await sqlRaw`SELECT status FROM meta_leads WHERE leadgen_id='99887766'`)[0];
  check('lead classe "ignore"', ml.status === 'ignore', ml);
  r = await call(H.version, { method: 'POST', query: { meta: 'retry' } }, tok);
  check('un lead ignore n\'est plus relance', r.body.relances === 0, r.body);
  r = await call(H.version, { method: 'POST', query: { meta: 'ignore' }, body: { leadgen_id: '' } }, tok);
  check('ignorer sans identifiant -> 400', r.statusCode === 400);

  section('Etat de la connexion');
  r = await call(H.version, { query: { meta: 'status' } }, tok);
  check('compteurs : 1 ok, 0 erreur, 1 essai', r.body.leads.ok === 2 && r.body.leads.erreur === 0 && r.body.leads.test === 1, r.body.leads);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
