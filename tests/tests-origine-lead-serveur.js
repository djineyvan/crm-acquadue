// Tests du 18/11/2026 : « Origine du lead » separee des « Notes ».
//  - separerOrigine() : le bloc Meta part dans l'origine, ce que l'equipe a
//    ecrit reste dans les notes, rien n'est perdu.
//  - Deplacement UNE SEULE FOIS par /api/init-db, avec copie de secours et
//    ligne dans le Journal d'audit.
//  - /api/data enregistre et relit origine_lead.
// Base PostgreSQL de test en memoire (PGlite). Aucune donnee reelle n'est touchee.
// Usage : node tests/tests-origine-lead-serveur.js
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
const { separerOrigine } = require(REPO + '/lib/meta.js');
const sqlRaw = getSql();

let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }
function section(t) { console.log('\n== ' + t); }
function mkRes() { return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; } }; }
async function call(h, o, tok) { const res = mkRes(); const headers = Object.assign({}, o.headers || {}); if (tok) headers.authorization = 'Bearer ' + tok; try { await h({ method: o.method || 'GET', query: o.query || {}, body: o.body || {}, headers }, res); } catch (e) { res.statusCode = 599; res.body = { thrown: e.message }; } return res; }

const BLOC = 'Lead recu via Meta (Facebook) le 17/11/2026.\nCampagne : Purificateur Novembre\nAnnonce : Video V2 (ID 123)\nFormulaire : Devis (ID 9)\nVotre quartier : Plateau';

