// Tests de bout en bout des routes /api/* du CRM Acqua Due contre une vraie base
// PostgreSQL de test (PGlite, en memoire). Aucune donnee reelle n'est touchee.
// Mise a jour 12/11/2026 : une erreur de lecture d'un lead renvoie 200 a Meta (au lieu de 500).
// Mise a jour 12/11/2026 (soir) : le CRM fait aussi des appels "bonus" (avec fields=...)
// pour lire les noms de campagne / annonce / formulaire ; on compte donc a part les
// appels de lecture du lead lui-meme.
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
const dbPath = require.resolve(REPO + '/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql } };

const H = {};
['login', 'users', 'data', 'bulk-load', 'audit', 'backup', 'export-data', 'reset-data',
 'restore-backup', 'init-db', 'forgot-password', 'version'].forEach(function (n) {
  H[n] = require(REPO + '/api/' + n + '.js');
});
const sqlRaw = getSql();

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

async function login(email, password) { return call(H.login, { method: 'POST', body: { email, password } }); }
const crypto = require('crypto');
const { Readable } = require('stream');
process.env.META_VERIFY_TOKEN = 'mot-secret-test';
process.env.META_APP_SECRET = 'secret-app-test';
process.env.META_PAGE_ACCESS_TOKEN = 'page-token-test';
process.env.META_LEAD_ASSIGNEE = 'Harouna';

let graphMode = 'ok'; let graphCalls = [];
// Appels de lecture du lead lui-meme (sans "fields=" : les appels bonus en ont un)
function leadCalls() { return graphCalls.filter(function (u) { return !/[?&]fields=/.test(u); }); }
const LEADS = {
  L1: { id: 'L1', ad_id: 'AD9', form_id: 'F7', field_data: [
    { name: 'full_name', values: ['Aminata Diallo'] }, { name: 'phone_number', values: ['p:+22790112233'] },
    { name: 'email', values: ['ami@test.ne'] }, { name: 'city', values: ['Maradi'] },
    { name: 'quel_produit_vous_interesse?', values: ['Purificateur maison'] } ] },
  L2: { id: 'L2', field_data: [ { name: 'full_name', values: ['Aminata D.'] }, { name: 'phone_number', values: ['+227 90 11 22 33'] } ] },
  L3: { id: 'L3', field_data: [ { name: 'first_name', values: ['Ibrahim'] }, { name: 'last_name', values: ['Sani'] }, { name: 'company_name', values: ['Hotel Palma'] }, { name: 'phone_number', values: ['96001122'] } ] }
};
global.fetch = async function (url) {
  graphCalls.push(String(url));
  if (graphMode === 'down') return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
  const id = new URL(url).pathname.split('/').pop();
  if (!LEADS[id]) return { ok: false, status: 400, json: async () => ({ error: { message: 'inconnu' } }) };
  return { ok: true, status: 200, json: async () => LEADS[id] };
};

function payload(ids) {
  return JSON.stringify({ object: 'page', entry: [{ id: 'P1', time: 1, changes: ids.map(i => ({ field: 'leadgen', value: { leadgen_id: i, page_id: 'P1', form_id: 'F7', ad_id: 'AD9', created_time: 1 } })) }] });
}
function sign(raw, secret) { return 'sha256=' + crypto.createHmac('sha256', secret || process.env.META_APP_SECRET).update(raw).digest('hex'); }
function mkRes() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } };
}
async function post(raw, sig, query) {
  const res = mkRes();
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST'; req.query = query || {}; req.headers = sig ? { 'x-hub-signature-256': sig } : {};
  await H.version(req, res); return res;
}
async function postParsed(rawText, sig) {
  const res = mkRes();
  const req = { method: 'POST', query: {}, headers: sig ? { 'x-hub-signature-256': sig } : {}, body: JSON.parse(rawText) };
  await H.version(req, res); return res;
}

