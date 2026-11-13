// Teste (13/11/2026, 4e partie) : tableau « Raisons des non qualifies » par mois
// dans les Rapports (+ export CSV), et correction de la suppression de commande
// fournisseur (plus de suppression en base apres « Annuler »).
// Faux environnement, aucune donnee reelle.
// Usage : node tests/test-ecran-rapport-nq.js /chemin/vers/index.html
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('introuvable : ' + a); return src.slice(i, j); }
let pass = 0, fail = 0; function ok(c, m, x) { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } }

eval(grab('const RAISONS_NQ =', 'var RAISON_NQ_CB').replace(/^const /gm, 'var '));
eval(grab('const MOIS_FR =', 'function duplicateContactsReportHtml(){').replace(/^const /gm, 'var '));
var CLIENTS = [];

console.log('— 1. Calcul par mois et par raison');
ok(/Aucune fiche/.test(nonQualifiesParMoisHtml()), 'aucune fiche : message clair');
CLIENTS = [
  { statut: 'Non qualifie', raisonNq: 'Hors zone', date: '02/11/2026' },
  { statut: 'Non qualifie', raisonNq: 'Hors zone', date: '15/11/2026' },
  { statut: 'Non qualifie', raisonNq: 'Faux numero', date: '20/11/2026 10:30' },
  { statut: 'Non qualifie', raisonNq: '', date: '30/10/2026' },
  { statut: 'Non qualifie', raisonNq: 'Pas interesse', date: '05/10/2026' },
  { statut: 'Non qualifie', raisonNq: 'Simple curieux', date: '' },
  { statut: 'Contacte', raisonNq: '', date: '02/11/2026' },
  { statut: 'Client perdu', raisonNq: 'Hors zone', date: '02/11/2026' }
];
const d = nonQualifiesParMois();
ok(d.total.n === 6, 'seules les fiches « Non qualifie » sont comptees (6)', d.total);
ok(d.lignes.map(function (l) { return l.label; }).join('|') === 'Novembre 2026|Octobre 2026|Date inconnue', 'mois recents en haut, « Date inconnue » en dernier', d.lignes.map(function (l) { return l.label; }));
const nov = d.lignes[0];
ok(nov.n === 3 && nov['Hors zone'] === 2 && nov['Faux numero'] === 1, 'novembre : 2 hors zone + 1 faux numero (date avec heure acceptee)', nov);
const oct = d.lignes[1];
ok(oct.n === 2 && oct['Sans raison'] === 1 && oct['Pas interesse'] === 1, 'octobre : 1 sans raison + 1 pas interesse', oct);
ok(d.lignes[2]['Simple curieux'] === 1, 'fiche sans date : rangee dans « Date inconnue »');
ok(d.colonnes.join('|') === 'Faux numero|Hors zone|Pas interesse|Simple curieux|Autre|Sans raison', 'colonnes = les 5 raisons + « Sans raison »', d.colonnes);
ok(d.total['Hors zone'] === 2 && d.total['Sans raison'] === 1, 'totaux par raison justes', d.total);

console.log('— 2. Affichage');
const html = nonQualifiesParMoisHtml();
ok(/<table>/.test(html) && /Novembre 2026/.test(html) && /TOTAL/.test(html), 'tableau avec mois et ligne TOTAL');
ok(/Part du total/.test(html) && /33 %/.test(html), 'ligne des pourcentages (2 hors zone sur 6 = 33 %)');

console.log('— 3. Branchements dans la page');
ok(/id="rpt-nq"/.test(src) && /el\('rpt-nq'\)\.innerHTML = nonQualifiesParMoisHtml\(\)/.test(src), 'carte « Raisons des non qualifies » presente et remplie dans les Rapports');
ok(/RAISONS DES NON QUALIFIES \(PAR MOIS\)/.test(src) && /const nqm = nonQualifiesParMois\(\)/.test(src), 'le tableau est aussi dans l\'export CSV');
const carte = grab("if(voitTout || dept === 'Commercial'){\n    h += '<div class=\"card\" style=\"margin-bottom:12px\"><div class=\"card-title\">🔍 Doublons", "  c.innerHTML = h;");
ok(/rpt-nq/.test(carte), 'visible pour la Direction et le Commercial (comme les doublons)');

console.log('— 4. Commande fournisseur : « Annuler » ne supprime plus rien en base');
ok(!/wrapAfter\('deleteCommande'/.test(src), 'l\'ancien doublon de suppression a disparu');
const fn = grab('function deleteCommande(id){', 'function receptionnerCommande(id){');
ok((fn.match(/dbDelete\('commandes_fournisseur'/g) || []).length === 1, 'deleteCommande enregistre la suppression une seule fois, apres confirmation');

console.log('\n' + pass + ' reussis, ' + fail + ' en echec');
process.exit(fail ? 1 : 0);
