// /api/data.js
// Generic CRUD endpoint for all business entities (clients, pipeline, tasks,
// comm_perf, campagnes, publications, produits, entrepots, stock,
// mouvements_stock, fournisseurs, commandes_fournisseur, demandes_achat,
// inventaires, devis, factures, depenses, notifications, rh_presence,
// rh_conges, documents).
//
// GET    /api/data?entity=clients              -> list all rows
// POST   /api/data   { entity, row }            -> insert one row
// PUT    /api/data   { entity, id, patch }      -> update one row by id (or sku for produits, composite for stock)
// DELETE /api/data   { entity, id }             -> delete one row by id

const { getSql } = require('../lib/db');

// Maps entity name -> { table, idColumn, columns (camelCase -> snake_case) }
const ENTITY_MAP = {
  clients:        { table: 'clients', idCol: 'id' },
  pipeline:       { table: 'pipeline', idCol: 'id' },
  tasks:          { table: 'tasks', idCol: 'id' },
  comm_perf:      { table: 'comm_perf', idCol: 'id' },
  campagnes:      { table: 'campagnes', idCol: 'id' },
  publications:   { table: 'publications', idCol: 'id' },
  produits:       { table: 'produits', idCol: 'sku' },
  entrepots:      { table: 'entrepots', idCol: 'id' },
  stock:          { table: 'stock', idCol: 'id' },
  mouvements_stock:{ table: 'mouvements_stock', idCol: 'id' },
  fournisseurs:   { table: 'fournisseurs', idCol: 'id' },
  commandes_fournisseur: { table: 'commandes_fournisseur', idCol: 'id' },
  demandes_achat: { table: 'demandes_achat', idCol: 'id' },
  inventaires:    { table: 'inventaires', idCol: 'id' },
  devis:          { table: 'devis', idCol: 'id' },
  factures:       { table: 'factures', idCol: 'id' },
  depenses:       { table: 'depenses', idCol: 'id' },
  notifications:  { table: 'notifications', idCol: 'id' },
  rh_presence:    { table: 'rh_presence', idCol: 'id' },
  rh_conges:      { table: 'rh_conges', idCol: 'id' },
  documents:      { table: 'documents', idCol: 'id' },
};

