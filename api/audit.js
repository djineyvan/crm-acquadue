// /api/audit.js
// GET: fetch audit log entries, optionally filtered by department

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Methode non autorisee' });

  try {
    const sql = getSql();
    const dept = req.query.dept;

    const rows = dept
      ? await sql`SELECT * FROM audit_log WHERE dept = ${dept} ORDER BY ts DESC LIMIT 200`
      : await sql`SELECT * FROM audit_log ORDER BY ts DESC LIMIT 200`;

    return res.status(200).json({ logs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
