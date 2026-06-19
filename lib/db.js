// /lib/db.js
// Shared database connection helper using Neon serverless driver.
const { neon } = require('@neondatabase/serverless');

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error('DATABASE_URL ou POSTGRES_URL non configuree');
  }
  return neon(url);
}

module.exports = { getSql };
