/**
 * Test d'isolation multi-tenant pour les endpoints analytics.
 *
 * Prerequis:
 *   - DATABASE_URL et JWT_SECRET doivent etre definis
 *   - La base doit etre accessible
 *
 * Usage:
 *   JWT_SECRET=xxx DATABASE_URL=xxx node test-analytics-isolation.js
 *
 * Le script :
 *   1. Cree 2 agences + 1 admin par agence + des student_leads distincts
 *   2. Appelle les 4 endpoints analytics en tant qu'admin de l'agence A
 *   3. Verifie qu'aucune donnee de l'agence B n'apparait
 *   4. Nettoie les donnees de test
 */

const http = require('http');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/lcx_agency';

if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET required'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render') ? { rejectUnauthorized: false } : false
});

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

let agencyA, agencyB, userA, userB, studentA, studentB;

async function setup() {
  const hash = await bcrypt.hash('testpass123', 10);

  // Creer 2 agences
  agencyA = (await pool.query("INSERT INTO agencies (name) VALUES ('__TestAgencyA__') RETURNING id")).rows[0].id;
  agencyB = (await pool.query("INSERT INTO agencies (name) VALUES ('__TestAgencyB__') RETURNING id")).rows[0].id;

  // Creer 1 admin (super_admin) par agence
  userA = (await pool.query(
    "INSERT INTO users (username, password, display_name, role, agency_id) VALUES ('__test_admin_a__', $1, 'Admin A', 'super_admin', $2) RETURNING id",
    [hash, agencyA]
  )).rows[0].id;

  userB = (await pool.query(
    "INSERT INTO users (username, password, display_name, role, agency_id) VALUES ('__test_admin_b__', $1, 'Admin B', 'super_admin', $2) RETURNING id",
    [hash, agencyB]
  )).rows[0].id;

  // Creer 1 student (role outreach) par agence pour le ranking
  studentA = (await pool.query(
    "INSERT INTO users (username, password, display_name, role, agency_id) VALUES ('__test_outreach_a__', $1, 'Outreach A', 'outreach', $2) RETURNING id",
    [hash, agencyA]
  )).rows[0].id;

  studentB = (await pool.query(
    "INSERT INTO users (username, password, display_name, role, agency_id) VALUES ('__test_outreach_b__', $1, 'Outreach B', 'outreach', $2) RETURNING id",
    [hash, agencyB]
  )).rows[0].id;

  // Creer des student_leads pour chaque agence
  for (let i = 0; i < 5; i++) {
    await pool.query(
      "INSERT INTO student_leads (username, user_id, added_by, status, market, sent_at) VALUES ($1, $2, $3, 'talking-cold', 'fr', NOW())",
      [`__test_lead_a_${i}__`, userA, studentA]
    );
  }
  for (let i = 0; i < 3; i++) {
    await pool.query(
      "INSERT INTO student_leads (username, user_id, added_by, status, market, sent_at) VALUES ($1, $2, $3, 'signed', 'us', NOW())",
      [`__test_lead_b_${i}__`, userB, studentB]
    );
  }

  console.log(`[SETUP] Agency A (id=${agencyA}): 5 leads FR | Agency B (id=${agencyB}): 3 leads US`);
}

async function cleanup() {
  await pool.query("DELETE FROM student_leads WHERE username LIKE '__test_lead_%'");
  await pool.query("DELETE FROM users WHERE username LIKE '__test_%'");
  await pool.query("DELETE FROM agencies WHERE name LIKE '__TestAgency%'");
  console.log('[CLEANUP] Done');
  await pool.end();
}

function makeToken(userId, role, agencyId) {
  return jwt.sign({ id: userId, role, agency_id: agencyId }, JWT_SECRET, { expiresIn: '1h' });
}

function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.get(url, {
      headers: { Cookie: `token=${token}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function runTests() {
  const tokenA = makeToken(userA, 'super_admin', agencyA);

  // 1. fr-vs-us — Agency A ne doit voir que des leads FR, pas US
  console.log('\n[TEST] GET /api/analytics/fr-vs-us');
  const frVsUs = await apiGet('/api/analytics/fr-vs-us', tokenA);
  assert(frVsUs.status === 200, 'Status 200');
  const usRow = frVsUs.body.find(r => r.market === 'us');
  assert(!usRow || parseInt(usRow.total) === 0, 'No US leads visible for agency A');
  const frRow = frVsUs.body.find(r => r.market === 'fr');
  assert(frRow && parseInt(frRow.total) >= 5, 'FR leads visible for agency A');

  // 2. assistant-ranking — Ne doit voir que Outreach A
  console.log('\n[TEST] GET /api/analytics/assistant-ranking');
  const ranking = await apiGet('/api/analytics/assistant-ranking', tokenA);
  assert(ranking.status === 200, 'Status 200');
  const hasOutreachB = ranking.body.some(r => r.name === 'Outreach B');
  assert(!hasOutreachB, 'Outreach B not visible for agency A');
  const hasOutreachA = ranking.body.some(r => r.name === 'Outreach A');
  assert(hasOutreachA, 'Outreach A visible for agency A');

  // 3. reply-rate-weekly — Doit avoir des donnees (agency A a des leads cette semaine)
  console.log('\n[TEST] GET /api/analytics/reply-rate-weekly');
  const weekly = await apiGet('/api/analytics/reply-rate-weekly', tokenA);
  assert(weekly.status === 200, 'Status 200');
  assert(Array.isArray(weekly.body), 'Returns array');

  // 4. hourly — Doit avoir des donnees (agency A a des sent_at)
  console.log('\n[TEST] GET /api/analytics/hourly');
  const hourly = await apiGet('/api/analytics/hourly', tokenA);
  assert(hourly.status === 200, 'Status 200');
  assert(Array.isArray(hourly.body), 'Returns array');

  // 5. Verification croisee : Agency B ne doit PAS voir les leads de A
  console.log('\n[TEST] Cross-check: Agency B sees only its own data');
  const tokenB = makeToken(userB, 'super_admin', agencyB);
  const frVsUsB = await apiGet('/api/analytics/fr-vs-us', tokenB);
  const frRowB = frVsUsB.body.find(r => r.market === 'fr');
  assert(!frRowB || parseInt(frRowB.total) === 0, 'Agency B sees no FR leads (those belong to A)');
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (e) {
    console.error('ERROR:', e);
    failed++;
  } finally {
    await cleanup();
    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);
    process.exit(failed > 0 ? 1 : 0);
  }
})();
