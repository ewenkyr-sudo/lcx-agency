const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/lcx_agency',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
module.exports = pool;
