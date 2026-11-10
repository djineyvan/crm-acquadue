// /lib/meta.js
// Connexion Meta (Facebook / Instagram "Lead Ads") -> CRM.
// (Ce fichier est dans lib/, il ne compte PAS dans la limite de 12 fonctions
// serverless du plan Vercel Hobby. Il est appele depuis api/version.js.)
//
// Fonctionnement :
//   1. Meta appelle  GET  /api/version?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//      une seule fois, quand on enregistre le webhook : on repond avec le "challenge".
//   2. A chaque nouveau formulaire rempli, Meta appelle  POST /api/version  avec un
//      message SIGNE (en-tete X-Hub-Signature-256). On verifie la signature avec la
//      "cle secrete de l'application" : tout message non signe ou falsifie est refuse.
//   3. Le message ne contient que l'identifiant du lead : on va chercher les reponses
//      du formulaire via l'API Graph, puis on cree le prospect (Clients + Pipeline),
//      on notifie le commercial, et on garde une trace dans la table meta_leads
//      (anti-doublon : Meta renvoie parfois plusieurs fois le meme message).
//   4. GET /api/version?meta=status  (Admin / Super Admin) : etat de la connexion.
//      POST /api/version?meta=retry (Super Admin) : retente les leads en erreur.
//
// Variables d'environnement (a mettre UNIQUEMENT dans Vercel, jamais dans le code) :
//   META_VERIFY_TOKEN       mot choisi par vous, utilise pour la verification du webhook
//   META_APP_SECRET         "Cle secrete de l'application" (Meta for Developers)
//   META_PAGE_ACCESS_TOKEN  jeton d'acces de la Page Facebook (longue duree)
//   META_GRAPH_VERSION      (optionnel) ex. v25.0
//   META_LEAD_ASSIGNEE      (optionnel) nom exact du commercial qui recoit les leads
//   META_DEFAULT_CITY       (optionnel) ville par defaut si le formulaire n'en a pas (Niamey)

const crypto = require('crypto');
const { getSql } = require('./db');
const { requireAuth } = require('./auth');

const DEFAULT_GRAPH_VERSION = 'v25.0';
const SOURCE_LABEL = 'Meta Ads';
const FETCH_TIMEOUT_MS = 7000;

// ── Utilitaires ──────────────────────────────────────────────────────────────
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !Buffer.isBuffer(rawBody)) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, m[1].toLowerCase());
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    // Le corps a deja ete transforme : la signature ne peut plus etre verifiee.
    return null;
  }
  if (typeof req.on !== 'function') return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw new Error('corps_trop_gros');
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

function cfg() {
  return {
    verifyToken: process.env.META_VERIFY_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
    pageToken: process.env.META_PAGE_ACCESS_TOKEN || '',
    version: process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    assignee: process.env.META_LEAD_ASSIGNEE || '',
    city: process.env.META_DEFAULT_CITY || 'Niamey'
  };
}

let tableReady = false;
async function ensureTable(sql) {
  if (tableReady) return;
  await sql`CREATE TABLE IF NOT EXISTS meta_leads (
    leadgen_id TEXT PRIMARY KEY,
    page_id TEXT, form_id TEXT, ad_id TEXT,
    status TEXT NOT NULL DEFAULT 'en_cours',
    attempts INT NOT NULL DEFAULT 0,
    error TEXT,
    client_id BIGINT,
    nom TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`;
  tableReady = true;
}

// ── Lecture d'un lead via l'API Graph ────────────────────────────────────────
async function graphGet(path, params, c) {
  const url = new URL('https://graph.facebook.com/' + c.version + '/' + path);
  Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
  url.searchParams.set('access_token', c.pageToken);
  if (c.appSecret) {
    url.searchParams.set('appsecret_proof',
      crypto.createHmac('sha256', c.appSecret).update(c.pageToken).digest('hex'));
  }
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), { signal: ctl.signal });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok || j.error) {
      const msg = (j.error && (j.error.message || j.error.type)) || ('HTTP ' + r.status);
      const err = new Error('graph: ' + msg);
      err.code = j.error && j.error.code;
      throw err;
    }
    return j;
  } finally { clearTimeout(timer); }
}