// Whitelist of valid column names per table, to safely build dynamic INSERT/UPDATE
// without risking SQL injection through arbitrary keys.
const COLUMNS = {
  clients: ['id','nom','type','ville','zone','tel','email','societe','source','statut','produit','asg','date_creation','locked','historique','last_modified_by','last_modified_at'],
  pipeline: ['id','nom','type','val','etape','asg','ville','date_estimee','locked','sku','qte','entrepot','reservation_faite','last_modified_by','last_modified_at'],
  tasks: ['id','titre','asg','dept','pri','statut','date_limite','locked','last_modified_by','last_modified_at'],
  comm_perf: ['id','nom','ville','zone','obj','ventes','nb','tx','date_enregistrement','historique_modifs'],
  campagnes: ['id','nom','canal','budget','statut','leads','cout_lead','debut','fin','resp','locked','last_modified_by','last_modified_at'],
  publications: ['id','titre','plat','fmt','date_pub','statut','workflow','redacteur','locked','last_modified_by','last_modified_at'],
  produits: ['sku','nom','categorie','marque','desc_produit','prix_achat','prix_vente','prix_revendeur','tva','poids','dimensions','codebarre','last_modified_by','last_modified_at'],
  entrepots: ['id','nom','type','ville'],
  stock: ['id','sku','entrepot','qte','reserve','seuil','last_modified_by','last_modified_at'],
  mouvements_stock: ['id','date_mvt','type','motif','sku','produit','qte','entrepot','user_nom'],
  fournisseurs: ['id','nom','contact','tel','email','adresse','paiement'],
  commandes_fournisseur: ['id','fournisseur','date_cmd','produits','montant','statut','entrepot','lignes','stock_receptionne','last_modified_by','last_modified_at'],
  demandes_achat: ['id','produit','qte','motif','demandeur','etape','date_demande'],
  inventaires: ['id','entrepot','type','date_inv','statut','ecarts'],
  devis: ['id','client','date_devis','statut','validite','lignes','reservation_faite','last_modified_by','last_modified_at'],
  factures: ['id','client','date_fact','statut','mode_paiement','lignes','sortie_appliquee','devis_origine','last_modified_by','last_modified_at'],
  depenses: ['id','libelle','categorie','montant','date_dep','paye_par','justificatif','statut','last_modified_by','last_modified_at'],
  notifications: ['id','icon','texte','cible','lu'],
  rh_presence: ['id','nom','date_p','arrivee','depart','statut'],
  rh_conges: ['id','nom','debut','fin','motif','statut'],
  documents: ['id','nom','categorie','taille','date_doc','par_qui'],
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getSql();
    const entityKey = req.method === 'GET' ? req.query.entity : (req.body || {}).entity;
    const meta = ENTITY_MAP[entityKey];
    if (!meta) return res.status(400).json({ error: 'Entite inconnue: ' + entityKey });

    const allowedCols = COLUMNS[entityKey];

    if (req.method === 'GET') {
      const rows = await sql.query('SELECT * FROM ' + meta.table + ' ORDER BY ' + meta.idCol + ' ASC');
      return res.status(200).json({ rows: rows });
    }

    if (req.method === 'POST') {
      const row = req.body.row || {};
      const cols = Object.keys(row).filter(function(k){ return allowedCols.indexOf(k) >= 0; });
      if (cols.length === 0) return res.status(400).json({ error: 'Aucune colonne valide fournie' });

      const placeholders = cols.map(function(_, i){ return '$' + (i+1); }).join(',');
      const values = cols.map(function(c){
        const v = row[c];
        return (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
      });
      const queryWithConflict = 'INSERT INTO ' + meta.table + ' (' + cols.join(',') + ') VALUES (' + placeholders + ') ' +
                    'ON CONFLICT (' + meta.idCol + ') DO NOTHING RETURNING *';
      let result;
      try {
        result = await sql.query(queryWithConflict, values);
      } catch (conflictErr) {
        // Postgres 42P10: no unique/exclusion constraint matching ON CONFLICT.
        // This happens on tables created by an older schema version that never
        // got a PRIMARY KEY (normally self-healed by /api/init-db, but fall
        // back gracefully here too instead of surfacing a raw 500).
        if (conflictErr.code === '42P10' || /no unique or exclusion constraint/i.test(conflictErr.message)) {
          const queryNoConflict = 'INSERT INTO ' + meta.table + ' (' + cols.join(',') + ') VALUES (' + placeholders + ') RETURNING *';
          result = await sql.query(queryNoConflict, values);
        } else {
          throw conflictErr;
        }
      }
      return res.status(201).json({ success: true, row: result[0] || row });
    }

    if (req.method === 'PUT') {
      const id = req.body.id;
      const patch = req.body.patch || {};
      if (id === undefined || id === null) return res.status(400).json({ error: 'id manquant' });

      const cols = Object.keys(patch).filter(function(k){ return allowedCols.indexOf(k) >= 0; });
      if (cols.length === 0) return res.status(400).json({ error: 'Aucune colonne valide a mettre a jour' });

      const setClause = cols.map(function(c, i){ return c + ' = $' + (i+1); }).join(', ');
      const values = cols.map(function(c){
        const v = patch[c];
        return (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
      });
      values.push(id);
      const query = 'UPDATE ' + meta.table + ' SET ' + setClause + ' WHERE ' + meta.idCol + ' = $' + (values.length) + ' RETURNING *';
      const result = await sql.query(query, values);
      if (result.length === 0) return res.status(404).json({ error: 'Enregistrement introuvable' });
      return res.status(200).json({ success: true, row: result[0] });
    }

    if (req.method === 'DELETE') {
      const id = req.body.id;
      if (id === undefined || id === null) return res.status(400).json({ error: 'id manquant' });
      await sql.query('DELETE FROM ' + meta.table + ' WHERE ' + meta.idCol + ' = $1', [id]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
