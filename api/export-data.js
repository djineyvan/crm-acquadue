// /api/export-data.js
// GET: dumps every business table as a single JSON object, for the Super Admin
// to download as a manual backup of the entire CRM (in addition to Neon's own
// automatic infrastructure backups, which the user cannot access directly).

const { getSql } = require('../lib/db');

const TABLES = [
  'users', 'clients', 'pipeline', 'tasks', 'comm_perf', 'campagnes', 'publications',
  'produits', 'entrepots', 'stock', 'mouvements_stock', 'fournisseurs',
  'commandes_fournisseur', 'demandes_achat', 'inventaires', 'devis', 'factures',
  'depenses', 'notifications', 'rh_presence', 'rh_conges', 'documents', 'audit_log'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();
    const dump = {};

    for (const t of TABLES) {
      try {
        const rows = await sql.query('SELECT * FROM ' + t);
        // Never export password hashes/plaintext in the backup file
        if (t === 'users') {
          dump[t] = rows.map(function(r) { const c = Object.assign({}, r); delete c.pass; return c; });
        } else {
          dump[t] = rows;
        }
      } catch (e) {
        dump[t] = { error: 'table introuvable ou vide' };
      }
    }

    dump._meta = {
      exported_at: new Date().toISOString(),
      exported_by: req.query.by || 'inconnu',
      version: 'CRM Lorenzetti v10'
    };

    res.setHeader('Content-Disposition', 'attachment; filename="sauvegarde-crm-acquadue-' + new Date().toISOString().slice(0,10) + '.json"');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(JSON.stringify(dump, null, 2));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
