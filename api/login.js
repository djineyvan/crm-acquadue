// /api/login.js
// Handles authentication against the database (replaces in-memory check).

const { getSql } = require('../lib/db');
const MAX_TENTATIVES = 5;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const sql = getSql();
    const rows = await sql`SELECT * FROM users WHERE email = ${email}`;

    if (rows.length === 0) {
      return res.status(401).json({ error: 'not_found' });
    }
    const user = rows[0];

    if (user.verrouille) {
      return res.status(403).json({ error: 'locked' });
    }
    if (!user.actif) {
      return res.status(403).json({ error: 'inactive' });
    }

    if (user.pass !== password) {
      const newAttempts = (user.tentatives || 0) + 1;
      const shouldLock = newAttempts >= MAX_TENTATIVES;
      await sql`UPDATE users SET tentatives = ${newAttempts}, verrouille = ${shouldLock} WHERE id = ${user.id}`;

      if (shouldLock) {
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${user.nom}, ${user.departement}, 'Compte verrouille', ${user.nom + ' - trop de tentatives echouees'}, 'dot-red', ${user.ini}, ${user.col}, 'web')`;
        return res.status(403).json({ error: 'locked' });
      }
      return res.status(401).json({ error: 'wrong_password', tentatives: newAttempts, max: MAX_TENTATIVES });
    }

    // Success
    await sql`UPDATE users SET tentatives = 0, dernier_login = NOW() WHERE id = ${user.id}`;
    await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
               VALUES (${user.nom}, ${user.departement}, 'Connexion', ${user.nom + " s'est connecte(e)"}, 'dot-green', ${user.ini}, ${user.col}, 'web')`;

    delete user.pass; // never send password back except where explicitly needed
    return res.status(200).json({ success: true, user: user });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
