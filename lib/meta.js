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

// Selon la configuration de Vercel, le corps arrive soit brut (flux), soit deja
// transforme en objet JSON. On gere les deux cas :
//  - brut : la signature est verifiee sur les octets exacts recus ;
//  - transforme : on reconstruit les variantes habituelles du JSON d'origine
//    (Meta echappe "/" et les caracteres non ASCII) et on verifie la signature
//    sur chacune. Une signature fausse reste refusee dans tous les cas.
async function readBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return { raw: req.rawBody };
  // IMPORTANT : on lit le flux AVANT d'acceder a req.body. Sur Vercel, req.body est
  // analyse "a la demande" : y toucher en premier consomme le flux et fait perdre
  // les octets exacts dont on a besoin pour verifier la signature.
  if (typeof req.on === 'function' && req.readable !== false && !req.readableEnded) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 1024 * 1024) throw new Error('corps_trop_gros');
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    const raw = Buffer.concat(chunks);
    if (raw.length) return { raw };
  }
  if (Buffer.isBuffer(req.body)) return { raw: req.body };
  if (typeof req.body === 'string') return { raw: Buffer.from(req.body) };
  if (req.body && typeof req.body === 'object') return { parsed: req.body };
  return { raw: Buffer.alloc(0) };
}

function bodyVariants(obj) {
  const base = JSON.stringify(obj);
  const slash = base.replace(/\//g, '\\/');
  const uni = function (t) { return t.replace(/[\u0080-\uffff]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); };
  const out = [base, slash, uni(base), uni(slash)];
  return out.filter(function (v, i) { return out.indexOf(v) === i; }).map(function (v) { return Buffer.from(v, 'utf8'); });
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

// Journal des 50 dernieres tentatives de Meta (acceptees ou refusees) : permet de
// voir dans le CRM POURQUOI un message a ete refuse, sans aller dans Vercel.
async function recordHit(sql, outcome, detail) {
  try {
    await ensureTable(sql);
    await sql`INSERT INTO meta_hits (outcome, detail) VALUES (${outcome}, ${String(detail || '').slice(0, 300)})`;
    await sql`DELETE FROM meta_hits WHERE id NOT IN (SELECT id FROM meta_hits ORDER BY id DESC LIMIT 50)`;
  } catch (e) { /* le journal ne doit jamais bloquer le traitement */ }
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
  await sql`CREATE TABLE IF NOT EXISTS meta_hits (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    outcome TEXT, detail TEXT
  )`;
  // Noms lisibles de la publicite d'origine (ajout du 12/11/2026)
  await sql`ALTER TABLE meta_leads ADD COLUMN IF NOT EXISTS campagne TEXT`;
  await sql`ALTER TABLE meta_leads ADD COLUMN IF NOT EXISTS ensemble TEXT`;
  await sql`ALTER TABLE meta_leads ADD COLUMN IF NOT EXISTS annonce TEXT`;
  await sql`ALTER TABLE meta_leads ADD COLUMN IF NOT EXISTS formulaire TEXT`;
  await sql`ALTER TABLE meta_leads ADD COLUMN IF NOT EXISTS plateforme TEXT`;
  tableReady = true;
}

// ── Lecture d'un lead via l'API Graph ────────────────────────────────────────
async function graphGet(path, params, c, tokenOverride) {
  const token = tokenOverride || c.pageToken;
  const url = new URL('https://graph.facebook.com/' + c.version + '/' + path);
  Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
  url.searchParams.set('access_token', token);
  if (c.appSecret && !tokenOverride) {
    url.searchParams.set('appsecret_proof',
      crypto.createHmac('sha256', c.appSecret).update(token).digest('hex'));
  }
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), { signal: ctl.signal });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok || j.error) {
      const e0 = j.error || {};
      const msg = (e0.message || e0.type) || ('HTTP ' + r.status);
      const codes = e0.code ? ' (code ' + e0.code + (e0.error_subcode ? '/' + e0.error_subcode : '') + ')' : '';
      const err = new Error('graph: ' + msg + codes);
      err.code = e0.code;
      err.subcode = e0.error_subcode;
      throw err;
    }
    return j;
  } finally { clearTimeout(timer); }
}

