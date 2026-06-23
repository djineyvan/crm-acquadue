// /api/restore-backup.js
// Restores the CRM's business data from a snapshot previously stored by
// /api/backup.js (backups_history table). This is the missing half of the
// backup feature: taking a snapshot is useless without a way to bring it
// back.
//
// SAFETY DESIGN:
// - Requires Super Admin email + matching password, exactly like /api/reset-data.
// - NEVER touches the `users` table. Backups never stored password hashes
//   (deliberately, to avoid leaking credentials into backup history), so
//   restoring `users` would either wipe everyone's password or silently do
//   nothing useful — excluding it entirely avoids a half-broken restore.
// - For every other table: wipes its CURRENT rows, then re-inserts every row
//   exactly as captured in the snapshot. This is the same "wipe, then
//   reinsert" approach reset-data.js already uses for resets, applied here
//   per-table from a payload instead of leaving tables empty.
// - Wrapped table-by-table in best-effort error handling so one malformed
//   table in an old snapshot can't abort the whole restore.
//
// POST /api/restore-backup { email, password, backupId, confirm: 'RESTORE' }

const { getSql } = require('../lib/db');

// Must mirror the table list in backup.js, minus 'users' (see safety note above).
const RESTORABLE_TABLES = [
  'clients', 'pipeline', 'tasks', 'comm_perf', 'campagnes', 'publications',
  'produits', 'entrepots', 'stock', 'mouvements_stock', 'fournisseurs',
  'commandes_fournisseur', 'demandes_achat', 'inventaires', 'devis', 'factures',
  'depenses', 'notifications', 'rh_presence', 'rh_conges', 'documents'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const { email, password, backupId, confirm } = req.body || {};
    if (confirm !== 'RESTORE') {
      return res.status(400).json({ error: 'Confirmation manquante (confirm doit valoir "RESTORE")' });
    }
    if (!email || !password) return res.status(400).json({ error: 'Identifiants requis' });
    if (!backupId) return res.status(400).json({ error: 'backupId manquant' });

    const sql = getSql();

    const userRows = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (userRows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = userRows[0];
    if (user.role !== 'superadmin') return res.status(403).json({ error: 'Seul le Super Admin peut restaurer une sauvegarde' });
    if (user.pass !== password) return res.status(401).json({ error: 'Mot de passe incorrect' });

    const backupRows = await sql`SELECT * FROM backups_history WHERE id = ${backupId}`;
    if (backupRows.length === 0) return res.status(404).json({ error: 'Sauvegarde introuvable' });
    const payload = backupRows[0].payload;

    const restored = [];
    const skipped = [];

    for (const table of RESTORABLE_TABLES) {
      const rows = payload[table];
      if (!Array.isArray(rows)) {
        skipped.push(table + ': absent de cette sauvegarde');
        continue;
      }
      try {
        await sql.query('DELETE FROM ' + table);

        for (const row of rows) {
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          const placeholders = cols.map(function(_, i) { return '$' + (i + 1); });
          const values = cols.map(function(c) {
            const v = row[c];
            return (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
          });
          const insertSql = 'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + placeholders.join(',') + ')';
          try {
            await sql.query(insertSql, values);
          } catch (rowErr) {
            // One malformed row shouldn't abort the whole table's restore.
            skipped.push(table + ' (une ligne): ' + rowErr.message);
          }
        }
        restored.push(table + ' (' + rows.length + ' lignes)');
      } catch (tableErr) {
        skipped.push(table + ': ' + tableErr.message);
      }
    }

    await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
               VALUES (${user.nom}, 'Direction', 'Restauration de sauvegarde',
               ${'Restauration depuis la sauvegarde #' + backupId + ' par ' + user.nom + ' (' + restored.length + ' tables restaurees)'},
               'dot-gold', ${user.ini}, ${user.col}, 'web')`;

    return res.status(200).json({
      success: true,
      restored_tables: restored,
      skipped: skipped,
      message: 'Restauration terminee (' + restored.length + ' tables restaurees). Rechargez la page pour voir les donnees restaurees.'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
