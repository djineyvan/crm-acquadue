// Teste (18/11/2026) : informations du lead Meta affichees sur la fiche client
// (une ligne par information) et sur la fiche Pipeline. Faux environnement.
// Usage : node tests/test-ecran-infos-lead.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

function pipeDateRecuTexte(p) { return 'ID:' + p.id; }
eval(grab('function origineLeadHtml(txt){', 'function viewClientDetail(id){'));
eval(grab('function mapClientFromDb(r){', 'function mapPipelineFromDb(r){'));

console.log('— 1. Lecture depuis la base');
const cl = mapClientFromDb({ id: 1, nom: 'Awa', source: 'Meta Ads', lead_via: 'Meta (Instagram)', lead_recu_le: '2026-11-17T09:15:00.000Z',
  lead_campagne: 'Purif Nov', lead_ensemble: 'Niamey 25-45', lead_annonce: 'Video famille', lead_annonce_id: 'AD1',
  lead_formulaire: 'Devis', lead_formulaire_id: 'F7', origine_lead: 'Full name : Awa' });
ok(cl.leadVia === 'Meta (Instagram)' && cl.leadCampagne === 'Purif Nov' && cl.leadAnnonceId === 'AD1' && cl.leadFormulaireId === 'F7', 'toutes les colonnes du lead sont lues');

console.log('— 2. Lignes de la fiche client');
const rows = leadMetaRows(cl);
const lab = rows.map(function (r) { return r[0]; });
ok(JSON.stringify(lab) === JSON.stringify(['Lead recu via', 'Date de reception du lead', 'Nom de la campagne', 'Ensemble de publicites', 'Publicite (annonce) et ID', 'Formulaire (ID)', 'Contenu du formulaire']), 'les 7 lignes demandees, dans l\'ordre', lab);
ok(rows[0][1] === 'Meta (Instagram)', 'lead recu via');
ok(/17\/11\/2026 a \d{2}h15/.test(rows[1][1]), 'date et heure de reception', rows[1][1]);
ok(/Video famille/.test(rows[4][1]) && /ID AD1/.test(rows[4][1]), 'annonce et son ID');
ok(/Devis/.test(rows[5][1]) && /ID F7/.test(rows[5][1]), 'formulaire et son ID');
ok(rows[6][1] === 'Full name : Awa', 'contenu du formulaire');
ok(/17\/11\/2026$/.test(leadDateTexte({ leadRecuLe: '2026-11-17' })), 'date seule (anciennes fiches) : jj/mm/aaaa');
const pasMeta = leadMetaRows({ id: 5, source: 'Salon professionnel', origineLead: '' });
ok(pasMeta.length === 2 && pasMeta[0][0] === 'Date de reception du lead' && /ID:5/.test(pasMeta[0][1]), 'contact non Meta : seulement la date (heure de creation) et le contenu', pasMeta);
ok(leadNomEtId('<b>x</b>', '').indexOf('<b>') < 0, 'noms affiches sans danger');
ok(/td-muted/.test(leadNomEtId('', '')), 'vide : tiret gris');

console.log('— 3. Branchements dans la page');
ok(/\]\.concat\(leadMetaRows\(cl\)\)\.concat\(\[/.test(src), 'fiche client : lignes du lead apres « Source du prospect »');
ok(/'Contenu du formulaire':'origineLead'/.test(src), 'contenu du formulaire modifiable directement');
ok(/\['Pub Meta',/.test(src), 'fiche Pipeline : campagne › ensemble › annonce');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