(async function () {
  section('1. Separation du texte');
  let s = separerOrigine(BLOC);
  check('lead Meta seul : tout part dans l\'origine, notes vides', s.origine === BLOC && s.notes === '', s);
  s = separerOrigine(BLOC + '\n\nRappeler samedi, interesse par le modele 2');
  check('note de l\'equipe apres une ligne vide : reste dans les notes', s.origine === BLOC && s.notes === 'Rappeler samedi, interesse par le modele 2', s);
  s = separerOrigine('Client vu au salon\n\n' + BLOC);
  check('note de l\'equipe avant le bloc : reste dans les notes', s.notes === 'Client vu au salon' && s.origine === BLOC, s);
  s = separerOrigine(BLOC + '\n\n[Nouveau formulaire Meta]\n' + BLOC.replace('17/11', '18/11') + '\n\nA livrer');
  check('doublon « Nouveau formulaire Meta » : les deux blocs dans l\'origine', /\[Nouveau formulaire Meta\]/.test(s.origine) && /18\/11/.test(s.origine) && /17\/11/.test(s.origine) && s.notes === 'A livrer', s);
  s = separerOrigine('Rappeler lundi');
  check('fiche sans bloc Meta : rien ne change', s.origine === '' && s.notes === 'Rappeler lundi', s);
  s = separerOrigine('');
  check('notes vides : rien', s.origine === '' && s.notes === '');
  const texte = 'A\n\n' + BLOC + '\n\nB\nC';
  s = separerOrigine(texte);
  const mots = function (t) { return t.split(/\s+/).filter(Boolean).sort().join(' '); };
  check('rien n\'est perdu (chaque mot est d\'un cote ou de l\'autre)', mots(s.origine + ' ' + s.notes) === mots(texte), s);

  section('2. Deplacement des fiches existantes (une seule fois)');
  await call(H['init-db'], {});
  const tok = (await call(H.login, { method: 'POST', body: { email: 'yvan@acquadue.ne', password: 'Admin@2026' } })).body.token;
  check('connexion Super Admin', !!tok);
  // La base de test etait vide au 1er passage : on rejoue comme en production.
  await sqlRaw`DELETE FROM audit_log WHERE action = 'Origine des leads deplacee'`;
  await sqlRaw`INSERT INTO clients (id, nom, notes) VALUES (1, 'Ali', ${BLOC})`;
  await sqlRaw`INSERT INTO clients (id, nom, notes) VALUES (2, 'Soul', ${BLOC + '\n\nRappeler samedi'})`;
  await sqlRaw`INSERT INTO clients (id, nom, notes) VALUES (3, 'Bio', 'Client du salon, rappeler')`;
  await sqlRaw`INSERT INTO clients (id, nom, notes) VALUES (4, 'Awa', 'Vu sur Facebook')`;
  await sqlRaw`INSERT INTO clients (id, nom, notes, origine_lead) VALUES (5, 'Dado', ${'[Nouveau formulaire Meta]\n' + BLOC}, 'Salon 2026')`;
  let r = await call(H['init-db'], {}, tok);
  check('init-db repond 200 et compte 3 fiches deplacees', r.statusCode === 200 && r.body.origine_deplacee && r.body.origine_deplacee.fiches === 3, r.body.origine_deplacee || r.body);
  const c = {}; (await sqlRaw`SELECT id, notes, origine_lead FROM clients`).forEach(function (x) { c[x.id] = x; });
  check('lead Meta : notes vides, origine remplie', c[1].notes === '' && c[1].origine_lead === BLOC, c[1]);
  check('note de l\'equipe gardee dans les notes', c[2].notes === 'Rappeler samedi' && c[2].origine_lead === BLOC, c[2]);
  check('fiche sans bloc Meta : intacte', c[3].notes === 'Client du salon, rappeler' && !c[3].origine_lead, c[3]);
  check('« Vu sur Facebook » (ecrit par l\'equipe) : laisse dans les notes', c[4].notes === 'Vu sur Facebook', c[4]);
  check('origine deja remplie : completee, pas ecrasee', /^Salon 2026\n\n\[Nouveau formulaire Meta\]/.test(c[5].origine_lead) && c[5].notes === '', c[5]);
  const sv = await sqlRaw`SELECT id, notes FROM sauvegarde_notes_origine ORDER BY id`;
  check('copie de secours des anciennes notes (3 fiches)', sv.length === 3 && sv[0].notes === BLOC, sv.map(function (x) { return x.id; }));
  const j = await sqlRaw`SELECT detail FROM audit_log WHERE action = 'Origine des leads deplacee'`;
  check('ligne dans le Journal d\'audit, avec le compte rendu', j.length === 1 && /^3 fiche\(s\)/.test(j[0].detail) && /1 gardent aussi des notes/.test(j[0].detail) && /1 autre\(s\) fiche\(s\) parlent encore de Meta/.test(j[0].detail), j);
  await sqlRaw`UPDATE clients SET notes = ${BLOC} WHERE id = 3`;
  r = await call(H['init-db'], {}, tok);
  check('2e passage : ne refait rien', r.body.origine_deplacee === null && (await sqlRaw`SELECT notes FROM clients WHERE id = 3`)[0].notes === BLOC, r.body.origine_deplacee);
  check('toujours une seule ligne dans le Journal', (await sqlRaw`SELECT 1 FROM audit_log WHERE action = 'Origine des leads deplacee'`).length === 1);

  section('3. Lecture et modification par l\'application');
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 3, patch: { origine_lead: 'Salon <b>Niamey</b>', notes: '' } } }, tok);
  check('modifier l\'origine (texte neutralise)', r.statusCode === 200 && r.body.row.origine_lead === 'Salon ‹b›Niamey‹/b›' && r.body.row.notes === '', r.body);
  r = await call(H.data, { method: 'GET', query: { entity: 'clients' } }, tok);
  check('origine_lead relue avec les fiches', (r.body.rows || []).some(function (x) { return x.id == 1 && x.origine_lead === BLOC; }));
  await sqlRaw.query('ALTER TABLE clients DROP COLUMN origine_lead');
  r = await call(H.data, { method: 'PUT', body: { entity: 'clients', id: 1, patch: { origine_lead: 'Test' } } }, tok);
  check('colonne absente : recreee a la volee, enregistrement reussi', r.statusCode === 200 && r.body.row.origine_lead === 'Test', r.body);

  console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