// Identifiant envoye par le bouton « Tester » du tableau de bord Webhooks de Meta :
// ce n'est pas un vrai lead, il ne peut jamais etre lu.
const META_SAMPLE_LEAD_ID = '444444444444';

// Lecture de secours : parcourt la liste des prospects du formulaire (jusqu'a 500)
// pour retrouver le lead quand la lecture directe est refusee par Meta.
async function findLeadInForm(formId, leadId, c) {
  let after = '';
  let total = 0;
  for (let page = 0; page < 5; page++) {
    const params = { limit: '100', fields: 'id,created_time,ad_id,form_id,field_data' };
    if (after) params.after = after;
    const j = await graphGet(formId + '/leads', params, c);
    const list = j.data || [];
    total += list.length;
    const hit = list.find(function (l) { return String(l.id) === String(leadId); });
    if (hit) return { lead: hit, total: total };
    after = j.paging && j.paging.cursors && j.paging.next ? j.paging.cursors.after : '';
    if (!after) break;
  }
  return { lead: null, total: total };
}

// ── Transformation des reponses du formulaire ────────────────────────────────
// ── Noms de la campagne, de l'ensemble de pub, de l'annonce et du formulaire ──
// Lecture "en bonus" : si Meta refuse (permission manquante, delai depasse...),
// on garde seulement les identifiants. Cela ne bloque JAMAIS la creation du lead.
const AD_INFO_BUDGET_MS = 6000;
function withBudget(promise, ms) {
  return Promise.race([promise, new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); })]);
}
function platformLabel(p) {
  const v = String(p || '').toLowerCase();
  if (v === 'fb' || v === 'facebook') return 'Facebook';
  if (v === 'ig' || v === 'instagram') return 'Instagram';
  if (v === 'msg' || v === 'messenger') return 'Messenger';
  return p ? String(p) : '';
}
async function fetchAdInfo(lead, rec, c) {
  const info = { campagne: '', ensemble: '', annonce: '', formulaire: '', plateforme: '' };
  const quiet = function (p) { return p.catch(function () { return null; }); };
  const work = (async function () {
    const formId = rec.form_id || lead.form_id || '';
    const res = await Promise.all([
      quiet(graphGet(String(rec.leadgen_id), { fields: 'ad_id,ad_name,adset_name,campaign_name,form_id,platform' }, c)),
      formId ? quiet(graphGet(String(formId), { fields: 'name' }, c)) : Promise.resolve(null)
    ]);
    const l = res[0] || {};
    info.annonce = l.ad_name || lead.ad_name || '';
    info.ensemble = l.adset_name || lead.adset_name || '';
    info.campagne = l.campaign_name || lead.campaign_name || '';
    info.plateforme = platformLabel(l.platform || lead.platform);
    info.formulaire = (res[1] && res[1].name) || '';
    if (!rec.ad_id && l.ad_id) rec.ad_id = String(l.ad_id);
    // Si le lead ne donne pas les noms, on essaie l'annonce elle-meme.
    if (rec.ad_id && (!info.annonce || !info.campagne)) {
      const ad = await quiet(graphGet(String(rec.ad_id), { fields: 'name,adset{name},campaign{name}' }, c));
      if (ad) {
        info.annonce = info.annonce || ad.name || '';
        info.ensemble = info.ensemble || (ad.adset && ad.adset.name) || '';
        info.campagne = info.campagne || (ad.campaign && ad.campaign.name) || '';
      }
    }
  })();
  await withBudget(work.catch(function () {}), AD_INFO_BUDGET_MS);
  Object.keys(info).forEach(function (k) { info[k] = String(info[k] || '').slice(0, 200); });
  return info;
}

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

