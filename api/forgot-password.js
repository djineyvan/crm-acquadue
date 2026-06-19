// /api/forgot-password.js
// Sends a password-reset notification email via Resend.
// Expects POST body: { userName, userEmail, resetCode, requestedBy }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode non autorisee' });
  }

  try {
    const { userName, userEmail, resetCode, requestedBy } = req.body || {};

    if (!userName || !userEmail || !resetCode) {
      return res.status(400).json({ error: 'Parametres manquants' });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'Cle API Resend non configuree sur le serveur' });
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <div style="background:#C8102E;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center">
          <h2 style="margin:0">💧 CRM Lorenzetti — Acqua Due</h2>
        </div>
        <div style="border:1px solid #e0e8f0;border-top:none;padding:24px;border-radius:0 0 10px 10px">
          <p>Bonjour,</p>
          <p>Une demande de reinitialisation de mot de passe a ete effectuee pour le compte :</p>
          <p style="font-weight:bold">${userName} (${userEmail})</p>
          <p>Demandee par : ${requestedBy || 'Super Admin'}</p>
          <div style="background:#fde8ec;border-radius:8px;padding:16px;text-align:center;margin:20px 0">
            <div style="font-size:11px;color:#C8102E;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Code de reinitialisation</div>
            <div style="font-size:28px;font-weight:bold;color:#C8102E;letter-spacing:4px">${resetCode}</div>
          </div>
          <p style="font-size:13px;color:#666">Ce code est valable 15 minutes. Entrez-le dans l'ecran "Mot de passe oublie" du CRM pour definir un nouveau mot de passe.</p>
          <p style="font-size:13px;color:#666">Si vous n'etes pas a l'origine de cette demande, ignorez cet email ou contactez le Super Admin.</p>
          <hr style="border:none;border-top:1px solid #e0e8f0;margin:20px 0"/>
          <p style="font-size:11px;color:#999;text-align:center">CRM Lorenzetti — Acqua Due Niger</p>
        </div>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CRM Lorenzetti <onboarding@resend.dev>',
        to: ['djineyvan@yahoo.fr'],
        subject: 'Reinitialisation mot de passe - ' + userName,
        html: html
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Erreur Resend', details: data });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
