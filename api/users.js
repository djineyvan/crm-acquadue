// /api/users.js
// GET: list all users (passwords excluded unless ?reveal=email&requestedBy=X for superadmin audit trail)
// POST: create a new user
// PUT: update a user (reset password, toggle active, unlock, change role, etc.)

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const reveal = req.query.reveal; // email of user whose password to reveal
      const requestedBy = req.query.requestedBy;

      const rows = await sql`SELECT * FROM users ORDER BY id ASC`;

      if (reveal && requestedBy) {
        const target = rows.find(function(u){ return u.email === reveal; });
        if (target) {
          await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                     VALUES (${requestedBy}, 'Direction', 'Mot de passe consulte', ${'Super Admin a consulte le mot de passe de ' + target.nom}, 'dot-gold', 'SA', 'av-red', 'web')`;
          return res.status(200).json({ users: rows, revealedPassword: target.pass });
        }
      }

      // strip passwords by default
      const safeRows = rows.map(function(u){ const copy = Object.assign({}, u); delete copy.pass; return copy; });
      return res.status(200).json({ users: safeRows });
    }

    if (req.method === 'POST') {
      const { nom, email, pass, role, departement, ini, col, ville } = req.body || {};
      if (!nom || !email || !pass) return res.status(400).json({ error: 'Champs manquants' });

      const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (existing.length > 0) return res.status(409).json({ error: 'Cet email existe deja' });

      const inserted = await sql`INSERT INTO users (nom, email, pass, role, departement, ini, col, ville, doit_changer_pass)
                                  VALUES (${nom}, ${email}, ${pass}, ${role || 'collaborateur'}, ${departement || 'Commercial'}, ${ini}, ${col || 'av-blue'}, ${ville || 'Niamey'}, true)
                                  RETURNING id, nom, email, role, departement`;
      return res.status(201).json({ success: true, user: inserted[0] });
    }

    if (req.method === 'PUT') {
      const { id, action, value, requestedBy } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'Parametres manquants' });

      const userRows = await sql`SELECT * FROM users WHERE id = ${id}`;
      if (userRows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
      const target = userRows[0];

      if (action === 'toggle_active') {
        const newVal = !target.actif;
        await sql`UPDATE users SET actif = ${newVal} WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${requestedBy||'Super Admin'}, 'Direction', ${newVal?'Utilisateur active':'Utilisateur desactive'}, ${target.nom + ' - ' + target.email}, ${newVal?'dot-green':'dot-red'}, 'SA', 'av-red', 'web')`;
        return res.status(200).json({ success: true, actif: newVal });
      }

      if (action === 'unlock') {
        await sql`UPDATE users SET verrouille = false, tentatives = 0 WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${requestedBy||'Super Admin'}, 'Direction', 'Compte deverrouille', ${target.nom + ' - ' + target.email}, 'dot-green', 'SA', 'av-red', 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'reset_password') {
        const forceChange = req.body.forceChange !== false;
        await sql`UPDATE users SET pass = ${value}, doit_changer_pass = ${forceChange}, verrouille = false, tentatives = 0 WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${requestedBy||'Super Admin'}, 'Direction', 'Mot de passe reinitialise', ${'Pour: ' + target.nom + ' - Changement force: ' + (forceChange?'Oui':'Non')}, 'dot-gold', 'SA', 'av-red', 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'change_own_password') {
        const { currentPass, newPass } = req.body;
        if (target.pass !== currentPass) {
          return res.status(401).json({ error: 'wrong_current_password' });
        }
        await sql`UPDATE users SET pass = ${newPass}, doit_changer_pass = false WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${target.nom}, ${target.departement}, 'Mot de passe modifie', ${target.nom + ' a change son propre mot de passe'}, 'dot-green', ${target.ini}, ${target.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'reset_via_email_code') {
        // used by forgot-password flow after code verification
        await sql`UPDATE users SET pass = ${value}, doit_changer_pass = false, verrouille = false, tentatives = 0 WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${target.nom}, ${target.departement}, 'Mot de passe reinitialise via email', 'Recuperation par code envoye a djineyvan@yahoo.fr', 'dot-green', ${target.ini}, ${target.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'reset_department') {
        const dept = value;
        const deptUsers = await sql`SELECT id, nom FROM users WHERE departement = ${dept}`;
        for (const u of deptUsers) {
          const tempPass = 'Temp@' + Math.floor(Math.random()*9000+1000);
          await sql`UPDATE users SET pass = ${tempPass}, doit_changer_pass = true WHERE id = ${u.id}`;
        }
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${requestedBy||'Super Admin'}, 'Direction', 'Reinitialisation par departement', ${dept + ' - ' + deptUsers.length + ' comptes reinitialises'}, 'dot-gold', 'SA', 'av-red', 'web')`;
        return res.status(200).json({ success: true, count: deptUsers.length });
      }

      return res.status(400).json({ error: 'Action inconnue' });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
