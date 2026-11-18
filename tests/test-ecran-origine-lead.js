// Teste (18/11/2026) : case « Origine du lead » a l'ecran (fiche client, fiche
// Pipeline, modification, recherche, filtre). Faux environnement.
// Usage : node tests/test-ecran-origine-lead.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

eval(grab('function origineLeadHtml(txt){', 'function viewClientDetail(id){'));
eval(grab('function mapClientFromDb(r){', 'function mapPipelineFromDb(r){'));

console.log('— 1. Lecture depuis la base');
const cl = mapClientFromDb({ id: 1, nom: 'Ali', notes: '', origine_lead: 'Lead recu via Meta\nCampagne : X' });
ok(cl.origineLead === 'Lead recu via Meta\nCampagne : X' && cl.notes === '', 'origine_lead -> origineLead, notes vides');
ok(mapClientFromDb({ id: 2 }).origineLead === '', 'fiche sans origine : vide');

console.log('— 2. Affichage');
ok(origineLeadHtml('Ligne 1\nLigne 2') === 'Ligne 1<br/>Ligne 2', 'retours a la ligne conserves');
ok(origineLeadHtml('<img src=x onerror=1>').indexOf('<img') < 0, 'affichage sans danger');
ok(/td-muted/.test(origineLeadHtml('')), 'vide : tiret gris');

console.log('— 3. Branchements dans la page');
const detail = grab('function viewClientDetail(id){', 'function syncDetailEditToDb');
ok(/\['Origine du lead', origineLeadHtml\(cl\.origineLead\)\]/.test(detail), 'fiche client : ligne « Origine du lead »');
ok(/\['Origine du lead', 'origineLead', cl\.origineLead \|\| '', 'textarea'\]/.test(detail), 'fiche client : origine modifiable (✏️ Modifier)');
ok(detail.indexOf("['Origine du lead', origineLeadHtml") < detail.indexOf("['Notes', cl.notes"), 'origine affichee avant les notes');
ok(/origine_lead:record\.origineLead\|\|''/.test(src), 'modification enregistree en base (origine_lead)');
ok(/\['Origine du lead', origineLeadHtml\(clLinked \? clLinked\.origineLead : ''\)\]/.test(src), 'fiche Pipeline : origine reprise de la fiche client');
ok(/'notes','origineLead'\]\); \}\);/.test(src), 'la barre de recherche cherche aussi dans l\'origine');
ok(/\(cl\.notes\|\|''\) \+ '\\n' \+ \(cl\.origineLead\|\|''\)/.test(src) && /Notes ou origine \(contient\)/.test(src), 'filtre « Notes ou origine » : cherche dans les deux');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
