// /api/users.js
// GET: list all users (jamais de mot de passe ni de code de reinitialisation)
//      ?sessions=1 : liste des sessions actives (Super Admin uniquement)
// POST: create a new user
// PUT: update a user (reset password, toggle active, unlock, change role, etc.)
// DELETE: ferme une session (Super Admin uniquement)
//
// SECURITE : toutes les operations exigent une session valide (en-tete
// "Authorization: Bearer <jeton>"). Les actions sensibles sont reservees au
// Super Admin. Les mots de passe sont chiffres (scrypt) et ne peuvent plus
// jamais etre relus : l'ancienne route d'affichage des mots de passe a ete
// supprimee.

const crypto = require('crypto');
const { getSql } = require('../lib/db');
const { requireAuth, hashPassword, verifyPassword, publicUser, validatePasswordRules, isWeakDefaultPassword, neutraliserTexte } = require('../lib/auth');

const VALID_ROLES = ['collaborateur', 'responsable', 'admin', 'superadmin'];

function deny(res) { return res.status(403).json({ error: 'acces_refuse' }); }
function weakPassword(res) { return res.status(400).json({ error: 'mot_de_passe_trop_faible' }); }

// Un mot de passe est accepte s'il respecte les regles du CRM et n'est pas
// un mot de passe de depart connu (Admin@2026, Welcome@2026...).
function passwordAcceptable(pwd) {
  return validatePasswordRules(pwd) && !isWeakDefaultPassword(pwd);
}