(async function main() {
  await call(H['init-db'], {});
  const lg = await login('yvan@acquadue.ne', 'Admin@2026');
  const tok = lg.body.token;
  await sqlRaw`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville,actif) VALUES ('Harouna','h@x.ne','x','collaborateur','Commercial','H','av-blue','Niamey',true)`;

  section('Version (inchange)');
  let r = await call(H.version, {});
  check('GET /api/version renvoie la version', r.statusCode === 200 && r.body.version === 'dev', r.body);

  section('Verification du webhook');
  r = await call(H.version, { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'mot-secret-test', 'hub.challenge': '12345' } });
  check('bon jeton -> renvoie le challenge', r.statusCode === 200 && r.body === '12345', r.body);
  r = await call(H.version, { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'faux', 'hub.challenge': '12345' } });
  check('mauvais jeton -> 403', r.statusCode === 403);
  r = await call(H.version, { query: { 'hub.mode': 'subscribe', 'hub.challenge': '1' } });
  check('sans jeton -> 403', r.statusCode === 403);

  section('Signature');
  let raw = payload(['L1']);
  r = await post(raw, null);
  check('sans signature -> 401', r.statusCode === 401, r.body);
  r = await post(raw, sign(raw, 'autre-secret'));
  check('mauvaise signature -> 401', r.statusCode === 401);
  r = await post(raw, 'sha256=zzz');
  check('signature mal formee -> 401', r.statusCode === 401);
  check('aucun appel Graph ni creation si signature fausse', graphCalls.length === 0 && (await sqlRaw`SELECT 1 FROM clients`).length === 0);

  section('Lead valide');
  r = await post(raw, sign(raw));
  check('signature OK -> 200', r.statusCode === 200, r.body);
  let cl = await sqlRaw`SELECT * FROM clients`;
  check('prospect cree', cl.length === 1 && cl[0].nom === 'Aminata Diallo', cl);
  check('source Meta Ads, statut Nouveau prospect', cl[0].source === 'Meta Ads' && cl[0].statut === 'Nouveau prospect');
  check('telephone nettoye (+22790112233), ville Maradi', cl[0].tel === '+22790112233' && cl[0].ville === 'Maradi', cl[0]);
  check('assigne a Harouna', cl[0].asg === 'Harouna');
  check('notes contiennent la reponse du formulaire + ID annonce', /Purificateur maison/.test(cl[0].notes) && /AD9/.test(cl[0].notes), cl[0].notes);
  check('fiche pipeline creee', (await sqlRaw`SELECT * FROM pipeline WHERE nom='Aminata Diallo' AND etape='Nouveau prospect' AND asg='Harouna'`).length === 1);
  const nt = await sqlRaw`SELECT * FROM notifications`;
  check('notification pour Harouna', nt.length === 1 && nt[0].cible === 'Harouna' && /Aminata/.test(nt[0].texte), nt);
  const lc = leadCalls();
  check('jeton Graph envoye + appsecret_proof (lecture du lead : 1 appel)', lc.length === 1 && /access_token=page-token-test/.test(lc[0]) && /appsecret_proof=[0-9a-f]{64}/.test(lc[0]), graphCalls);
  check('tous les appels a Meta (y compris bonus) portent appsecret_proof', graphCalls.every(function (u) { return /appsecret_proof=[0-9a-f]{64}/.test(u); }), graphCalls);
  check('trace dans meta_leads (ok)', (await sqlRaw`SELECT status FROM meta_leads WHERE leadgen_id='L1'`)[0].status === 'ok');

  section('Anti-doublon');
  const nAvant = graphCalls.length;
  r = await post(raw, sign(raw));
  check('meme message renvoye -> 200 sans rien recreer ni rappeler Meta', r.statusCode === 200 && (await sqlRaw`SELECT 1 FROM clients`).length === 1 && graphCalls.length === nAvant);
  raw = payload(['L2']);
  r = await post(raw, sign(raw));
  cl = await sqlRaw`SELECT * FROM clients`;
  check('meme telephone (autre format) -> pas de nouvelle fiche', r.statusCode === 200 && cl.length === 1, cl.length);
  check('note ajoutee a la fiche existante', /Nouveau formulaire Meta/.test(cl[0].notes));
  check('pas de 2e fiche pipeline', (await sqlRaw`SELECT 1 FROM pipeline`).length === 1);

  section('Entreprise (B2B) + lot de plusieurs leads');
  raw = payload(['L3', 'L1']);
  r = await post(raw, sign(raw));
  cl = await sqlRaw`SELECT * FROM clients WHERE nom='Ibrahim Sani'`;
  check('lead B2B cree avec societe, ville par defaut Niamey', r.statusCode === 200 && cl.length === 1 && cl[0].type === 'B2B' && cl[0].societe === 'Hotel Palma' && cl[0].ville === 'Niamey', cl);

  section('Panne Meta (reprise)');
  graphMode = 'down';
  LEADS.L4 = { id: 'L4', field_data: [ { name: 'full_name', values: ['Fatou Moussa'] }, { name: 'phone_number', values: ['98000111'] } ] };
  raw = payload(['L4']);
  r = await post(raw, sign(raw));
  check('Graph en panne -> 200 a Meta, signale ok:false (plus de renvois en boucle)', r.statusCode === 200 && r.body.ok === false, r.body);
  let ml = await sqlRaw`SELECT status, error, attempts FROM meta_leads WHERE leadgen_id='L4'`;
  check('lead memorise en erreur', ml[0].status === 'erreur' && /boom/.test(ml[0].error) && ml[0].attempts === 1, ml);
  graphMode = 'ok';
  r = await post(raw, sign(raw));
  check('Meta renvoie -> lead cree', r.statusCode === 200 && (await sqlRaw`SELECT 1 FROM clients WHERE nom='Fatou Moussa'`).length === 1, r.body);
  graphMode = 'down'; LEADS.L5 = { id: 'L5', field_data: [{ name: 'full_name', values: ['Zara'] }, { name: 'phone_number', values: ['91000222'] }] };
  raw = payload(['L5']); await post(raw, sign(raw)); graphMode = 'ok';
  r = await call(H.version, { method: 'POST', query: { meta: 'retry' } });
  check('retry sans session -> 401', r.statusCode === 401);
  r = await call(H.version, { method: 'POST', query: { meta: 'retry' } }, tok);
  check('retry Super Admin -> relance 1, ok 1', r.statusCode === 200 && r.body.ok === 1, r.body);

  section('Etat de la connexion');
  r = await call(H.version, { query: { meta: 'status' } });
  check('status sans session -> 401', r.statusCode === 401);
  r = await call(H.version, { query: { meta: 'status' } }, tok);
  check('status Super Admin : configuration + compteurs', r.statusCode === 200 && r.body.configure.app_secret === true && r.body.leads.ok >= 4 && r.body.leads.erreur === 0, r.body);
  check('status ne divulgue AUCUN secret', !/secret-app-test|page-token-test|mot-secret-test/.test(JSON.stringify(r.body)));

  section('Corps deja transforme par Vercel (cas reel)');
  LEADS.P1 = { id: 'P1', field_data: [ { name: 'full_name', values: ['Moussa Ali'] }, { name: 'phone_number', values: ['97123456'] } ] };
  raw = payload(['P1']);
  r = await postParsed(raw, null);
  check('corps objet sans signature -> 401 (plus de 400)', r.statusCode === 401, r.body);
  r = await postParsed(raw, sign(raw, 'autre'));
  check('corps objet, mauvaise signature -> 401', r.statusCode === 401);
  r = await postParsed(raw, sign(raw));
  check('corps objet, bonne signature -> 200 et prospect cree', r.statusCode === 200 && (await sqlRaw`SELECT 1 FROM clients WHERE nom='Moussa Ali'`).length === 1, r.body);
  LEADS.P2 = { id: 'P2', field_data: [ { name: 'full_name', values: ['Zoe'] }, { name: 'phone_number', values: ['97654321'] } ] };
  const metaStyle = '{"object":"page","entry":[{"id":"P1","time":1,"changes":[{"field":"leadgen","value":{"leadgen_id":"P2","page_id":"P1","form_id":"F\\/7","ad_id":"AD9","note":"caf\\u00e9","created_time":1}}]}]}';
  r = await postParsed(metaStyle, sign(metaStyle));
  check('JSON style Meta (\\/ et \\u00e9) -> signature acceptee', r.statusCode === 200 && (await sqlRaw`SELECT 1 FROM clients WHERE nom='Zoe'`).length === 1, r.body);

  section('Journal des tentatives + cle secrete');
  const hitsRows = await sqlRaw`SELECT outcome FROM meta_hits`;
  check('refus de signature enregistre dans le journal', hitsRows.some(h => h.outcome === 'refuse_signature'), hitsRows);
  check('acceptation enregistree dans le journal', hitsRows.some(h => h.outcome === 'recu_ok'), hitsRows);
  const before = (await sqlRaw`SELECT COUNT(*)::int AS n FROM meta_hits`)[0].n;
  await post(payload(['L1']), null);
  check('message SANS signature : pas d\'ecriture en base (anti-spam)', (await sqlRaw`SELECT COUNT(*)::int AS n FROM meta_hits`)[0].n === before);
  r = await call(H.version, { query: { meta: 'status' } }, tok);
  check('status : tentatives + format de cle (secret de test = 15 car. -> signale)', Array.isArray(r.body.tentatives) && r.body.tentatives.length > 0 && r.body.app_secret_format_ok === false && r.body.app_secret_longueur === 15, r.body && [r.body.app_secret_format_ok, r.body.app_secret_longueur]);
  check('status ne divulgue toujours aucun secret', !/secret-app-test|page-token-test|mot-secret-test/.test(JSON.stringify(r.body)));

  section('Configuration manquante / charges inattendues');
  raw = JSON.stringify({ object: 'page', entry: [{ id: 'P1', changes: [{ field: 'feed', value: {} }] }] });
  r = await post(raw, sign(raw));
  check('evenement non-lead -> 200 ignore', r.statusCode === 200 && r.body.leads === 0);
  raw = 'pas du json'; r = await post(raw, sign(raw));
  check('JSON invalide mais signe -> 400', r.statusCode === 400);
  const saved = process.env.META_APP_SECRET; delete process.env.META_APP_SECRET;
  r = await post(payload(['L1']), 'sha256=' + 'a'.repeat(64));
  check('sans META_APP_SECRET -> 503, jamais d\'acceptation', r.statusCode === 503);
  process.env.META_APP_SECRET = saved;
  const sv = process.env.META_VERIFY_TOKEN; delete process.env.META_VERIFY_TOKEN;
  r = await call(H.version, { query: { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' } });
  check('sans META_VERIFY_TOKEN -> verification refusee', r.statusCode === 403);
  process.env.META_VERIFY_TOKEN = sv;

  console.log('\n' + pass + ' reussis, ' + fail + ' echecs'); if (fail) console.log(failures);
  process.exit(fail ? 1 : 0);
})();
