// /api/init-db.js
// One-time setup: creates ALL tables and seeds ONLY the super admin account.
// Idempotent — safe to call multiple times (CREATE TABLE IF NOT EXISTS).
//
// SELF-HEALING SCHEMA: rather than hand-maintaining a long list of
// "ALTER TABLE ... ADD COLUMN" statements (which is exactly how the previous
// version of this file silently drifted out of sync and caused 500 errors
// like "column asg does not exist" or "column desc_produit does not exist"),
// this version derives the FULL expected column list for every table from a
// single source of truth (COLUMN_TYPES below) and programmatically issues an
// ALTER TABLE ADD COLUMN IF NOT EXISTS for every one of them, every time this
// endpoint is called. This guarantees the live table always has at least the
// columns the app code expects, regardless of which older version originally
// created it.

const { getSql } = require('../lib/db');

// Single source of truth: table -> { column: postgresType }
// Keep this in sync with /api/data.js's COLUMNS whitelist (same column names).
const COLUMN_TYPES = {
  clients: {
    id: 'BIGINT', nom: 'TEXT', type: "TEXT DEFAULT 'B2C'", ville: 'TEXT', zone: 'TEXT',
    tel: 'TEXT', email: 'TEXT', societe: 'TEXT', source: 'TEXT', statut: "TEXT DEFAULT 'Prospect froid'",
    produit: 'TEXT', asg: 'TEXT', notes: 'TEXT', date_creation: 'TEXT', locked: 'BOOLEAN DEFAULT false',
    historique: "JSONB DEFAULT '[]'", last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  pipeline: {
    id: 'BIGINT', nom: 'TEXT', type: "TEXT DEFAULT 'B2C'", val: 'INT DEFAULT 0',
    etape: "TEXT DEFAULT 'Nouveau prospect'", asg: 'TEXT', ville: 'TEXT', tel: 'TEXT', date_estimee: 'TEXT',
    locked: 'BOOLEAN DEFAULT false', sku: 'TEXT', qte: 'INT DEFAULT 1', entrepot: 'TEXT',
    reservation_faite: 'BOOLEAN DEFAULT false', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  tasks: {
    id: 'BIGINT', titre: 'TEXT', asg: 'TEXT', dept: 'TEXT', pri: "TEXT DEFAULT 'Moyenne'",
    statut: "TEXT DEFAULT 'A faire'", date_limite: 'TEXT', desc_tache: 'TEXT', locked: 'BOOLEAN DEFAULT false',
    last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  comm_perf: {
    id: 'BIGINT', nom: 'TEXT', ville: 'TEXT', zone: 'TEXT', obj: 'INT DEFAULT 0', ventes: 'INT DEFAULT 0',
    nb: 'INT DEFAULT 0', tx: 'NUMERIC DEFAULT 5', date_enregistrement: 'TEXT',
    historique_modifs: "JSONB DEFAULT '[]'", created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  campagnes: {
    id: 'BIGINT', nom: 'TEXT', canal: 'TEXT', budget: 'INT DEFAULT 0', statut: "TEXT DEFAULT 'Active'",
    leads: 'INT DEFAULT 0', cout_lead: 'INT DEFAULT 0', debut: 'TEXT', fin: 'TEXT', resp: 'TEXT',
    locked: 'BOOLEAN DEFAULT false', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  publications: {
    id: 'BIGINT', titre: 'TEXT', plat: 'TEXT', fmt: 'TEXT', date_pub: 'TEXT',
    statut: "TEXT DEFAULT 'Brouillon'", workflow: "TEXT DEFAULT 'Redacteur'", redacteur: 'TEXT',
    locked: 'BOOLEAN DEFAULT false', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  produits: {
    sku: 'TEXT', nom: 'TEXT', categorie: 'TEXT', marque: "TEXT DEFAULT 'Lorenzetti'", desc_produit: 'TEXT',
    prix_achat: 'INT DEFAULT 0', prix_vente: 'INT DEFAULT 0', prix_revendeur: 'INT DEFAULT 0',
    tva: 'INT DEFAULT 19', poids: 'TEXT', dimensions: 'TEXT', codebarre: 'TEXT',
    remise_seuil: 'INT DEFAULT 0', remise_pct: 'NUMERIC DEFAULT 0',
    // Donnees utilisees uniquement par le Calculateur ROI (Pipeline/Rapports).
    // Toutes optionnelles : si non renseignees, le calcul ignore simplement
    // le cout de recharge et utilise prix_vente comme cout d'installation.
    roi_installation: 'NUMERIC', roi_volume_bougie_l: 'NUMERIC', roi_cout_bougie: 'NUMERIC', roi_frequence_bougie_mois: 'NUMERIC',
    last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  entrepots: {
    id: 'BIGINT', nom: 'TEXT', type: 'TEXT', ville: 'TEXT', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  stock: {
    id: 'SERIAL', sku: 'TEXT', entrepot: 'TEXT', qte: 'INT DEFAULT 0', reserve: 'INT DEFAULT 0',
    seuil: 'INT DEFAULT 20', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP'
  },
  mouvements_stock: {
    id: 'BIGINT', date_mvt: 'TEXT', type: 'TEXT', motif: 'TEXT', sku: 'TEXT', produit: 'TEXT',
    qte: 'INT', entrepot: 'TEXT', user_nom: 'TEXT', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  fournisseurs: {
    id: 'BIGINT', nom: 'TEXT', contact: 'TEXT', tel: 'TEXT', email: 'TEXT', adresse: 'TEXT',
    paiement: 'TEXT', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  commandes_fournisseur: {
    id: 'BIGINT', fournisseur: 'TEXT', date_cmd: 'TEXT', produits: 'TEXT', montant: 'INT',
    statut: "TEXT DEFAULT 'Brouillon'", entrepot: 'TEXT', lignes: "JSONB DEFAULT '[]'",
    stock_receptionne: 'BOOLEAN DEFAULT false', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  demandes_achat: {
    id: 'BIGINT', produit: 'TEXT', qte: 'INT', motif: 'TEXT', demandeur: 'TEXT',
    etape: "TEXT DEFAULT 'Demande'", date_demande: 'TEXT', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  inventaires: {
    id: 'BIGINT', entrepot: 'TEXT', type: 'TEXT', date_inv: 'TEXT', statut: "TEXT DEFAULT 'Planifie'", ecarts: 'INT'
  },
  devis: {
    id: 'TEXT', client: 'TEXT', date_devis: 'TEXT', statut: "TEXT DEFAULT 'Envoye'", validite: 'TEXT',
    lignes: "JSONB DEFAULT '[]'", reservation_faite: 'BOOLEAN DEFAULT false',
    last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  factures: {
    id: 'TEXT', client: 'TEXT', date_fact: 'TEXT', statut: "TEXT DEFAULT 'Impayee'", mode_paiement: 'TEXT',
    lignes: "JSONB DEFAULT '[]'", sortie_appliquee: 'BOOLEAN DEFAULT false', devis_origine: 'TEXT',
    date_renouvellement: 'TEXT',
    last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  depenses: {
    id: 'BIGINT', libelle: 'TEXT', categorie: 'TEXT', montant: 'INT DEFAULT 0', date_dep: 'TEXT',
    paye_par: 'TEXT', justificatif: 'TEXT', statut: "TEXT DEFAULT 'En attente'",
    last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  notifications: {
    id: 'BIGINT', icon: 'TEXT', texte: 'TEXT', cible: 'TEXT', lu: 'BOOLEAN DEFAULT false',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  rh_presence: {
    id: 'SERIAL', nom: 'TEXT', date_p: 'TEXT', arrivee: 'TEXT', depart: 'TEXT', statut: 'TEXT'
  },
  rh_conges: {
    id: 'BIGINT', nom: 'TEXT', debut: 'TEXT', fin: 'TEXT', motif: 'TEXT', statut: "TEXT DEFAULT 'En attente'"
  },
  documents: {
    id: 'BIGINT', nom: 'TEXT', categorie: 'TEXT', taille: 'TEXT', date_doc: 'TEXT', par_qui: 'TEXT',
    data: 'TEXT', mime_type: 'TEXT'
  },
  users: {
    id: 'SERIAL', nom: 'TEXT NOT NULL', email: 'TEXT UNIQUE NOT NULL', pass: 'TEXT NOT NULL',
    role: "TEXT NOT NULL DEFAULT 'collaborateur'", departement: "TEXT NOT NULL DEFAULT 'Commercial'",
    ini: 'TEXT', col: "TEXT DEFAULT 'av-blue'", actif: 'BOOLEAN DEFAULT true', ville: "TEXT DEFAULT 'Niamey'",
    tentatives: 'INT DEFAULT 0', verrouille: 'BOOLEAN DEFAULT false', doit_changer_pass: 'BOOLEAN DEFAULT false',
    dernier_login: 'TIMESTAMP', reset_code: 'TEXT', reset_code_expires: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  // Persists the "Permissions sensibles" matrix (Centre de Controle) so that
  // toggles made by the Super Admin survive a refresh/redeploy instead of
  // always resetting to the hardcoded defaults baked into index.html.
  sensitive_perms: {
    role: 'TEXT', voir_stock: 'BOOLEAN DEFAULT true', modifier_stock: 'BOOLEAN DEFAULT false',
    supprimer_mouvement: 'BOOLEAN DEFAULT false', modifier_prix_achat: 'BOOLEAN DEFAULT false',
    modifier_cout_fournisseur: 'BOOLEAN DEFAULT false',
    fournisseurs_approvisionnement: 'BOOLEAN DEFAULT true', logistique_stock: 'BOOLEAN DEFAULT true',
    modifier_client: 'BOOLEAN DEFAULT true', modifier_prospect: 'BOOLEAN DEFAULT true'
  },
  // Reference prices for competing bottled-water formats, used both by the
  // static comparison table in Rapports and by the interactive ROI
  // calculator (Pipeline). Editable by the Super Admin instead of being
  // hardcoded, since these prices drift over time.
  roi_concurrents: {
    id: 'BIGINT', format: 'TEXT', volume_litres: 'NUMERIC', prix: 'NUMERIC', created_at: 'TIMESTAMP DEFAULT NOW()'
  },
  // Packs promotionnels (combinaisons de produits a prix fixe), geres par le
  // Super Admin depuis le module Promotions, et selectionnables manuellement
  // par n'importe qui dans le Devis Builder / Facture Builder. `lignes` est
  // la composition du pack: [{sku, qte}, ...] (sans prix — le prix unitaire
  // normal du produit au moment de l'application sert a calculer la remise).
  promo_packs: {
    id: 'BIGINT', nom: 'TEXT', lignes: "JSONB DEFAULT '[]'", prix_pack: 'NUMERIC DEFAULT 0',
    actif: 'BOOLEAN DEFAULT true', last_modified_by: 'TEXT', last_modified_at: 'TIMESTAMP',
    created_at: 'TIMESTAMP DEFAULT NOW()'
  },
};

// Primary key column per table (used only for initial CREATE TABLE; ALTER never touches these)
const PRIMARY_KEYS = {
  clients: 'id', pipeline: 'id', tasks: 'id', comm_perf: 'id', campagnes: 'id', publications: 'id',
  produits: 'sku', entrepots: 'id', stock: 'id', mouvements_stock: 'id', fournisseurs: 'id',
  commandes_fournisseur: 'id', demandes_achat: 'id', inventaires: 'id', devis: 'id', factures: 'id',
  depenses: 'id', notifications: 'id', rh_presence: 'id', rh_conges: 'id', documents: 'id', users: 'id',
  sensitive_perms: 'role', roi_concurrents: 'id', promo_packs: 'id'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const sql = getSql();
    const healed = [];

    // ── Step 1: CREATE TABLE IF NOT EXISTS for every table, with its primary key ──
    for (const table of Object.keys(COLUMN_TYPES)) {
      const cols = COLUMN_TYPES[table];
      const pk = PRIMARY_KEYS[table];
      const colDefs = Object.keys(cols).map(function(c) {
        const isPk = c === pk;
        const typeDecl = cols[c];
        return c + ' ' + typeDecl + (isPk ? ' PRIMARY KEY' : '');
      }).join(', ');
      const createSql = 'CREATE TABLE IF NOT EXISTS ' + table + ' (' + colDefs + ')';
      await sql.query(createSql);
    }

    // sessions table (special: foreign key to users, not derived from COLUMN_TYPES)
    await sql`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW(),
      user_agent TEXT
    )`;

    // audit_log table (special: no fixed primary key column from COLUMN_TYPES)
    await sql`CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      user_nom TEXT, dept TEXT, action TEXT, detail TEXT, color TEXT, ini TEXT, col TEXT, ip TEXT
    )`;

    // ── Step 2: SELF-HEAL — for every table that may already have existed under
    // an older schema, add any column from COLUMN_TYPES that isn't there yet.
    // This is what prevents "column X does not exist" 500 errors forever. ──
    for (const table of Object.keys(COLUMN_TYPES)) {
      const cols = COLUMN_TYPES[table];
      for (const colName of Object.keys(cols)) {
        const typeDecl = cols[colName];
        // Strip "NOT NULL"/"UNIQUE" from ALTER (can't safely add NOT NULL to an
        // existing populated table without a default); keep DEFAULT clauses.
        const safeType = typeDecl.replace(/NOT NULL/gi, '').replace(/UNIQUE/gi, '').trim();
        try {
          await sql.query('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + colName + ' ' + safeType);
        } catch (e) {
          healed.push(table + '.' + colName + ' -> ' + e.message);
        }
      }
    }

    // ── Step 2.5: SELF-HEAL COLUMN TYPE — tables created by a much older
    // version of this file may have their id column typed as a plain INT
    // (max ~2.1 billion), but the app generates ids with Date.now() (13-digit
    // numbers like 1782159708899), which overflows INT and causes
    // 'value "..." is out of range for type integer' 500 errors on every
    // insert. Detect and widen these columns to BIGINT automatically. ──
    for (const table of Object.keys(PRIMARY_KEYS)) {
      const pk = PRIMARY_KEYS[table];
      const declaredType = (COLUMN_TYPES[table][pk] || '').toUpperCase();
      if (declaredType.indexOf('BIGINT') === 0) {
        try {
          const colInfo = await sql.query(
            "SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
            [table, pk]
          );
          if (colInfo.length > 0 && colInfo[0].data_type === 'integer') {
            await sql.query('ALTER TABLE ' + table + ' ALTER COLUMN ' + pk + ' TYPE BIGINT');
            healed.push(table + '.' + pk + ': widened INT -> BIGINT (fixes Date.now() id overflow)');
          }
        } catch (e) {
          healed.push(table + '.' + pk + '_type -> ' + e.message);
        }
      }
    }

    // ── Step 3: SELF-HEAL PRIMARY KEY — tables created by a much older version
    // of this file may be missing a real PRIMARY KEY constraint on their id
    // column. Without it, /api/data's "INSERT ... ON CONFLICT (id)" fails with
    // Postgres error 42P10 ("no unique or exclusion constraint matching ON
    // CONFLICT"), which surfaces to the browser as a generic 500 error on
    // every create action (fournisseurs, factures, etc.). Detect and add the
    // missing constraint automatically. ──
    for (const table of Object.keys(PRIMARY_KEYS)) {
      const pk = PRIMARY_KEYS[table];
      try {
        const hasPk = await sql.query(
          "SELECT 1 FROM information_schema.table_constraints tc " +
          "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name " +
          "WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = $2",
          [table, pk]
        );
        if (!hasPk || hasPk.length === 0) {
          // If the id column was just added via ADD COLUMN IF NOT EXISTS
          // (e.g. a table like comm_perf that never had one before), every
          // existing row has id = NULL. A PRIMARY KEY constraint rejects
          // NULLs outright, so backfill each NULL id with a unique value
          // BEFORE adding the constraint, or the ALTER TABLE below silently
          // fails and the table is left without a working primary key —
          // which then makes every insert/update on that table fail.
          await sql.query(
            'UPDATE ' + table + ' SET ' + pk + ' = (extract(epoch from clock_timestamp()) * 1000000 + (random()*1000)::int)::bigint ' +
            'WHERE ' + pk + ' IS NULL'
          );
          // De-duplicate existing rows on this column next (keep the most recent),
          // otherwise adding a PK/UNIQUE constraint would fail on duplicate values.
          await sql.query(
            'DELETE FROM ' + table + ' a USING ' + table + ' b ' +
            'WHERE a.' + pk + ' = b.' + pk + ' AND a.ctid < b.ctid'
          );
          await sql.query('ALTER TABLE ' + table + ' ALTER COLUMN ' + pk + ' SET NOT NULL');
          await sql.query('ALTER TABLE ' + table + ' ADD CONSTRAINT ' + table + '_' + pk + '_pkey PRIMARY KEY (' + pk + ')');
          healed.push(table + ': added missing PRIMARY KEY on ' + pk + ' (backfilled any NULL ids first)');
        }
      } catch (e) {
        healed.push(table + '.PRIMARY_KEY -> ' + e.message);
      }
    }

    // ── Seed ONLY the super admin account if table is empty (idempotent) ──
    const existingUsers = await sql`SELECT COUNT(*) as count FROM users`;
    let seeded = false;

    if (parseInt(existingUsers[0].count) === 0) {
      seeded = true;
      await sql`INSERT INTO users (nom,email,pass,role,departement,ini,col,ville)
                 VALUES ('Yvan Leunkeu Djine','yvan@acquadue.ne','Admin@2026','superadmin','Direction','YL','av-red','Niamey')
                 ON CONFLICT (email) DO NOTHING`;
    }

    // ── Seed default sensitive permissions per role if the table is empty ──
    // These mirror exactly the values that were previously hardcoded in
    // index.html, so migrating to this persisted table changes nothing for
    // existing users until the Super Admin explicitly toggles something in
    // Centre de Controle -> Permissions sensibles. The two new permissions
    // (fournisseurs_approvisionnement, logistique_stock) default to true for
    // every role to preserve today's behaviour (those areas are currently
    // open to everyone) — the Super Admin can restrict them from the UI.
    const existingPerms = await sql`SELECT COUNT(*) as count FROM sensitive_perms`;
    if (parseInt(existingPerms[0].count) === 0) {
      const defaultPerms = {
        collaborateur: { voir_stock:true,  modifier_stock:false, supprimer_mouvement:false, modifier_prix_achat:false, modifier_cout_fournisseur:false, fournisseurs_approvisionnement:true, logistique_stock:true, modifier_client:true, modifier_prospect:true },
        responsable:   { voir_stock:true,  modifier_stock:false, supprimer_mouvement:false, modifier_prix_achat:false, modifier_cout_fournisseur:false, fournisseurs_approvisionnement:true, logistique_stock:true, modifier_client:true, modifier_prospect:true },
        // modifier_stock is now false for admin: only the Super Admin may
        // add/modify Produits & Stocks, per explicit request.
        admin:         { voir_stock:true,  modifier_stock:false, supprimer_mouvement:false, modifier_prix_achat:true,  modifier_cout_fournisseur:true,  fournisseurs_approvisionnement:true, logistique_stock:true, modifier_client:true, modifier_prospect:true },
        superadmin:    { voir_stock:true,  modifier_stock:true,  supprimer_mouvement:true,  modifier_prix_achat:true,  modifier_cout_fournisseur:true,  fournisseurs_approvisionnement:true, logistique_stock:true, modifier_client:true, modifier_prospect:true },
      };
      for (const role of Object.keys(defaultPerms)) {
        const p = defaultPerms[role];
        await sql`INSERT INTO sensitive_perms
                   (role, voir_stock, modifier_stock, supprimer_mouvement, modifier_prix_achat, modifier_cout_fournisseur, fournisseurs_approvisionnement, logistique_stock, modifier_client, modifier_prospect)
                   VALUES (${role}, ${p.voir_stock}, ${p.modifier_stock}, ${p.supprimer_mouvement}, ${p.modifier_prix_achat}, ${p.modifier_cout_fournisseur}, ${p.fournisseurs_approvisionnement}, ${p.logistique_stock}, ${p.modifier_client}, ${p.modifier_prospect})
                   ON CONFLICT (role) DO NOTHING`;
      }
    }

    // ── Seed default competitor bottled-water prices if the table is empty ──
    // Mirrors the values that were previously hardcoded directly in the
    // Rapports page. Ranges like "1.000-1.400 FCFA" became a single
    // representative price, since the ROI calculator needs a real number to
    // compute with. The Super Admin can edit these at any time.
    const existingRoi = await sql`SELECT COUNT(*) as count FROM roi_concurrents`;
    if (parseInt(existingRoi[0].count) === 0) {
      const defaultRoi = [
        { format: 'Pack 0,35L x12', volume_litres: 4.2, prix: 1200 },
        { format: 'Pack 1L x12', volume_litres: 12, prix: 1800 },
        { format: 'Pack 1,5L x6', volume_litres: 9, prix: 1500 },
        { format: 'Bonbonne 19L', volume_litres: 19, prix: 2000 },
      ];
      for (let i = 0; i < defaultRoi.length; i++) {
        const r = defaultRoi[i];
        await sql`INSERT INTO roi_concurrents (id, format, volume_litres, prix)
                   VALUES (${Date.now() + i}, ${r.format}, ${r.volume_litres}, ${r.prix})`;
      }
    }

    return res.status(200).json({
      success: true,
      seeded: seeded,
      tables_checked: Object.keys(COLUMN_TYPES).length,
      healing_issues: healed,
      message: 'Base de donnees initialisee et reparee avec succes (schema complet verifie pour chaque table)'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