module.exports = async function handler(req, res) {
  // Securite : plus d'en-tete CORS ouvert (Access-Control-Allow-Origin: *).
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const sql = getSql();

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // GET sessions actives : /api/users?sessions=1  (Super Admin uniquement)
      if (req.query.sessions) {
        const me = await requireAuth(req, res, sql, ['superadmin']);
        if (!me) return;
        const sessions = await sql`
          SELECT s.token, s.created_at, s.last_seen, s.user_agent,
                 u.nom, u.departement, u.ini, u.col
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          ORDER BY s.last_seen DESC
        `;
        return res.status(200).json({ sessions });
      }

      const me = await requireAuth(req, res, sql);
      if (!me) return;
      const rows = await sql`SELECT * FROM users ORDER BY id ASC`;
      return res.status(200).json({ users: rows.map(publicUser) });
    }

    // ── POST : creation d'un compte ─────────────────────────────────────────
    if (req.method === 'POST') {
      const me = await requireAuth(req, res, sql, ['superadmin', 'admin', 'responsable']);
      if (!me) return;

      const b0 = req.body || {};
      // SECURITE (13/11/2026) : textes affiches neutralises (< >) ; le mot de passe n'est pas touche.
      const { nom, email, role, departement, ini, col, ville } = neutraliserTexte(b0);
      const pass = b0.pass;
      if (!nom || !email || !pass) return res.status(400).json({ error: 'Champs manquants' });

      const newRole = role || 'collaborateur';
      if (VALID_ROLES.indexOf(newRole) < 0) return res.status(400).json({ error: 'Role invalide' });
      // Seul le Super Admin peut creer un compte Admin ou Super Admin
      if ((newRole === 'admin' || newRole === 'superadmin') && me.role !== 'superadmin') return deny(res);
      // Mot de passe de creation : regles du CRM (le mot de passe temporaire
      // Welcome@2026 est autorise ici car son changement est impose a la 1re connexion)
      if (!validatePasswordRules(pass)) return weakPassword(res);

      const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (existing.length > 0) return res.status(409).json({ error: 'Cet email existe deja' });

      const passHash = await hashPassword(pass);
      const inserted = await sql`INSERT INTO users (nom, email, pass, role, departement, ini, col, ville, doit_changer_pass)
                                  VALUES (${nom}, ${email}, ${passHash}, ${newRole}, ${departement || 'Commercial'}, ${ini}, ${col || 'av-blue'}, ${ville || 'Niamey'}, true)
                                  RETURNING id, nom, email, role, departement`;
      return res.status(201).json({ success: true, user: inserted[0] });
    }

    // ── PUT : modifications ─────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const me = await requireAuth(req, res, sql);
      if (!me) return;
      const isSA = me.role === 'superadmin';

      const { id, action, value } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'Parametres manquants' });

      const userRows = await sql`SELECT * FROM users WHERE id = ${id}`;
      if (userRows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
      const target = userRows[0];

      if (action === 'toggle_active') {
        if (!isSA) return deny(res);
        const newVal = !target.actif;
        await sql`UPDATE users SET actif = ${newVal} WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${me.nom}, ${me.departement}, ${newVal?'Utilisateur active':'Utilisateur desactive'}, ${target.nom + ' - ' + target.email}, ${newVal?'dot-green':'dot-red'}, ${me.ini}, ${me.col}, 'web')`;
        return res.status(200).json({ success: true, actif: newVal });
      }

      if (action === 'unlock') {
        if (!isSA) return deny(res);
        await sql`UPDATE users SET verrouille = false, tentatives = 0 WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${me.nom}, ${me.departement}, 'Compte deverrouille', ${target.nom + ' - ' + target.email}, 'dot-green', ${me.ini}, ${me.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'reset_password') {
        // Super Admin : tous les comptes. Admin : uniquement les comptes de son
        // departement (jamais un Super Admin, jamais lui-meme).
        const adminOfSameDept = me.role === 'admin' && target.departement === me.departement &&
                                target.role !== 'superadmin' && String(target.id) !== String(me.id);
        if (!isSA && !adminOfSameDept) return deny(res);
        if (!passwordAcceptable(value)) return weakPassword(res);

        const forceChange = req.body.forceChange !== false;
        const passHash = await hashPassword(value);
        await sql`UPDATE users SET pass = ${passHash}, doit_changer_pass = ${forceChange}, verrouille = false, tentatives = 0 WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${me.nom}, ${me.departement}, 'Mot de passe reinitialise', ${'Pour: ' + target.nom + ' - Changement force: ' + (forceChange?'Oui':'Non')}, 'dot-gold', ${me.ini}, ${me.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      if (action === 'change_own_password') {
        // Uniquement son propre compte
        if (String(target.id) !== String(me.id)) return deny(res);
        const { currentPass, newPass } = req.body;
        const currentOk = await verifyPassword(currentPass, target.pass);
        if (!currentOk) {
          return res.status(401).json({ error: 'wrong_current_password' });
        }
        if (!passwordAcceptable(newPass)) return weakPassword(res);

        const passHash = await hashPassword(newPass);
        await sql`UPDATE users SET pass = ${passHash}, doit_changer_pass = false WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${target.nom}, ${target.departement}, 'Mot de passe modifie', ${target.nom + ' a change son propre mot de passe'}, 'dot-green', ${target.ini}, ${target.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      // NB : l'ancienne action "reset_via_email_code" a ete SUPPRIMEE. Elle
      // permettait de changer le mot de passe de n'importe quel compte sans
      // verifier aucun code. La reinitialisation par email passe uniquement par
      // /api/forgot-password (avec verification du code).

      if (action === 'reset_department') {
        if (!isSA) return deny(res);
        const dept = value;
        const deptUsers = await sql`SELECT id, nom FROM users WHERE departement = ${dept}`;
        for (const u of deptUsers) {
          const tempPass = 'Temp@' + (1000 + crypto.randomInt(0, 9000));
          const tempHash = await hashPassword(tempPass);
          await sql`UPDATE users SET pass = ${tempHash}, doit_changer_pass = true WHERE id = ${u.id}`;
        }
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${me.nom}, ${me.departement}, 'Reinitialisation par departement', ${dept + ' - ' + deptUsers.length + ' comptes reinitialises'}, 'dot-gold', ${me.ini}, ${me.col}, 'web')`;
        return res.status(200).json({ success: true, count: deptUsers.length });
      }

      if (action === 'update_profile') {
        if (!isSA) return deny(res);
        const { role, departement, ville } = neutraliserTexte(req.body);
        if (VALID_ROLES.indexOf(role) < 0) return res.status(400).json({ error: 'Role invalide' });
        await sql`UPDATE users SET role = ${role}, departement = ${departement}, ville = ${ville} WHERE id = ${id}`;
        await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                   VALUES (${me.nom}, ${me.departement}, 'Profil modifie',
                   ${target.nom + ' — role: ' + role + ', dept: ' + departement + ', ville: ' + ville},
                   'dot-gold', ${me.ini}, ${me.col}, 'web')`;
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Action inconnue' });
    }

    // ── DELETE : fermeture d'une session (Super Admin) ──────────────────────
    if (req.method === 'DELETE') {
      const me = await requireAuth(req, res, sql, ['superadmin']);
      if (!me) return;
      const { action, token } = req.body || {};
      if (action === 'delete_session' && token) {
        await sql`DELETE FROM sessions WHERE token = ${token}`;
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ error: 'Action inconnue' });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
