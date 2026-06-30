// /api/audit.js
// GET:  fetch audit log entries, optionally filtered by department
//       OU (?createurs=1 / ?createurs=devis|factures|depenses) : diagnostic
//       lecture-seule des devis/factures/depenses crees avant la v45 sans
//       createur connu (cree_par vide) — utilise pour decider quoi faire de
//       ces anciens enregistrements. Regroupe ici plutot que dans un nouveau
//       fichier api/*.js car le plan Vercel Hobby limite a 12 fonctions
//       serverless par projet (deja atteint).
// POST: insert a new audit log entry (called by logAction() on every write action)

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getSql();

    if (req.method === 'GET' && req.query.fix_orphan_reserve) {
      // Outil temporaire ponctuel (reutilise) : remet a 0 la reserve d'une
      // ligne de stock (sku+entrepot) quand aucun devis/facture actif ne la
      // justifie. Usage ponctuel, retire juste apres.
      const sku = (req.query.sku || '').trim();
      const entrepot = (req.query.entrepot || '').trim();
      if (!sku || !entrepot) return res.status(400).json({ error: 'Parametres sku et entrepot requis' });
      const result = await sql`UPDATE stock SET reserve = 0 WHERE sku = ${sku} AND entrepot = ${entrepot} RETURNING *`;
      return res.status(200).json({ updated: result });
    }

    if (req.method === 'GET' && req.query.clients_stats) {
      // Diagnostic lecture-seule : repartition reelle des clients/prospects
      // par statut, pour comparer avec le KPI "Clients & Prospects actifs"
      // du Tableau de bord (qui exclut volontairement 'Client perdu').
      const total = await sql`SELECT COUNT(*) AS n FROM clients`;
      const parStatut = await sql`SELECT statut, COUNT(*) AS n FROM clients GROUP BY statut ORDER BY n DESC`;
      return res.status(200).json({
        total: Number(total[0].n),
        par_statut: parStatut.map(function(r){ return { statut: r.statut, n: Number(r.n) }; })
      });
    }

    if (req.method === 'GET' && req.query.createurs) {
      const detail = req.query.createurs; // '1' (resume), 'devis'/'factures'/'depenses' (liste), ou 'assign' (attribution)

      if (detail === 'assign') {
        // Attribution en une fois de TOUS les devis/factures/depenses sans
        // createur connu a une personne donnee (?nom=...). Action manuelle,
        // demandee explicitement par le Super Admin apres revue des listes
        // (?createurs=devis/factures/depenses) - jamais automatique.
        const nomDemande = (req.query.nom || '').trim();
        if (!nomDemande) return res.status(400).json({ error: 'Parametre nom manquant' });

        const userRows = await sql`SELECT nom, departement FROM users WHERE LOWER(nom) = LOWER(${nomDemande})`;
        if (userRows.length === 0) {
          return res.status(404).json({ error: 'Aucun utilisateur ne porte ce nom exact: ' + nomDemande });
        }
        const nomExact = userRows[0].nom;
        const dept = userRows[0].departement;

        const devisMaj = await sql`UPDATE devis SET cree_par = ${nomExact}
                                    WHERE cree_par IS NULL OR cree_par = '' RETURNING id`;
        const facturesMaj = await sql`UPDATE factures SET cree_par = ${nomExact}
                                       WHERE cree_par IS NULL OR cree_par = '' RETURNING id`;
        const depensesMaj = await sql`UPDATE depenses SET cree_par = ${nomExact},
                                       departement = COALESCE(NULLIF(departement, ''), ${dept})
                                       WHERE cree_par IS NULL OR cree_par = '' RETURNING id`;

        return res.status(200).json({
          attribue_a: nomExact,
          departement_utilise: dept,
          devis_mis_a_jour: devisMaj.length,
          factures_mises_a_jour: facturesMaj.length,
          depenses_mises_a_jour: depensesMaj.length
        });
      }

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

      // Vue resumee par defaut (createurs=1) : juste les compteurs.
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
    }

    if (req.method === 'GET' && req.query.search_contact) {
      // Diagnostic lecture-seule : recherche un nom ou un numero de telephone
      // dans clients, pipeline, devis et factures, pour comprendre pourquoi
      // un contact donne apparait (ou pas) dans tel ou tel module.
      const q = '%' + req.query.search_contact.trim() + '%';
      const [inClients, inPipeline, inDevis, inFactures] = await Promise.all([
        sql`SELECT id, nom, tel, statut, source, ville, asg, last_modified_at FROM clients WHERE nom ILIKE ${q} OR tel ILIKE ${q}`,
        sql`SELECT id, nom, tel, etape, asg, ville, last_modified_at FROM pipeline WHERE nom ILIKE ${q} OR tel ILIKE ${q}`,
        sql`SELECT id, client, date_devis, statut FROM devis WHERE client ILIKE ${q}`,
        sql`SELECT id, client, date_fact, statut FROM factures WHERE client ILIKE ${q}`
      ]);
      return res.status(200).json({
        recherche: req.query.search_contact,
        clients: inClients,
        pipeline: inPipeline,
        devis: inDevis,
        factures: inFactures
      });
    }

    if (req.method === 'GET' && req.query.sync_audit) {
      // Diagnostic lecture-seule : compare clients et pipeline nom-a-nom
      // (meme logique que syncPipelineToClient/syncClientToPipeline cote
      // client : nom trim + lowercase) pour reveler les desynchronisations :
      // - presents dans clients mais pas dans pipeline (et inversement)
      // - doublons de nom dans un meme module (qui cassent le matching 1-pour-1)
      const [clients, pipeline] = await Promise.all([
        sql`SELECT id, nom, tel, statut, source FROM clients`,
        sql`SELECT id, nom, tel, etape FROM pipeline`
      ]);
      function norm(n){ return (n||'').trim().toLowerCase(); }
      const clientNames = {}, pipelineNames = {};
      clients.forEach(function(c){ const k = norm(c.nom); (clientNames[k]=clientNames[k]||[]).push(c); });
      pipeline.forEach(function(p){ const k = norm(p.nom); (pipelineNames[k]=pipelineNames[k]||[]).push(p); });

      const clientsSansPipeline = clients.filter(function(c){ return !pipelineNames[norm(c.nom)]; });
      const pipelineSansClient = pipeline.filter(function(p){ return !clientNames[norm(p.nom)]; });
      const nomsDupClients = Object.keys(clientNames).filter(function(k){ return clientNames[k].length > 1; }).map(function(k){ return clientNames[k]; });
      const nomsDupPipeline = Object.keys(pipelineNames).filter(function(k){ return pipelineNames[k].length > 1; }).map(function(k){ return pipelineNames[k]; });

      return res.status(200).json({
        total_clients: clients.length,
        total_pipeline: pipeline.length,
        clients_sans_fiche_pipeline: clientsSansPipeline.length,
        pipeline_sans_fiche_client: pipelineSansClient.length,
        exemples_clients_sans_pipeline: clientsSansPipeline.slice(0, 15),
        exemples_pipeline_sans_client: pipelineSansClient.slice(0, 15),
        noms_dupliques_dans_clients: nomsDupClients,
        noms_dupliques_dans_pipeline: nomsDupPipeline
      });
    }

    if (req.method === 'GET') {
      const dept = req.query.dept;
      const rows = dept
        ? await sql`SELECT * FROM audit_log WHERE dept = ${dept} ORDER BY ts DESC LIMIT 200`
        : await sql`SELECT * FROM audit_log ORDER BY ts DESC LIMIT 200`;
      return res.status(200).json({ logs: rows });
    }

    if (req.method === 'POST') {
      const { user_nom, dept, action, detail, color, ini, col, ip } = req.body || {};
      await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
                 VALUES (${user_nom}, ${dept}, ${action}, ${detail}, ${color}, ${ini}, ${col}, ${ip || 'web'})`;
      return res.status(201).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
