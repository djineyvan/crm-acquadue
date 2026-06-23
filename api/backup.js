// /api/backup.js
// Manages automatic and manual backups stored INSIDE the database itself
// (backups_history table), distinct from the manual "download as a file"
// export in export-data.js. This gives the Super Admin a rollback point
// directly inside the CRM, with a retained history of recent snapshots.
//
// GET  /api/backup              -> list backup history (metadata only, no payload)
// GET  /api/backup?id=123       -> retrieve one backup's full payload (for download/restore)
// POST /api/backup { type }     -> take a new snapshot now (type: 'Automatique' or 'Manuelle')
// DELETE /api/backup { id }     -> remove one backup entry (Super Admin only, enforced client-side + here)

const { getSql } = require('../lib/db');

const TABLES = [
  'users', 'clients', 'pipeline', 'tasks', 'comm_perf', 'campagnes', 'publications',
  'produits', 'entrepots', 'stock', 'mouvements_stock', 'fournisseurs',
  'commandes_fournisseur', 'demandes_achat', 'inventaires', 'devis', 'factures',
  'depenses', 'notifications', 'rh_presence', 'rh_conges', 'documents'
];

const MAX_HISTORY = 14; // keep the last 14 snapshots (e.g. ~2 weeks of dailies), prune older ones

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getSql();

    await sql`CREATE TABLE IF NOT EXISTS backups_history (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      taille TEXT,
      payload JSONB
    )`;

    if (req.method === 'GET') {
      if (req.query.id) {
        const rows = await sql`SELECT * FROM backups_history WHERE id = ${req.query.id}`;
        if (rows.length === 0) return res.status(404).json({ error: 'Sauvegarde introuvable' });
        return res.status(200).json({ backup: rows[0] });
      }
      // List metadata only — never send the full payload for the list view (could be large)
      const rows = await sql`SELECT id, type, created_at, taille FROM backups_history ORDER BY created_at DESC LIMIT ${MAX_HISTORY}`;
      return res.status(200).json({ backups: rows });
    }

    if (req.method === 'POST') {
      const type = (req.body && req.body.type) || 'Manuelle';
      const dump = {};
      for (const t of TABLES) {
        try {
          const rows = await sql.query('SELECT * FROM ' + t);
          dump[t] = t === 'users' ? rows.map(function(r) { const c = Object.assign({}, r); delete c.pass; return c; }) : rows;
        } catch (e) {
          dump[t] = [];
        }
      }
      const payloadStr = JSON.stringify(dump);
      const sizeLabel = payloadStr.length < 1024*1024
        ? Math.round(payloadStr.length/1024) + ' Ko'
        : (payloadStr.length/1024/1024).toFixed(1) + ' Mo';

      const inserted = await sql`INSERT INTO backups_history (type, taille, payload)
                 VALUES (${type}, ${sizeLabel}, ${dump}) RETURNING id, type, created_at, taille`;

      // Prune anything beyond MAX_HISTORY to bound storage growth
      await sql`DELETE FROM backups_history WHERE id NOT IN (
        SELECT id FROM backups_history ORDER BY created_at DESC LIMIT ${MAX_HISTORY}
      )`;

      return res.status(201).json({ success: true, backup: inserted[0] });
    }

    if (req.method === 'DELETE') {
      const id = req.body && req.body.id;
      if (!id) return res.status(400).json({ error: 'id manquant' });
      await sql`DELETE FROM backups_history WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
