// /api/audit-createurs.js
// Endpoint de lecture SEULE (aucune ecriture, aucun risque) pour la decision
// "que faire des anciens devis/factures/depenses sans createur connu (cree_par
// vide, donnees crees avant la v45)".
//
// GET /api/audit-createurs
//   -> { devis: { total, sans_createur }, factures: {...}, depenses: {...} }
//
// GET /api/audit-createurs?detail=devis  (ou factures / depenses)
//   -> liste des lignes concernees (id, date, montant/client, etc.) pour
//      permettre une revue manuelle ligne par ligne (Option 3).

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();
    const detail = req.query.detail;

    if (detail === 'devis') {
      const rows = await sql`SELECT id, client, date_devis, statut, cree_par, created_at
                              FROM devis WHERE cree_par IS NULL OR cree_par = ''
                              ORDER BY created_at ASC NULLS FIRST`;
      return res.status(200).json({ table: 'devis', count: rows.length, rows });
    }
    if (detail === 'factures') {
      const rows = await sql`SELECT id, client, date_fact, statut, cree_par, created_at
                              FROM factures WHERE cree_par IS NULL OR cree_par = ''
                              ORDER BY created_at ASC NULLS FIRST`;
      return res.status(200).json({ table: 'factures', count: rows.length, rows });
    }
    if (detail === 'depenses') {
      const rows = await sql`SELECT id, libelle, montant, date_dep, departement, cree_par, created_at
                              FROM depenses WHERE cree_par IS NULL OR cree_par = ''
                              ORDER BY created_at ASC NULLS FIRST`;
      return res.status(200).json({ table: 'depenses', count: rows.length, rows });
    }

    // Vue resumee par defaut : juste les compteurs, pour les 3 tables.
    const [devisTotal, devisVides, factTotal, factVides, depTotal, depVides] = await Promise.all([
      sql`SELECT COUNT(*) AS n FROM devis`,
      sql`SELECT COUNT(*) AS n FROM devis WHERE cree_par IS NULL OR cree_par = ''`,
      sql`SELECT COUNT(*) AS n FROM factures`,
      sql`SELECT COUNT(*) AS n FROM factures WHERE cree_par IS NULL OR cree_par = ''`,
      sql`SELECT COUNT(*) AS n FROM depenses`,
      sql`SELECT COUNT(*) AS n FROM depenses WHERE cree_par IS NULL OR cree_par = ''`
    ]);

    return res.status(200).json({
      devis: { total: Number(devisTotal[0].n), sans_createur: Number(devisVides[0].n) },
      factures: { total: Number(factTotal[0].n), sans_createur: Number(factVides[0].n) },
      depenses: { total: Number(depTotal[0].n), sans_createur: Number(depVides[0].n) }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
