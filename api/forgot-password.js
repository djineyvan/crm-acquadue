// /api/forgot-password.js
// Step 1: verifies user exists in DB, generates code, sends email via Resend.
// Step 2 (separate call action=verify): verifies code matches and updates password in DB.
// Codes are stored server-side in a simple in-memory map per serverless instance is NOT reliable,
// so instead we store the code + expiry directly in the users table (added columns).

const { getSql } = require('../lib/db');

function generateCode(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();
    const { action } = req.body || {};

    // Ensure reset-code columns exist (idempotent, runs fast if already there)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMP`;

    if (action === 'request') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email requis' });

      const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      const user = rows[0];
      if (!user.actif) return res.status(403).json({ error: 'inactive' });

      const code = generateCode();
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      await sql`UPDATE users SET reset_code = ${code}, reset_code_expires = ${expires.toISOString()} WHERE id = ${user.id}`;

      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (!RESEND_API_KEY) return res.status(500).json({ error: 'Cle API Resend non configuree' });

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
          <div style="background:#C8102E;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center">
            <h2 style="margin:0">💧 CRM Lorenzetti — Acqua Due</h2>
          </div>
          <div style="border:1px solid #e0e8f0;border-top:none;padding:24px;border-radius:0 0 10px 10px">
            <p>Bonjour,</p>
            <p>Une demande de reinitialisation de mot de passe a ete effectuee pour le compte :</p>
            <p style="font-weight:bold">${user.nom} (${user.email})</p>
            <div style="background:#fde8ec;border-radius:8px;padding:16px;text-align:center;margin:20px 0">
              <div style="font-size:11px;color:#C8102E;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Code de verification</div>
              <div style="font-size:28px;font-weight:bold;color:#C8102E;letter-spacing:4px">${code}</div>
            </div>
            <p style="font-size:13px;color:#666">Ce code est valable 15 minutes.</p>
            <p style="font-size:13px;color:#666">Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</p>
            <hr style="border:none;border-top:1px solid #e0e8f0;margin:20px 0"/>
            <p style="font-size:11px;color:#999;text-align:center">CRM Lorenzetti — Acqua Due Niger</p>
          </div>
        </div>`;

      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CRM Lorenzetti <onboarding@resend.dev>',
          to: ['djineyvan@yahoo.fr'],
          subject: 'Code de reinitialisation - ' + user.nom,
          html: html
        })
      });
      const emailData = await emailResp.json();
      if (!emailResp.ok) return res.status(500).json({ error: emailData.message || 'Erreur envoi email' });

      await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                 VALUES (${user.nom}, ${user.departement}, 'Code de reinitialisation envoye', 'Email envoye a djineyvan@yahoo.fr', 'dot-gold', ${user.ini}, ${user.col}, 'web')`;

      return res.status(200).json({ success: true });
    }

    if (action === 'verify') {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) return res.status(400).json({ error: 'Parametres manquants' });

      const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      const user = rows[0];

      if (!user.reset_code || user.reset_code !== code) {
        return res.status(401).json({ error: 'invalid_code' });
      }
      if (new Date(user.reset_code_expires) < new Date()) {
        return res.status(401).json({ error: 'code_expired' });
      }

      await sql`UPDATE users SET pass = ${newPassword}, doit_changer_pass = false, verrouille = false, tentatives = 0, reset_code = NULL, reset_code_expires = NULL WHERE id = ${user.id}`;
      await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                 VALUES (${user.nom}, ${user.departement}, 'Mot de passe reinitialise via email', 'Recuperation par code envoye a djineyvan@yahoo.fr', 'dot-green', ${user.ini}, ${user.col}, 'web')`;

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action inconnue (utilisez request ou verify)' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
