// /api/reset-data.js
// Wipes ALL business data (clients, pipeline, stock, devis, factures, audit, etc.)
// and removes every user account EXCEPT the one matching `keepEmail`.
// Protected: requires a valid superadmin email + matching password as confirmation.

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const { email, password, confirm } = req.body || {};
    if (confirm !== 'RESET') {
      return res.status(400).json({ error: 'Confirmation manquante (confirm doit valoir "RESET")' });
    }
    if (!email || !password) return res.status(400).json({ error: 'Identifiants requis' });

    const sql = getSql();
    const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = rows[0];
    if (user.role !== 'superadmin') return res.status(403).json({ error: 'Seul le Super Admin peut reinitialiser les donnees' });
    if (user.pass !== password) return res.status(401).json({ error: 'Mot de passe incorrect' });

    // Wipe all business tables (idempotent — ignores tables that may not exist yet)
    const tables = [
      'audit_log','clients','pipeline','tasks','campagnes','publications',
      'produits','stock','mouvements_stock','fournisseurs','commandes_fournisseur',
      'demandes_achat','inventaires','devis','factures','notifications',
      'rh_presence','rh_conges'
    ];
    for (const t of tables) {
      try { await sql.query('DELETE FROM ' + t); } catch (e) { /* table may not exist, ignore */ }
    }

    // Remove every user account except the requesting super admin
    await sql`DELETE FROM users WHERE id != ${user.id}`;

    await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
               VALUES (${user.nom}, 'Direction', 'Reinitialisation complete', 'Toutes les donnees de test ont ete supprimees par ' || ${user.nom}, 'dot-red', ${user.ini}, ${user.col}, 'web')`;

    return res.status(200).json({ success: true, message: 'Toutes les donnees ont ete reinitialisees. Seul votre compte Super Admin subsiste.' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
