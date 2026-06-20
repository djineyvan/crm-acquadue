// /api/audit.js
// GET:  fetch audit log entries, optionally filtered by department
// POST: insert a new audit log entry (called by logAction() on every write action)

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getSql();

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