async function createProspect(sql, rec, parsed, c, ad) {
  ad = ad || {};
  const asg = await pickAssignee(sql, c);
  const key = phoneKey(parsed.tel);
  let dup = [];
  if (key) {
    dup = await sql`SELECT id, nom FROM clients WHERE regexp_replace(COALESCE(tel,''), '[^0-9]', '', 'g') LIKE ${'%' + key} LIMIT 1`;
  } else if (parsed.email) {
    dup = await sql`SELECT id, nom FROM clients WHERE lower(COALESCE(email,'')) = ${parsed.email.toLowerCase()} LIMIT 1`;
  }

  const notesLines = ['Lead recu via Meta (' + (ad.plateforme || 'Facebook/Instagram') + ') le ' + frDate(new Date()) + '.'];
  if (ad.campagne) notesLines.push('Campagne : ' + ad.campagne);
  if (ad.ensemble) notesLines.push('Ensemble de publicites : ' + ad.ensemble);
  if (ad.annonce || rec.ad_id) notesLines.push('Annonce : ' + (ad.annonce ? ad.annonce + (rec.ad_id ? ' (ID ' + rec.ad_id + ')' : '') : '(ID) ' + rec.ad_id));
  if (ad.formulaire || rec.form_id) notesLines.push('Formulaire : ' + (ad.formulaire ? ad.formulaire + (rec.form_id ? ' (ID ' + rec.form_id + ')' : '') : '(ID) ' + rec.form_id));
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
    : '📣 Nouveau lead Meta : ' + parsed.nom + (parsed.tel ? ' (' + parsed.tel + ')' : '') + (ad.annonce || ad.campagne ? ' - pub « ' + (ad.annonce || ad.campagne) + ' »' : '') + ' - a rappeler rapidement';
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
  if (String(rec.leadgen_id) === META_SAMPLE_LEAD_ID) {
    await sql`UPDATE meta_leads SET status = 'test', error = 'Message d''essai envoye par Meta (bouton Tester) : ignore', nom = 'Essai Meta', updated_at = NOW() WHERE leadgen_id = ${rec.leadgen_id}`;
    return { ok: true, test: true };
  }
  try {
    if (!c.pageToken) throw new Error('META_PAGE_ACCESS_TOKEN manquant');
    let lead;
    try {
      lead = await graphGet(String(rec.leadgen_id), {}, c);
    } catch (e1) {
      if (!rec.form_id) throw e1;
      const f = await findLeadInForm(rec.form_id, rec.leadgen_id, c).catch(function () { return { lead: null, total: -1 }; });
      if (!f.lead) throw new Error(e1.message + ' | liste du formulaire : ' + (f.total < 0 ? 'illisible' : f.total + ' prospect(s) visibles, lead absent'));
      lead = f.lead;
    }
    const parsed = parseLead(lead);
    if (!rec.ad_id && lead.ad_id) rec.ad_id = lead.ad_id;
    if (!rec.form_id && lead.form_id) rec.form_id = lead.form_id;
    const ad = await fetchAdInfo(lead, rec, c).catch(function () { return {}; });
    const res = await createProspect(sql, rec, parsed, c, ad);
    await sql`UPDATE meta_leads SET status = 'ok', error = NULL, client_id = ${res.clientId}, nom = ${parsed.nom}, ad_id = ${rec.ad_id || null}, form_id = ${rec.form_id || null},
              campagne = ${ad.campagne || null}, ensemble = ${ad.ensemble || null}, annonce = ${ad.annonce || null}, formulaire = ${ad.formulaire || null}, plateforme = ${ad.plateforme || null},
              updated_at = NOW() WHERE leadgen_id = ${rec.leadgen_id}`;
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

// ── Diagnostic de la lecture des leads (Super Admin) ─────────────────────────
// Ne renvoie AUCUN secret : uniquement des noms, des identifiants et des messages d'erreur.
async function step(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 300), code: e && e.code, subcode: e && e.subcode }; }
}

