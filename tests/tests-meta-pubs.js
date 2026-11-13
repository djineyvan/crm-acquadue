// Tests du 12/11/2026 (soir) : nom de la campagne, de l'ensemble de pub, de l'annonce
// et du formulaire dans les fiches Meta + bilan par publicite.
// Regle d'or verifiee ici : la lecture des noms est un BONUS. Si Meta la refuse ou
// tarde, le lead est quand meme cree normalement, avec les identifiants.
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
const H = { version: require(REPO + '/api/version.js'), init: require(REPO + '/api/init-db.js'), login: require(REPO + '/api/login.js') };
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
function payload(id, ad) { return JSON.stringify({ object: 'page', entry: [{ id: 'P1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: 'P1', form_id: 'F7', ad_id: ad || 'AD1' } }] }] }); }

function fd(nom, tel) { return [{ name: 'full_name', values: [nom] }, { name: 'phone_number', values: [tel] }]; }
// Faux Graph. mode : 'noms' (le lead donne les noms), 'parannonce' (seule l'annonce les donne),
// 'refus' (tout bonus refuse), 'lent' (les bonus ne repondent jamais)
let mode = 'noms'; let calls = [];
const PEOPLE = { A1: fd('Awa Noms', '+22790000001'), A2: fd('Bio Annonce', '+22790000002'), A3: fd('Cisse Refus', '+22790000003'), A4: fd('Dado Lent', '+22790000004'), A5: fd('Eli Noms', '+22790000005'), A6: fd('Fati Noms', '+22790000006') };
global.fetch = async function (url) {
  const u = new URL(url); calls.push(u);
  const path = u.pathname.replace(/^\/v[0-9.]+\//, ''); const fields = u.searchParams.get('fields') || '';
  const ok = function (j) { return { ok: true, status: 200, json: async () => j }; };
  const ko = function () { return { ok: false, status: 400, json: async () => ({ error: { message: 'missing permissions', code: 100, error_subcode: 33 } }) }; };
  if (PEOPLE[path]) {
    if (!fields) return ok({ id: path, field_data: PEOPLE[path] }); // lecture normale du lead
    if (mode === 'lent') return new Promise(function () {});        // ne repond jamais
    if (mode === 'noms') return ok({ id: path, ad_id: 'AD1', ad_name: 'Video famille 30s', adset_name: 'Niamey 25-45 ans', campaign_name: 'Purificateur Novembre', platform: 'ig' });
    if (mode === 'parannonce') return ok({ id: path, ad_id: 'AD2' }); // pas les noms
    return ko();
  }
  if (path === 'F7') return (mode === 'refus' || mode === 'lent') ? (mode === 'lent' ? new Promise(function () {}) : ko()) : ok({ id: 'F7', name: 'Formulaire devis purificateur' });
  if (path === 'AD2') return mode === 'parannonce' ? ok({ id: 'AD2', name: 'Carrousel produits', adset: { name: 'Maradi' }, campaign: { name: 'Notoriete Maradi' } }) : ko();
  return ko();
};

(async function () {
  await call(H.init, {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Harouna','h@x.ne','x','collaborateur','Commercial','H','av-blue','Niamey',true)`;

  section('1. Meta donne les noms avec le lead');
  mode = 'noms';
  let r = await post(payload('A1'));
  check('lead accepte', r.statusCode === 200 && r.body.ok !== false, r.body);
  let cl = (await sqlRaw`SELECT * FROM clients WHERE nom='Awa Noms'`)[0];
  check('fiche creee', !!cl);
  check('note : campagne', /Campagne : Purificateur Novembre/.test(cl.notes), cl.notes);
  check('note : ensemble de publicites', /Ensemble de publicites : Niamey 25-45 ans/.test(cl.notes), cl.notes);
  check('note : annonce avec son ID', /Annonce : Video famille 30s \(ID AD1\)/.test(cl.notes), cl.notes);
  check('note : formulaire avec son nom', /Formulaire : Formulaire devis purificateur \(ID F7\)/.test(cl.notes), cl.notes);
  check('note : plateforme Instagram', /via Meta \(Instagram\)/.test(cl.notes), cl.notes);
  let ml = (await sqlRaw`SELECT * FROM meta_leads WHERE leadgen_id='A1'`)[0];
  check('meta_leads : noms enregistres', ml.campagne === 'Purificateur Novembre' && ml.annonce === 'Video famille 30s' && ml.ensemble === 'Niamey 25-45 ans' && ml.formulaire === 'Formulaire devis purificateur' && ml.plateforme === 'Instagram', ml);
  const nt = (await sqlRaw`SELECT texte FROM notifications ORDER BY id DESC LIMIT 1`)[0];
  check('notification du commercial : nom de la pub', /pub « Video famille 30s »/.test(nt.texte), nt);
  check('tous les appels a Meta signes (appsecret_proof)', calls.every(function (u) { return /^[0-9a-f]{64}$/.test(u.searchParams.get('appsecret_proof') || ''); }));

  section("2. Le lead ne donne pas les noms : on les lit sur l'annonce");
  mode = 'parannonce';
  r = await post(payload('A2', 'AD2'));
  cl = (await sqlRaw`SELECT * FROM clients WHERE nom='Bio Annonce'`)[0];
  check('fiche creee', !!cl, r.body);
  check("noms lus sur l'annonce", /Campagne : Notoriete Maradi/.test(cl.notes) && /Annonce : Carrousel produits \(ID AD2\)/.test(cl.notes) && /Ensemble de publicites : Maradi/.test(cl.notes), cl.notes);

  section('3. Meta refuse tous les bonus : le lead est quand meme cree');
  mode = 'refus';
  r = await post(payload('A3', 'AD3'));
  cl = (await sqlRaw`SELECT * FROM clients WHERE nom='Cisse Refus'`)[0];
  ml = (await sqlRaw`SELECT * FROM meta_leads WHERE leadgen_id='A3'`)[0];
  check('lead cree normalement (statut ok)', !!cl && ml.status === 'ok', ml);
  check('les identifiants restent dans la note', /Annonce : \(ID\) AD3/.test(cl.notes) && /Formulaire : \(ID\) F7/.test(cl.notes), cl.notes);
  check('aucun nom invente', !/Campagne :/.test(cl.notes) && ml.campagne === null && ml.annonce === null, ml);

  section('4. Meta ne repond pas aux bonus : pas de blocage');
  mode = 'lent';
  const t0 = Date.now();
  r = await post(payload('A4', 'AD4'));
  const duree = Date.now() - t0;
  cl = (await sqlRaw`SELECT * FROM clients WHERE nom='Dado Lent'`)[0];
  check('lead cree malgre tout', !!cl && r.statusCode === 200, r.body);
  check('attente limitee (moins de 7,5 s)', duree < 7500, duree);

  section('5. Bilan par publicite (Centre de Controle)');
  mode = 'noms';
  await post(payload('A5')); await post(payload('A6'));
  await sqlRaw`UPDATE clients SET statut='Client actif' WHERE nom='Awa Noms'`;
  await sqlRaw`UPDATE clients SET statut='Contacte' WHERE nom='Eli Noms'`;
  await sqlRaw`UPDATE clients SET statut='Client perdu' WHERE nom='Fati Noms'`;
  r = await call(H.version, { query: { meta: 'status' } }, tok);
  check('status OK', r.statusCode === 200, r.body);
  const b = (r.body.bilan_publicites || []).find(function (x) { return x.annonce === 'Video famille 30s'; });
  check('bilan : 3 leads pour « Video famille 30s »', b && b.leads === 3 && b.campagne === 'Purificateur Novembre', r.body.bilan_publicites);
  check('bilan : 1 client gagne, 1 en discussion, 1 perdu', b && b.clients === 1 && b.en_cours === 1 && b.perdus === 1, b);
  const b3 = (r.body.bilan_publicites || []).find(function (x) { return x.annonce === 'Annonce AD3'; });
  check('pub sans nom : affichee avec son ID', b3 && b3.leads === 1, r.body.bilan_publicites);
  const rec = (r.body.recents || []).find(function (x) { return x.leadgen_id === 'A1'; });
  check('derniers leads : nom de la pub et de la campagne', rec && rec.annonce === 'Video famille 30s' && rec.campagne === 'Purificateur Novembre', rec);
  check('aucun secret dans la reponse', !/secret-app-test|page-token-test|mot-secret-test/.test(JSON.stringify(r.body)));
  const hTok = (await sqlRaw`INSERT INTO sessions (token, user_id) SELECT 'hh' || md5(random()::text), id FROM users WHERE nom='Harouna' RETURNING token`)[0].token;
  r = await call(H.version, { query: { meta: 'status' } }, hTok);
  check('bilan refuse a un Collaborateur (403)', r.statusCode === 403, r.statusCode);
  r = await call(H.version, { query: { meta: 'status' } });
  check('bilan refuse sans connexion (401)', r.statusCode === 401);

  section('6. Base deja existante (anciennes lignes sans les nouvelles colonnes)');
  const cols = (await sqlRaw`SELECT column_name FROM information_schema.columns WHERE table_name='meta_leads'`).map(function (x) { return x.column_name; });
  check('colonnes ajoutees automatiquement', ['campagne', 'ensemble', 'annonce', 'formulaire', 'plateforme'].every(function (c) { return cols.indexOf(c) > -1; }), cols);

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERREUR FATALE', e); process.exit(2); });