// ── Transformation des reponses du formulaire ────────────────────────────────
function cleanPhone(v) {
  let s = String(v || '').replace(/^p:/i, '').trim();
  const plus = s.charAt(0) === '+';
  s = s.replace(/[^0-9]/g, '');
  return s ? (plus ? '+' + s : s) : '';
}
function phoneKey(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}
function prettyLabel(name) {
  const s = String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Champ';
}

function parseLead(lead) {
  const out = { nom: '', tel: '', email: '', ville: '', societe: '', autres: [] };
  let first = '', last = '';
  (lead.field_data || []).forEach(function (f) {
    const key = String(f.name || '').toLowerCase();
    const val = (Array.isArray(f.values) ? f.values.join(', ') : String(f.values || '')).trim();
    if (!val) return;
    if (key === 'full_name' || key === 'nom_complet' || key === 'nom') out.nom = val;
    else if (key === 'first_name' || key === 'prenom') first = val;
    else if (key === 'last_name') last = val;
    else if (key === 'phone_number' || key === 'phone' || key === 'telephone' || key === 'whatsapp_number') out.tel = cleanPhone(val);
    else if (key === 'email') out.email = val;
    else if (key === 'city' || key === 'ville') out.ville = val;
    else if (key === 'company_name' || key === 'societe') out.societe = val;
    else out.autres.push({ label: prettyLabel(f.name), value: val });
  });
  if (!out.nom) out.nom = (first + ' ' + last).trim();
  if (!out.nom) out.nom = 'Prospect Meta';
  return out;
}

