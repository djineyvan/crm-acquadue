// /api/login.js
// Handles authentication AND issues a persistent session token (stored client-side
// in localStorage). The token lets the user stay logged in across page reloads
// and browser restarts, until they explicitly log out.

const { getSql } = require('../lib/db');
const crypto = require('crypto');
const { hashPassword, verifyPassword, isHashed, publicUser, isWeakDefaultPassword } = require('../lib/auth');
const MAX_TENTATIVES = 5;

function generateToken(){
  return crypto.randomBytes(32).toString('hex');
}

module.exports = async function handler(req, res) {
  // Securite : plus d'en-tete CORS ouvert (Access-Control-Allow-Origin: *).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();
    const { action } = req.body || {};

    // ── action: "verify-token" — check an existing session token (auto-login on page load) ──
    if (action === 'verify-token') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token manquant' });

      const rows = await sql`
        SELECT u.* FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ${token}
          AND (s.created_at IS NULL OR s.created_at > NOW() - INTERVAL '90 days')
      `;
      if (rows.length === 0) return res.status(401).json({ error: 'invalid_token' });
      const user = rows[0];
      if (!user.actif) return res.status(403).json({ error: 'inactive' });

      await sql`UPDATE sessions SET last_seen = NOW() WHERE token = ${token}`;
      return res.status(200).json({ success: true, user: publicUser(user) });
    }

    // ── action: "logout" — revoke a session token ──
    if (action === 'logout') {
      const { token } = req.body;
      if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
      return res.status(200).json({ success: true });
    }

    // ── default action: email/password login, issues a new session token ──
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (rows.length === 0) return res.status(401).json({ error: 'not_found' });
    const user = rows[0];

    if (user.verrouille) return res.status(403).json({ error: 'locked' });
    if (!user.actif) return res.status(403).json({ error: 'inactive' });

    const passwordOk = await verifyPassword(password, user.pass);
    if (!passwordOk) {
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

    // Succes. Migration transparente : un ancien mot de passe en clair est
    // rechiffre maintenant. S'il s'agit d'un mot de passe de depart connu
    // (ex. ancien compte de demonstration), le changement est impose.
    if (!isHashed(user.pass)) {
      const newHash = await hashPassword(password);
      await sql`UPDATE users SET pass = ${newHash} WHERE id = ${user.id}`;
    }
    if (isWeakDefaultPassword(password) && !user.doit_changer_pass) {
      await sql`UPDATE users SET doit_changer_pass = true WHERE id = ${user.id}`;
      user.doit_changer_pass = true;
    }

    // Menage : supprime les sessions expirees (plus de 90 jours)
    await sql`DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '90 days'`;

    // Issue a persistent session token
    const token = generateToken();
    await sql`INSERT INTO sessions (token, user_id, user_agent) VALUES (${token}, ${user.id}, ${req.headers['user-agent'] || ''})`;
    await sql`UPDATE users SET tentatives = 0, dernier_login = NOW() WHERE id = ${user.id}`;
    await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
               VALUES (${user.nom}, ${user.departement}, 'Connexion', ${user.nom + " s'est connecte(e)"}, 'dot-green', ${user.ini}, ${user.col}, 'web')`;

    return res.status(200).json({ success: true, user: publicUser(user), token: token });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
