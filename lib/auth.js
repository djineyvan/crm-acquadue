// /lib/auth.js
// Module de securite partage par toutes les routes /api/*.
// (Ce fichier est dans lib/, il ne compte donc PAS dans la limite de 12
// fonctions serverless du plan Vercel Hobby.)
//
// Il fournit :
//   - requireAuth(req, res, sql, roles)  : exige un jeton de session valide
//   - hashPassword / verifyPassword      : mots de passe chiffres (scrypt)
//   - publicUser(row)                    : retire les champs secrets d'un utilisateur
//   - validatePasswordRules(pwd)         : memes regles que le CRM (8 car., maj., chiffre, special)
//   - isWeakDefaultPassword(pwd)         : detecte les mots de passe de depart connus

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// Duree de vie maximale d'une session : 90 jours (valeur ecrite directement dans
// la requete SQL ci-dessous et dans login.js). Au-dela, il faut se reconnecter.
const SESSION_MAX_DAYS = 90;

// ── Jeton de session ─────────────────────────────────────────────────────────
function getToken(req) {
  const h = (req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '';
  const m = /^Bearer\s+([A-Za-z0-9]{16,128})$/.exec(String(h).trim());
  return m ? m[1] : null;
}

// Retourne l'utilisateur lie au jeton (champs non secrets) ou null.
async function getCurrentUser(req, sql) {
  const token = getToken(req);
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.nom, u.email, u.role, u.departement, u.actif, u.verrouille, u.ini, u.col
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND (s.created_at IS NULL OR s.created_at > NOW() - INTERVAL '90 days')
  `;
  if (rows.length === 0) return null;
  const u = rows[0];
  // Un compte desactive perd immediatement ses sessions. Un compte simplement
  // verrouille (trop d'essais de connexion) garde ses sessions deja ouvertes :
  // sinon n'importe qui pourrait deconnecter un collegue en devinant son mot de passe.
  if (!u.actif) return null;
  return u;
}

// Exige une session valide. `roles` (optionnel) = liste des roles autorises.
// Si l'acces est refuse, la reponse est deja envoyee et la fonction retourne null :
// l'appelant doit simplement faire `if (!user) return;`.
async function requireAuth(req, res, sql, roles) {
  const user = await getCurrentUser(req, sql);
  if (!user) {
    res.status(401).json({ error: 'session_invalide' });
    return null;
  }
  if (roles && roles.length && roles.indexOf(user.role) < 0) {
    res.status(403).json({ error: 'acces_refuse' });
    return null;
  }
  return user;
}

// ── Mots de passe (scrypt, integre a Node : aucune dependance a ajouter) ────
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(plain), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.indexOf('scrypt$') === 0;
}

// Accepte aussi les anciens mots de passe en clair (migration transparente :
// ils sont rechiffres des que la connexion reussit).
async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string' || !plain || !stored) return false;
  if (isHashed(stored)) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!salt.length || !expected.length) return false;
    const actual = await scrypt(plain, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Utilisateur "public" : jamais de mot de passe ni de code de reinitialisation ──
const SECRET_USER_FIELDS = ['pass', 'reset_code', 'reset_code_expires', 'reset_attempts'];
function publicUser(row) {
  const copy = Object.assign({}, row);
  SECRET_USER_FIELDS.forEach(function (f) { delete copy[f]; });
  return copy;
}

// ── Regles de mot de passe (identiques a validatePassword() du CRM) ─────────
function validatePasswordRules(pwd) {
  if (typeof pwd !== 'string') return false;
  return pwd.length >= 8 &&
    /[A-Z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[!@#$%^&*(),.?":{}|<>_\-]/.test(pwd);
}

// Mots de passe de depart connus (anciens comptes de demonstration, mot de
// passe temporaire des nouveaux membres...). Si un compte en utilise encore un,
// le CRM force son changement a la prochaine connexion.
const WEAK_DEFAULTS = ['Admin@2026', 'Welcome@2026', 'Comm@2026', 'Mkt@2026'];
function isWeakDefaultPassword(plain) {
  if (typeof plain !== 'string') return false;
  return WEAK_DEFAULTS.indexOf(plain) >= 0 || /^Temp@\d{4}$/.test(plain);
}

module.exports = {
  requireAuth,
  getCurrentUser,
  getToken,
  hashPassword,
  verifyPassword,
  isHashed,
  publicUser,
  validatePasswordRules,
  isWeakDefaultPassword,
  SESSION_MAX_DAYS
};