async function diagnose(sql, c) {
  const out = { etapes: {}, conclusion: [] };
  if (!c.pageToken) { out.conclusion.push('META_PAGE_ACCESS_TOKEN est absent de Vercel.'); return out; }

  const me = await step(function () { return graphGet('me', { fields: 'id,name' }, c); });
  out.etapes.jeton_page = me.ok ? { ok: true, page_id: me.data.id, page_nom: me.data.name } : me;

  const app = await step(function () { return graphGet('app', { fields: 'id,name' }, c); });
  out.etapes.application = app.ok ? { ok: true, app_id: app.data.id, app_nom: app.data.name } : app;

  if (app.ok && c.appSecret) {
    const dbg = await step(function () { return graphGet('debug_token', { input_token: c.pageToken }, c, app.data.id + '|' + c.appSecret); });
    if (dbg.ok && dbg.data && dbg.data.data) {
      const d = dbg.data.data;
      out.etapes.details_jeton = {
        ok: !!d.is_valid, type: d.type, valide: !!d.is_valid,
        expire: d.expires_at ? (d.expires_at === 0 ? 'jamais' : new Date(d.expires_at * 1000).toISOString()) : 'jamais',
        permissions: d.scopes || [],
        page_id: d.profile_id || null
      };
    } else out.etapes.details_jeton = dbg;
  }

  await ensureTable(sql);
  const rows = await sql`SELECT leadgen_id, page_id, form_id, ad_id, error FROM meta_leads
                         WHERE status = 'erreur' AND leadgen_id <> ${META_SAMPLE_LEAD_ID}
                         ORDER BY created_at DESC LIMIT 1`;
  const lead = rows[0];
  if (lead) {
    out.etapes.lead_en_erreur = { leadgen_id: lead.leadgen_id, page_id: lead.page_id, form_id: lead.form_id, ad_id: lead.ad_id };
    if (me.ok && lead.page_id) out.etapes.lead_en_erreur.meme_page_que_le_jeton = String(lead.page_id) === String(me.data.id);
    if (lead.form_id) {
      const f = await step(function () { return graphGet(lead.form_id, { fields: 'id,name,status' }, c); });
      out.etapes.formulaire = f.ok ? { ok: true, nom: f.data.name, statut: f.data.status } : f;
      const fl = await step(function () { return findLeadInForm(lead.form_id, lead.leadgen_id, c); });
      out.etapes.lecture_leads_du_formulaire = fl.ok ? { ok: true, nb_visibles: fl.data.total, lead_present: !!fl.data.lead } : fl;
    }
    const l = await step(function () { return graphGet(lead.leadgen_id, { fields: 'id,created_time' }, c); });
    out.etapes.lecture_du_lead = l.ok ? { ok: true } : l;
  }

  // Conclusion en francais simple
  const C = out.conclusion;
  const dj = out.etapes.details_jeton;
  const le = out.etapes.lead_en_erreur;
  if (!me.ok) C.push('Le jeton de Page n\'est plus valide (expire ou revoque) : il faut en generer un nouveau.');
  else if (dj && dj.type && dj.type !== 'PAGE') C.push('Le jeton enregistre est un jeton de type ' + dj.type + ', pas un jeton de Page.');
  else if (dj && dj.permissions && dj.permissions.indexOf('leads_retrieval') === -1) C.push('Il manque la permission leads_retrieval dans le jeton : il faut regenerer le jeton en cochant leads_retrieval.');
  else if (le && le.meme_page_que_le_jeton === false) C.push('Le lead vient d\'une AUTRE Page Facebook (ID ' + le.page_id + ') que celle du jeton (' + me.data.name + '). Il faut un jeton de la bonne Page.');
  else if (out.etapes.lecture_du_lead && out.etapes.lecture_du_lead.ok) C.push('Le lead est maintenant lisible : cliquez sur « Relancer les leads en erreur ».');
  else if (out.etapes.lecture_leads_du_formulaire && out.etapes.lecture_leads_du_formulaire.ok === false) C.push('Le jeton est valide mais Meta refuse l\'acces aux prospects de ce formulaire : verifier « Acces aux prospects » dans le Business Manager (le CRM ET votre compte doivent y etre autorises) et l\'acces a leads_retrieval de l\'app.');
  else if (out.etapes.lecture_leads_du_formulaire && out.etapes.lecture_leads_du_formulaire.lead_present) C.push('Le lead est lisible par la liste du formulaire : cliquez sur « Relancer les leads en erreur ».');
  else if (out.etapes.lecture_leads_du_formulaire && out.etapes.lecture_leads_du_formulaire.nb_visibles === 0) C.push('Meta ne laisse voir AUCUN prospect reel de ce formulaire a l\'application, alors que le jeton et les permissions sont bons. Il faut l\'acces avance (Advanced Access) a leads_retrieval pour l\'app, et verifier « Acces aux prospects » (CRM + votre compte) dans le Business Manager.');
  else if (le) C.push('Meta laisse voir ' + out.etapes.lecture_leads_du_formulaire.nb_visibles + ' prospect(s) du formulaire mais pas celui-ci : il a peut-etre ete supprime, ou il a ete cree par un autre outil.');
  else C.push('Aucun lead en erreur a analyser. Le jeton fonctionne.');
  return out;
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
      const recent = await sql`SELECT leadgen_id, page_id, form_id, ad_id, nom, status, attempts, error, campagne, annonce, formulaire, plateforme, created_at FROM meta_leads ORDER BY created_at DESC LIMIT 10`;
      // Bilan par publicite : combien de leads, et ce qu'ils sont devenus dans le CRM
      // (statut actuel de la fiche client liee).
      const bilan = await sql`SELECT COALESCE(m.annonce, CASE WHEN m.ad_id IS NOT NULL THEN 'Annonce ' || m.ad_id END, 'Annonce inconnue') AS annonce,
              COALESCE(m.campagne, '') AS campagne,
              COUNT(*)::int AS leads,
              COUNT(*) FILTER (WHERE cl.statut IN ('Contacte','Offre envoyee','En negociation'))::int AS en_cours,
              COUNT(*) FILTER (WHERE cl.statut = 'Client actif')::int AS clients,
              COUNT(*) FILTER (WHERE cl.statut = 'Client perdu')::int AS perdus,
              COUNT(*) FILTER (WHERE cl.statut = 'Non qualifie')::int AS non_qualifies,
              MAX(m.created_at) AS dernier
            FROM meta_leads m LEFT JOIN clients cl ON cl.id = m.client_id
            WHERE m.status = 'ok'
            GROUP BY 1, 2 ORDER BY leads DESC, dernier DESC LIMIT 20`;
      const last = await sql`SELECT MAX(created_at) AS t FROM meta_leads WHERE status = 'ok'`;
      const hits = await sql`SELECT created_at, outcome, detail FROM meta_hits ORDER BY id DESC LIMIT 10`;
      const by = {};
      counts.forEach(function (r) { by[r.status] = r.n; });
      return res.status(200).json({
        configure: {
          verify_token: !!c.verifyToken, app_secret: !!c.appSecret, page_token: !!c.pageToken
        },
        app_secret_format_ok: /^[0-9a-f]{32}$/i.test(c.appSecret),
        app_secret_longueur: c.appSecret.length,
        tentatives: hits,
        version_api: c.version,
        commercial: c.assignee || '(premier Super Admin)',
        leads: { ok: by.ok || 0, erreur: by.erreur || 0, en_cours: (by.en_cours || 0) + (by.nouveau || 0), test: by.test || 0 },
        dernier_lead: last[0] ? last[0].t : null,
        recents: recent,
        bilan_publicites: bilan
      });
    }

    // 2b) Diagnostic (Super Admin)
    if (req.method === 'GET' && q.meta === 'diag') {
      const sql = getSql();
      const me = await requireAuth(req, res, sql, ['superadmin']);
      if (!me) return;
      return res.status(200).json(await diagnose(sql, c));
    }

    // 2c) Ignorer un lead en erreur (lead supprime chez Meta, test...) (Super Admin)
    if (req.method === 'POST' && q.meta === 'ignore') {
      const sql = getSql();
      const me = await requireAuth(req, res, sql, ['superadmin']);
      if (!me) return;
      await ensureTable(sql);
      let b = null;
      try { b = req.body; } catch (e) { b = null; }
      if (!b || typeof b !== 'object' || Buffer.isBuffer(b)) {
        const rb = await readBody(req);
        try { b = rb.raw ? JSON.parse(rb.raw.toString('utf8') || '{}') : (rb.parsed || {}); } catch (e) { b = {}; }
      }
      const id = String((b && b.leadgen_id) || '').replace(/[^0-9]/g, '');
      if (!id) return res.status(400).json({ error: 'leadgen_id_manquant' });
      const r = await sql`UPDATE meta_leads SET status = 'ignore', error = ${'Ignore par ' + (me.nom || 'Super Admin') + ' (lead supprime ou de test)'}, updated_at = NOW()
                          WHERE leadgen_id = ${id} AND status = 'erreur' RETURNING leadgen_id`;
      return res.status(200).json({ ok: r.length === 1 });
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
      const body = await readBody(req);
      const sig = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
      const sigInfo = (sig ? 'signature presente' : 'AUCUNE signature') + ', corps ' + (body.raw ? ('brut ' + body.raw.length + ' octets') : 'deja transforme');
      let payload;
      if (body.raw) {
        if (!verifySignature(body.raw, sig, c.appSecret)) {
          if (sig) await recordHit(getSql(), 'refuse_signature', sigInfo + ' : la cle secrete (META_APP_SECRET) ne correspond pas a celle de Meta');
          return res.status(401).json({ error: 'signature_invalide' });
        }
        try { payload = JSON.parse(body.raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'json_invalide' }); }
      } else {
        const ok = bodyVariants(body.parsed).some(function (v) { return verifySignature(v, sig, c.appSecret); });
        if (!ok) {
          if (sig) await recordHit(getSql(), 'refuse_signature', sigInfo + ' : signature non reconnue');
          return res.status(401).json({ error: 'signature_invalide' });
        }
        payload = body.parsed;
      }
      const leads = extractLeads(payload).slice(0, 25);
      if (!leads.length) { await recordHit(getSql(), 'recu_sans_lead', 'message signe recu, sans lead (test ou autre evenement)'); return res.status(200).json({ ok: true, leads: 0 }); }

      const sql = getSql();
      let retry = false;
      for (const rec of leads) {
        const out = await processLead(sql, rec, c);
        if (out.error) retry = true;
      }
      await recordHit(sql, retry ? 'recu_erreur' : 'recu_ok', leads.length + ' lead(s)');
      // Relance automatique (max 3) des anciens leads en erreur, a chaque message de Meta.
      try {
        const old = await sql`SELECT leadgen_id, page_id, form_id, ad_id FROM meta_leads
                              WHERE status = 'erreur' AND attempts < 30 AND updated_at < NOW() - INTERVAL '15 minutes'
                              ORDER BY updated_at ASC LIMIT 3`;
        for (const r of old) await processLead(sql, { leadgen_id: r.leadgen_id, page_id: r.page_id, form_id: r.form_id, ad_id: r.ad_id }, c);
      } catch (e) { /* jamais bloquant */ }
      // Toujours 200 : le lead est memorise dans le CRM (meme en erreur) et peut etre
      // relance depuis le CRM. Repondre 500 faisait renvoyer le message par Meta en
      // boucle pendant 36 h, et Meta peut desactiver un webhook qui echoue trop souvent.
      return res.status(200).json({ ok: !retry, leads: leads.length });
    }

    return res.status(405).json({ error: 'methode_non_autorisee' });
  } catch (e) {
    return res.status(500).json({ error: 'erreur_interne' });
  }
}

module.exports = { isMetaRequest, handle, diagnose, META_SAMPLE_LEAD_ID, verifySignature, parseLead, extractLeads, phoneKey, cleanPhone, SOURCE_LABEL };