function frDate(d) {
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

// ── Creation du prospect dans le CRM ─────────────────────────────────────────
async function pickAssignee(sql, c) {
  if (c.assignee) {
    const r = await sql`SELECT nom FROM users WHERE nom = ${c.assignee} AND actif = true LIMIT 1`;
    if (r.length) return r[0].nom;
  }
  const sa = await sql`SELECT nom FROM users WHERE role = 'superadmin' AND actif = true ORDER BY id ASC LIMIT 1`;
  return sa.length ? sa[0].nom : '';
}

async function insertWithFreshId(sql, base, build) {
  // Le CRM utilise Date.now() comme identifiant : on evite toute collision.
  for (let i = 0; i < 8; i++) {
    const id = base + i;
    const rows = await build(id);
    if (rows && rows.length) return id;
  }
  throw new Error('identifiant_indisponible');
}

async function createProspect(sql, rec, parsed, c) {
  const asg = await pickAssignee(sql, c);
  const key = phoneKey(parsed.tel);
  let dup = [];
  if (key) {
    dup = await sql`SELECT id, nom FROM clients WHERE regexp_replace(COALESCE(tel,''), '[^0-9]', '', 'g') LIKE ${'%' + key} LIMIT 1`;
  } else if (parsed.email) {
    dup = await sql`SELECT id, nom FROM clients WHERE lower(COALESCE(email,'')) = ${parsed.email.toLowerCase()} LIMIT 1`;
  }

  const notesLines = ['Lead recu via Meta (Facebook/Instagram) le ' + frDate(new Date()) + '.'];
  if (rec.ad_id) notesLines.push('Annonce (ID) : ' + rec.ad_id);
  if (rec.form_id) notesLines.push('Formulaire (ID) : ' + rec.form_id);
  parsed.autres.forEach(function (a) { notesLines.push(a.label + ' : ' + a.value); });
  const notes = notesLines.join('\n');

  const detail = parsed.nom + (parsed.tel ? ' - ' + parsed.tel : '');
  let clientId, doublon = false;

  if (dup.length) {
    // Deja dans le CRM : on n'ecrase rien, on ajoute une note a la fiche existante.
    doublon = true;
    clientId = dup[0].id;
    await sql`UPDATE clients SET notes = COALESCE(notes,'') || ${'\n\n[Nouveau formulaire Meta]\n' + notes}, last_modified_by = 'Meta Ads', last_modified_at = NOW() WHERE id = ${clientId}`;
  } else {
    const ville = parsed.ville || c.city;
    const type = parsed.societe ? 'B2B' : 'B2C';
    clientId = await insertWithFreshId(sql, Date.now(), function (id) {
      return sql`INSERT INTO clients (id, nom, type, ville, zone, tel, email, societe, source, statut, produit, asg, notes, date_creation, locked, historique, last_modified_by, last_modified_at)
                 VALUES (${id}, ${parsed.nom}, ${type}, ${ville}, ${ville}, ${parsed.tel}, ${parsed.email}, ${parsed.societe}, ${SOURCE_LABEL}, 'Nouveau prospect', '-', ${asg}, ${notes}, ${frDate(new Date())}, false, '[]', 'Meta Ads', NOW())
                 ON CONFLICT (id) DO NOTHING RETURNING id`;
    });
    await insertWithFreshId(sql, Date.now() + 100, function (id) {
      return sql`INSERT INTO pipeline (id, nom, type, val, etape, asg, ville, tel, date_estimee, locked, sku, qte, entrepot, reservation_faite, last_modified_by, last_modified_at)
                 VALUES (${id}, ${parsed.nom}, ${type}, 30000, 'Nouveau prospect', ${asg}, ${ville}, ${parsed.tel}, '—', false, '', 1, '', false, 'Meta Ads', NOW())
                 ON CONFLICT (id) DO NOTHING RETURNING id`;
    });
  }

  const texte = doublon
    ? '📣 Meta : ' + parsed.nom + ' a rempli un nouveau formulaire (contact deja dans le CRM)'
    : '📣 Nouveau lead Meta : ' + parsed.nom + (parsed.tel ? ' (' + parsed.tel + ')' : '') + ' - a rappeler rapidement';
  await insertWithFreshId(sql, Date.now() * 1 + 200, function (id) {
    return sql`INSERT INTO notifications (id, icon, texte, cible, lu) VALUES (${id}, '📣', ${texte}, ${asg || 'all'}, false)
               ON CONFLICT (id) DO NOTHING RETURNING id`;
  });
  await sql`INSERT INTO audit_log (user_nom, dept, action, detail, color, ini, col, ip)
            VALUES ('Meta Ads', 'Marketing', ${doublon ? 'Lead Meta (doublon)' : 'Lead Meta recu'}, ${detail}, 'dot-blue', 'M', 'av-blue', 'meta')`;
  return { clientId, doublon };
}

// ── Traitement d'un lead (idempotent) ────────────────────────────────────────
async function processLead(sql, rec, c) {
  await ensureTable(sql);
  await sql`INSERT INTO meta_leads (leadgen_id, page_id, form_id, ad_id, status, attempts)
            VALUES (${rec.leadgen_id}, ${rec.page_id || null}, ${rec.form_id || null}, ${rec.ad_id || null}, 'nouveau', 0)
            ON CONFLICT (leadgen_id) DO NOTHING`;
  // "Reservation" atomique : un seul traitement a la fois, jamais deux fois un lead reussi.
  const claimed = await sql`UPDATE meta_leads SET status = 'en_cours', attempts = attempts + 1, updated_at = NOW()
      WHERE leadgen_id = ${rec.leadgen_id}
        AND (status IN ('nouveau','erreur') OR (status = 'en_cours' AND updated_at < NOW() - INTERVAL '2 minutes'))
      RETURNING leadgen_id`;
  if (!claimed.length) return { skipped: true };
  try {
    if (!c.pageToken) throw new Error('META_PAGE_ACCESS_TOKEN manquant');
    const lead = await graphGet(String(rec.leadgen_id), {}, c);
    const parsed = parseLead(lead);
    if (!rec.ad_id && lead.ad_id) rec.ad_id = lead.ad_id;
    if (!rec.form_id && lead.form_id) rec.form_id = lead.form_id;
    const res = await createProspect(sql, rec, parsed, c);
    await sql`UPDATE meta_leads SET status = 'ok', error = NULL, client_id = ${res.clientId}, nom = ${parsed.nom}, ad_id = ${rec.ad_id || null}, form_id = ${rec.form_id || null}, updated_at = NOW() WHERE leadgen_id = ${rec.leadgen_id}`;
    return { ok: true, doublon: res.doublon };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 500);
    await sql`UPDATE meta_leads SET status = 'erreur', error = ${msg}, updated_at = NOW() WHERE leadgen_id = ${rec.leadgen_id}`;
    return { error: msg };
  }
}

function extractLeads(payload) {
  const list = [];
  if (!payload || typeof payload !== 'object') return list;
  (payload.entry || []).forEach(function (en) {
    (en.changes || []).forEach(function (ch) {
      if (ch && ch.field === 'leadgen' && ch.value && ch.value.leadgen_id) {
        list.push({
          leadgen_id: String(ch.value.leadgen_id),
          page_id: String(ch.value.page_id || en.id || ''),
          form_id: ch.value.form_id ? String(ch.value.form_id) : '',
          ad_id: ch.value.ad_id ? String(ch.value.ad_id) : ''
        });
      }
    });
  });
  return list;
}

