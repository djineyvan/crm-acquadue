// /api/version.js — retourne un identifiant qui change a CHAQUE deploiement
// (le SHA du commit Git, fourni automatiquement par Vercel). Utilise par le
// front-end pour detecter qu'une nouvelle version a ete deployee pendant
// qu'un onglet etait reste ouvert, et proposer de recharger la page —
// au lieu de laisser l'utilisateur tester un ancien code en pensant que
// la derniere mise a jour n'a pas marche.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(200).json({ version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' });
};
