// /api/init-db.js
// One-time setup: creates tables and seeds initial data.
// Call this once via GET request after deployment, then it's safe to leave (idempotent).

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const sql = getSql();

    // ── Create tables ──
    await sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collaborateur',
      departement TEXT NOT NULL DEFAULT 'Commercial',
      ini TEXT,
      col TEXT DEFAULT 'av-blue',
      actif BOOLEAN DEFAULT true,
      ville TEXT DEFAULT 'Niamey',
      tentatives INT DEFAULT 0,
      verrouille BOOLEAN DEFAULT false,
      doit_changer_pass BOOLEAN DEFAULT false,
      dernier_login TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      user_nom TEXT, dept TEXT, action TEXT, detail TEXT, color TEXT, ini TEXT, col TEXT, ip TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY, nom TEXT NOT NULL, type TEXT DEFAULT 'B2C', ville TEXT, zone TEXT,
      tel TEXT, email TEXT, societe TEXT, source TEXT, statut TEXT DEFAULT 'Prospect froid',
      produit TEXT, assigne TEXT, date_creation TEXT, locked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS pipeline (
      id SERIAL PRIMARY KEY, nom TEXT NOT NULL, type TEXT DEFAULT 'B2C', valeur INT DEFAULT 0,
      etape TEXT DEFAULT 'Nouveau prospect', assigne TEXT, ville TEXT, date_estimee TEXT,
      locked BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY, titre TEXT NOT NULL, assigne TEXT, dept TEXT,
      priorite TEXT DEFAULT 'Moyenne', statut TEXT DEFAULT 'A faire', date_limite TEXT,
      locked BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS campagnes (
      id SERIAL PRIMARY KEY, nom TEXT NOT NULL, canal TEXT, budget INT DEFAULT 0,
      statut TEXT DEFAULT 'Active', leads INT DEFAULT 0, cout_lead INT DEFAULT 0,
      debut TEXT, fin TEXT, responsable TEXT, locked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS publications (
      id SERIAL PRIMARY KEY, titre TEXT NOT NULL, plateforme TEXT, format TEXT, date_pub TEXT,
      statut TEXT DEFAULT 'Brouillon', workflow TEXT DEFAULT 'Redacteur', redacteur TEXT,
      locked BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS produits (
      sku TEXT PRIMARY KEY, nom TEXT NOT NULL, categorie TEXT, marque TEXT DEFAULT 'Lorenzetti',
      description TEXT, prix_achat INT DEFAULT 0, prix_vente INT DEFAULT 0, prix_revendeur INT DEFAULT 0,
      tva INT DEFAULT 19, poids TEXT, dimensions TEXT, codebarre TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY, sku TEXT REFERENCES produits(sku), entrepot TEXT,
      qte INT DEFAULT 0, seuil INT DEFAULT 20, UNIQUE(sku, entrepot)
    )`;

    await sql`CREATE TABLE IF NOT EXISTS mouvements_stock (
      id SERIAL PRIMARY KEY, date_mvt TEXT, type TEXT, motif TEXT, sku TEXT, produit TEXT,
      qte INT, entrepot TEXT, user_nom TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS fournisseurs (
      id SERIAL PRIMARY KEY, nom TEXT NOT NULL, contact TEXT, tel TEXT, email TEXT,
      adresse TEXT, paiement TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS commandes_fournisseur (
      id SERIAL PRIMARY KEY, fournisseur TEXT, date_cmd TEXT, produits TEXT, montant INT,
      statut TEXT DEFAULT 'Brouillon', entrepot TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS demandes_achat (
      id SERIAL PRIMARY KEY, produit TEXT, qte INT, motif TEXT, demandeur TEXT,
      etape TEXT DEFAULT 'Demande', date_demande TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS inventaires (
      id SERIAL PRIMARY KEY, entrepot TEXT, type TEXT, date_inv TEXT,
      statut TEXT DEFAULT 'Planifie', ecarts INT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS devis (
      id TEXT PRIMARY KEY, client TEXT, produits TEXT, montant INT, date_devis TEXT,
      statut TEXT DEFAULT 'Envoye', validite TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS factures (
      id TEXT PRIMARY KEY, client TEXT, produits TEXT, montant INT, date_fact TEXT,
      statut TEXT DEFAULT 'Impayee', mode_paiement TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, icon TEXT, texte TEXT, cible TEXT, lu BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS rh_presence (
      id SERIAL PRIMARY KEY, nom TEXT, date_p TEXT, arrivee TEXT, depart TEXT, statut TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS rh_conges (
      id SERIAL PRIMARY KEY, nom TEXT, debut TEXT, fin TEXT, motif TEXT, statut TEXT DEFAULT 'En attente'
    )`;

    // ── Seed users only if table is empty (idempotent) ──
    const existingUsers = await sql`SELECT COUNT(*) as count FROM users`;
    let seeded = false;

    if (parseInt(existingUsers[0].count) === 0) {
      seeded = true;
      const seedUsers = [
        ['Yvan Leunkeu Djine','yvan@acquadue.ne','Admin@2026','superadmin','Direction','YL','av-red','Niamey'],
        ['Moussa Abdou','moussa@acquadue.ne','Comm@2026','collaborateur','Commercial','MA','av-blue','Niamey'],
        ['Fatima Oumarou','fatima@acquadue.ne','Comm@2026','collaborateur','Commercial','FO','av-green','Niamey'],
        ['Ibrahim Issoufou','ibrahim@acquadue.ne','Comm@2026','collaborateur','Commercial','II','av-gold','Zinder'],
        ['Aicha Mahamane','aicha@acquadue.ne','Resp@2026','responsable','Commercial','AM','av-purple','Maradi'],
        ['Salimata Diallo','salimata@acquadue.ne','Mkt@2026','admin','Marketing','SD','av-purple','Niamey'],
        ['Hamidou Garba','hamidou@acquadue.ne','Mkt@2026','collaborateur','Marketing','HG','av-gold','Tahoua'],
        ['Mariama Soule','mariama@acquadue.ne','Mkt@2026','collaborateur','Marketing','MS','av-blue','Niamey'],
        ['Abdoul Karim','abdoul@acquadue.ne','Com@2026','admin','Communication','AK','av-blue','Niamey'],
        ['Hawa Boubacar','hawa@acquadue.ne','Com@2026','collaborateur','Communication','HB','av-green','Niamey'],
      ];
      for (const u of seedUsers) {
        await sql`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville)
                   VALUES (${u[0]},${u[1]},${u[2]},${u[3]},${u[4]},${u[5]},${u[6]},${u[7]})
                   ON CONFLICT (email) DO NOTHING`;
      }
    }

    return res.status(200).json({ success: true, seeded: seeded, message: 'Base de donnees initialisee avec succes' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
