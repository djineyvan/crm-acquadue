// /api/init-db.js
// One-time setup: creates ALL tables and seeds ONLY the super admin account.
// Idempotent — safe to call multiple times (CREATE TABLE IF NOT EXISTS).

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const sql = getSql();

    // ── USERS & AUTH ──────────────────────────────────────────────────────────
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
      reset_code TEXT,
      reset_code_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── SESSION TOKENS (persistent login, "remember me" like Gmail) ─────────
    await sql`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW(),
      user_agent TEXT
    )`;

    // ── AUDIT LOG ─────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      user_nom TEXT, dept TEXT, action TEXT, detail TEXT, color TEXT, ini TEXT, col TEXT, ip TEXT
    )`;

    // ── CLIENTS / PROSPECTS ──────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS clients (
      id BIGINT PRIMARY KEY,
      nom TEXT NOT NULL, type TEXT DEFAULT 'B2C', ville TEXT, zone TEXT,
      tel TEXT, email TEXT, societe TEXT, source TEXT, statut TEXT DEFAULT 'Prospect froid',
      produit TEXT, asg TEXT, date_creation TEXT, locked BOOLEAN DEFAULT false,
      historique JSONB DEFAULT '[]',
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── PIPELINE (opportunites commerciales) ─────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS pipeline (
      id BIGINT PRIMARY KEY,
      nom TEXT NOT NULL, type TEXT DEFAULT 'B2C', val INT DEFAULT 0,
      etape TEXT DEFAULT 'Nouveau prospect', asg TEXT, ville TEXT, date_estimee TEXT,
      locked BOOLEAN DEFAULT false, sku TEXT, qte INT DEFAULT 1, entrepot TEXT,
      reservation_faite BOOLEAN DEFAULT false,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── TACHES ────────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS tasks (
      id BIGINT PRIMARY KEY,
      titre TEXT NOT NULL, asg TEXT, dept TEXT, pri TEXT DEFAULT 'Moyenne',
      statut TEXT DEFAULT 'A faire', date_limite TEXT, locked BOOLEAN DEFAULT false,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── EQUIPE COMMERCIALE (performance + historique modifications justifiees) ─
    await sql`CREATE TABLE IF NOT EXISTS comm_perf (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL, ville TEXT, zone TEXT, obj INT DEFAULT 0, ventes INT DEFAULT 0,
      nb INT DEFAULT 0, tx NUMERIC DEFAULT 5,
      date_enregistrement TEXT,
      historique_modifs JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── MARKETING ─────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS campagnes (
      id BIGINT PRIMARY KEY,
      nom TEXT NOT NULL, canal TEXT, budget INT DEFAULT 0, statut TEXT DEFAULT 'Active',
      leads INT DEFAULT 0, cout_lead INT DEFAULT 0, debut TEXT, fin TEXT, resp TEXT,
      locked BOOLEAN DEFAULT false,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── COMMUNICATION ─────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS publications (
      id BIGINT PRIMARY KEY,
      titre TEXT NOT NULL, plat TEXT, fmt TEXT, date_pub TEXT, statut TEXT DEFAULT 'Brouillon',
      workflow TEXT DEFAULT 'Redacteur', redacteur TEXT, locked BOOLEAN DEFAULT false,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── PRODUITS ──────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS produits (
      sku TEXT PRIMARY KEY,
      nom TEXT NOT NULL, categorie TEXT, marque TEXT DEFAULT 'Lorenzetti', desc_produit TEXT,
      prix_achat INT DEFAULT 0, prix_vente INT DEFAULT 0, prix_revendeur INT DEFAULT 0,
      tva INT DEFAULT 19, poids TEXT, dimensions TEXT, codebarre TEXT,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── ENTREPOTS ─────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS entrepots (
      id BIGINT PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL, type TEXT, ville TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── STOCK (Reel / Reserve / Disponible calcule) ──────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY,
      sku TEXT, entrepot TEXT, qte INT DEFAULT 0, reserve INT DEFAULT 0, seuil INT DEFAULT 20,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      UNIQUE(sku, entrepot)
    )`;

    // ── MOUVEMENTS DE STOCK ───────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS mouvements_stock (
      id BIGINT PRIMARY KEY,
      date_mvt TEXT, type TEXT, motif TEXT, sku TEXT, produit TEXT, qte INT,
      entrepot TEXT, user_nom TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── FOURNISSEURS & ACHATS ─────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS fournisseurs (
      id BIGINT PRIMARY KEY,
      nom TEXT NOT NULL, contact TEXT, tel TEXT, email TEXT, adresse TEXT, paiement TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS commandes_fournisseur (
      id BIGINT PRIMARY KEY,
      fournisseur TEXT, date_cmd TEXT, produits TEXT, montant INT,
      statut TEXT DEFAULT 'Brouillon', entrepot TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS demandes_achat (
      id BIGINT PRIMARY KEY,
      produit TEXT, qte INT, motif TEXT, demandeur TEXT, etape TEXT DEFAULT 'Demande',
      date_demande TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS inventaires (
      id BIGINT PRIMARY KEY,
      entrepot TEXT, type TEXT, date_inv TEXT, statut TEXT DEFAULT 'Planifie', ecarts INT
    )`;

    // ── DEVIS & FACTURES — multi-lignes (plusieurs produits par document) ───
    await sql`CREATE TABLE IF NOT EXISTS devis (
      id TEXT PRIMARY KEY,
      client TEXT, date_devis TEXT, statut TEXT DEFAULT 'Envoye', validite TEXT,
      lignes JSONB DEFAULT '[]', reservation_faite BOOLEAN DEFAULT false,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS factures (
      id TEXT PRIMARY KEY,
      client TEXT, date_fact TEXT, statut TEXT DEFAULT 'Impayee', mode_paiement TEXT,
      lignes JSONB DEFAULT '[]', sortie_appliquee BOOLEAN DEFAULT false, devis_origine TEXT,
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── DEPENSES ──────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS depenses (
      id BIGINT PRIMARY KEY,
      libelle TEXT NOT NULL, categorie TEXT, montant INT DEFAULT 0, date_dep TEXT,
      paye_par TEXT, justificatif TEXT, statut TEXT DEFAULT 'En attente',
      last_modified_by TEXT, last_modified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT PRIMARY KEY,
      icon TEXT, texte TEXT, cible TEXT, lu BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    // ── RH SIMPLIFIE ──────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS rh_presence (
      id SERIAL PRIMARY KEY,
      nom TEXT, date_p TEXT, arrivee TEXT, depart TEXT, statut TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS rh_conges (
      id BIGINT PRIMARY KEY,
      nom TEXT, debut TEXT, fin TEXT, motif TEXT, statut TEXT DEFAULT 'En attente'
    )`;

    // ── DOCUMENTS ─────────────────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      nom TEXT, categorie TEXT, taille TEXT, date_doc TEXT, par_qui TEXT
    )`;

    // ── Seed ONLY the super admin account if table is empty (idempotent) ──
    const existingUsers = await sql`SELECT COUNT(*) as count FROM users`;
    let seeded = false;

    if (parseInt(existingUsers[0].count) === 0) {
      seeded = true;
      await sql`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville)
                 VALUES ('Yvan Leunkeu Djine','yvan@acquadue.ne','Admin@2026','superadmin','Direction','YL','av-red','Niamey')
                 ON CONFLICT (email) DO NOTHING`;
    }

    return res.status(200).json({ success: true, seeded: seeded, message: 'Base de donnees initialisee avec succes (toutes les tables creees)' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
