// /api/version.js
// 1) Retourne un identifiant qui change a CHAQUE deploiement (le SHA du commit
//    Git, fourni par Vercel). Utilise par le front-end pour detecter qu'une
//    nouvelle version a ete deployee pendant qu'un onglet etait reste ouvert.
// 2) Sert aussi de point d'entree pour la connexion Meta (webhook des
//    formulaires de leads) : toute la logique est dans lib/meta.js. Il est
//    place ici car le plan Vercel Hobby limite le nombre de fichiers dans api/.
const meta = require('../lib/meta');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (meta.isMetaRequest(req)) return meta.handle(req, res);
  res.status(200).json({ version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' });
};

// Le message de Meta est signe : on doit recevoir le corps BRUT (non transforme)
// pour verifier la signature.
module.exports.config = { api: { bodyParser: false } };