// ── Point d'entree appele par api/version.js ─────────────────────────────────
function isMetaRequest(req) {
  const q = req.query || {};
  if (req.method === 'POST') return true;
  if (req.method === 'GET' && (q['hub.mode'] || q.meta)) return true;
  return false;
}

async function handle(req, res) {
  const c = cfg();
  const q = req.query || {};
  try {
    // 1) Verification du webhook par Meta
    if (req.method === 'GET' && q['hub.mode']) {
      if (q['hub.mode'] === 'subscribe' && c.verifyToken && safeEqual(q['hub.verify_token'], c.verifyToken)) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(String(q['hub.challenge'] || ''));
      }
      return res.status(403).json({ error: 'verification_refusee' });
    }

    // 2) Etat de la connexion (equipe connectee)
    if (req.method === 'GET' && q.meta === 'status') {
      const sql = getSql();
      const me = await requireAuth(req, res, sql, ['superadmin', 'admin']);
      if (!me) return;
      await ensureTable(sql);
      const counts = await sql`SELECT status, COUNT(*)::int AS n FROM meta_leads GROUP BY status`;
      const recent = await sql`SELECT leadgen_id, nom, status, attempts, error, created_at FROM meta_leads ORDER BY created_at DESC LIMIT 10`;
      const last = await sql`SELECT MAX(created_at) AS t FROM meta_leads WHERE status = 'ok'`;
      const by = {};
      counts.forEach(function (r) { by[r.status] = r.n; });
      return res.status(200).json({
        configure: {
          verify_token: !!c.verifyToken, app_secret: !!c.appSecret, page_token: !!c.pageToken
        },
        version_api: c.version,
        commercial: c.assignee || '(premier Super Admin)',
        leads: { ok: by.ok || 0, erreur: by.erreur || 0, en_cours: (by.en_cours || 0) + (by.nouveau || 0) },
        dernier_lead: last[0] ? last[0].t : null,
        recents: recent
      });
    }

    // 3) Relance des leads en erreur (Super Admin)
    if (req.method === 'POST' && q.meta === 'retry') {
      const sql = getSql();
      const me = await requireAuth(req, res, sql, ['superadmin']);
      if (!me) return;
      await ensureTable(sql);
      const rows = await sql`SELECT leadgen_id, page_id, form_id, ad_id FROM meta_leads WHERE status = 'erreur' ORDER BY created_at ASC LIMIT 10`;
      let ok = 0, ko = 0;
      for (const r of rows) {
        const out = await processLead(sql, { leadgen_id: r.leadgen_id, page_id: r.page_id, form_id: r.form_id, ad_id: r.ad_id }, c);
        if (out.ok) ok++; else ko++;
      }
      return res.status(200).json({ relances: rows.length, ok, erreurs: ko });
    }

    // 4) Notification de Meta (message signe)
    if (req.method === 'POST') {
      if (!c.appSecret) return res.status(503).json({ error: 'meta_non_configure' });
      const raw = await readRawBody(req);
      if (!raw) return res.status(400).json({ error: 'corps_illisible' });
      const sig = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
      if (!verifySignature(raw, sig, c.appSecret)) return res.status(401).json({ error: 'signature_invalide' });

      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'json_invalide' }); }
      const leads = extractLeads(payload).slice(0, 25);
      if (!leads.length) return res.status(200).json({ ok: true, leads: 0 });

      const sql = getSql();
      let retry = false;
      for (const rec of leads) {
        const out = await processLead(sql, rec, c);
        if (out.error) retry = true;
      }
      // 500 => Meta renverra le message plus tard (le lead est deja memorise en "erreur").
      if (retry) return res.status(500).json({ error: 'traitement_incomplet' });
      return res.status(200).json({ ok: true, leads: leads.length });
    }

    return res.status(405).json({ error: 'methode_non_autorisee' });
  } catch (e) {
    return res.status(500).json({ error: 'erreur_interne' });
  }
}

module.exports = { isMetaRequest, handle, verifySignature, parseLead, extractLeads, phoneKey, cleanPhone, SOURCE_LABEL };
