// /api/reset-data.js
// Wipes ALL business data (clients, pipeline, stock, devis, factures, audit, etc.)
// and removes every user account EXCEPT the one matching `email`.
// Protected: requires a valid superadmin email + matching password as confirmation.
//
// IMPORTANT: this list MUST stay in sync with every table created in init-db.js.
// Previously, comm_perf, entrepots and depenses were added to init-db.js but
// never added here, so a "full reset" silently left products/warehouses/teams
// behind. Listing every table from the same source of truth prevents that
// from ever silently drifting out of sync again.

const { getSql } = require('../lib/db');
const { requireAuth, verifyPassword } = require('../lib/auth');

const ALL_BUSINESS_TABLES = [
  'audit_log', 'clients', 'pipeline', 'tasks', 'comm_perf', 'campagnes', 'publications',
  'produits', 'entrepots', 'stock', 'mouvements_stock', 'fournisseurs',
  'commandes_fournisseur', 'demandes_achat', 'inventaires', 'devis', 'factures',
  'depenses', 'notifications', 'rh_presence', 'rh_conges', 'documents'
];

module.exports = async function handler(req, res) {
  // Securite : plus d'en-tete CORS ouvert (Access-Control-Allow-Origin: *).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const { email, password, confirm } = req.body || {};
    if (confirm !== 'RESET') {
      return res.status(400).json({ error: 'Confirmation manquante (confirm doit valoir "RESET")' });
    }
    if (!email || !password) return res.status(400).json({ error: 'Identifiants requis' });

    const sql = getSql();

    // SECURITE : double verrou. 1) session de Super Admin valide, 2) mot de
    // passe re-saisi, qui doit etre celui du compte connecte.
    const me = await requireAuth(req, res, sql, ['superadmin']);
    if (!me) return;
    if (String(email).toLowerCase() !== String(me.email).toLowerCase()) {
      return res.status(403).json({ error: 'Identifiants differents du compte connecte' });
    }
    const rows = await sql`SELECT * FROM users WHERE id = ${me.id}`;
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = rows[0];
    if (!(await verifyPassword(password, user.pass))) return res.status(401).json({ error: 'Mot de passe incorrect' });

    const wiped = [];
    const skipped = [];
    for (const t of ALL_BUSINESS_TABLES) {
      try {
        await sql.query('DELETE FROM ' + t);
        wiped.push(t);
      } catch (e) {
        skipped.push(t + ': ' + e.message);
      }
    }

    // Also clear any active session tokens belonging to OTHER users, since their
    // accounts are about to be deleted (foreign key would cascade anyway, but
    // being explicit avoids relying on that).
    await sql`DELETE FROM sessions WHERE user_id != ${user.id}`;

    // Remove every user account except the requesting super admin
    await sql`DELETE FROM users WHERE id != ${user.id}`;

    await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
               VALUES (${user.nom}, 'Direction', 'Reinitialisation complete', ${'Toutes les donnees de test ont ete supprimees par ' + user.nom + ' (' + wiped.length + ' tables videes)'}, 'dot-red', ${user.ini}, ${user.col}, 'web')`;

    return res.status(200).json({
      success: true,
      tables_wiped: wiped,
      tables_skipped: skipped,
      message: 'Toutes les donnees ont ete reinitialisees (' + wiped.length + ' tables videes). Seul votre compte Super Admin subsiste.'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
