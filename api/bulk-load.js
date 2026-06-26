// /api/bulk-load.js
// Returns ALL business tables in a single response, replacing the previous
// approach of firing 19 separate /api/data?entity=... requests in parallel
// on every login/page-load.
//
// WHY THIS MATTERS: each /api/data call is its own Vercel serverless function
// invocation, each independently establishing its own Neon connection. Firing
// 19 of these simultaneously on every login meant 19 separate cold-starts /
// round-trips competing for the same concurrency limits, which is the most
// likely explanation for reports of "sometimes you have to log out and back
// in several times before the data settles" and dashboards/pipelines
// appearing to revert or show incomplete data — some of those 19 requests
// were landing late or getting throttled, and the UI rendered whatever had
// resolved by then.
//
// This endpoint runs all the SELECTs concurrently INSIDE one invocation
// (one cold start, one set of connections reused via Promise.all), so the
// client makes ONE request and gets a fully consistent snapshot back.
//
// GET /api/bulk-load -> { clients: [...], pipeline: [...], ... } for every table

const { getSql } = require('../lib/db');

const TABLES = [
  'clients', 'pipeline', 'tasks', 'comm_perf', 'campagnes', 'publications',
  'produits', 'entrepots', 'stock', 'mouvements_stock', 'fournisseurs',
  'commandes_fournisseur', 'demandes_achat', 'inventaires', 'devis', 'factures',
  'depenses', 'notifications', 'documents', 'rh_presence', 'rh_conges', 'sensitive_perms', 'roi_concurrents'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();

    // Run every table's SELECT concurrently within this single invocation.
    // A failure on one table must not take down the whole response — the
    // client falls back to an empty array for that table and keeps going,
    // rather than the whole login/reload failing.
    const results = await Promise.all(
      TABLES.map(function(table) {
        return sql.query('SELECT * FROM ' + table)
          .then(function(rows) { return { table: table, rows: rows, error: null }; })
          .catch(function(err) { return { table: table, rows: [], error: err.message }; });
      })
    );

    const payload = {};
    const errors = {};
    results.forEach(function(r) {
      payload[r.table] = r.rows;
      if (r.error) errors[r.table] = r.error;
    });

    return res.status(200).json({ success: true, data: payload, errors: errors });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
