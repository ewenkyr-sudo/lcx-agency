/**
 * Test E2E: onboarding flow
 *
 * Usage: JWT_SECRET=xxx DATABASE_URL=xxx node test-onboarding-flow.js
 *
 * 1. Cree une agence fresh (onboarding_completed = FALSE)
 * 2. Verifie que les endpoints sont bloques (403 ONBOARDING_REQUIRED)
 * 3. Verifie que /api/me et /api/agency/onboarding* passent
 * 4. Complete l'onboarding via /api/agency/onboarding/complete
 * 5. Verifie que les endpoints fonctionnent normalement apres
 * 6. Nettoie
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

let agencyId, userId, token;
let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function apiCall(method, path, authToken, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { Cookie: `token=${authToken}` }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  const hash = bcrypt.hashSync('testpass123', 10);
  // Create agency with onboarding_completed = FALSE (like a fresh registration)
  agencyId = (await pool.query(
    "INSERT INTO agencies (name, onboarding_completed) VALUES ('__TestOnboardingAgency__', FALSE) RETURNING id"
  )).rows[0].id;

  userId = (await pool.query(
    "INSERT INTO users (username, password, display_name, role, agency_id) VALUES ('__test_onboarding_user__', $1, 'Test Onboarding', 'super_admin', $2) RETURNING id",
    [hash, agencyId]
  )).rows[0].id;

  token = jwt.sign({ id: userId, username: '__test_onboarding_user__', role: 'super_admin', agency_id: agencyId }, JWT_SECRET, { expiresIn: '1h' });
  console.log(`[SETUP] Agency ${agencyId}, User ${userId}`);
}

async function cleanup() {
  await pool.query("DELETE FROM activity_log WHERE agency_id = $1", [agencyId]).catch(() => {});
  await pool.query("DELETE FROM settings WHERE agency_id = $1", [agencyId]).catch(() => {});
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query("DELETE FROM agencies WHERE id = $1", [agencyId]);
  console.log('[CLEANUP] Done');
  await pool.end();
}

async function runTests() {
  // 1. /api/me should work (whitelisted)
  console.log('\n[TEST] Whitelisted routes pass during onboarding');
  const me = await apiCall('GET', '/api/me', token);
  assert(me.status === 200, '/api/me returns 200');
  assert(me.body.onboarding_completed === false, '/api/me shows onboarding_completed=false');

  // 2. /api/agency/onboarding-status should work (whitelisted)
  const status = await apiCall('GET', '/api/agency/onboarding-status', token);
  assert(status.status === 200, '/api/agency/onboarding-status returns 200');
  assert(status.body.name === '__TestOnboardingAgency__', 'Agency name is correct');

  // 3. Regular endpoints should be BLOCKED
  console.log('\n[TEST] Non-whitelisted routes blocked during onboarding');
  const dashboard = await apiCall('GET', '/api/dashboard', token);
  assert(dashboard.status === 403, '/api/dashboard returns 403');
  assert(dashboard.body.error === 'ONBOARDING_REQUIRED', 'Error is ONBOARDING_REQUIRED');

  const users = await apiCall('GET', '/api/users', token);
  assert(users.status === 403, '/api/users returns 403');

  const team = await apiCall('GET', '/api/team', token);
  assert(team.status === 403, '/api/team returns 403');

  // 4. Draft save should work
  console.log('\n[TEST] Draft save works');
  const draft = await apiCall('PUT', '/api/agency/onboarding/draft', token, {
    name: '__TestOnboardingAgency__',
    country: 'FR',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    service_type: 'coaching',
    contact_email: 'test@test.com'
  });
  assert(draft.status === 200, 'Draft save returns 200');

  // 5. Complete onboarding (missing fields should fail)
  console.log('\n[TEST] Onboarding completion validation');
  const incompleteTry = await apiCall('POST', '/api/agency/onboarding/complete', token, {});
  assert(incompleteTry.status === 400, 'Incomplete onboarding returns 400');

  // 6. Complete onboarding with all required fields
  console.log('\n[TEST] Complete onboarding');
  const complete = await apiCall('POST', '/api/agency/onboarding/complete', token, {
    name: '__TestOnboardingAgency__',
    country: 'FR',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    service_type: 'coaching',
    models_count: 2,
    chatters_count: 3,
    target_markets: ['FR', 'US'],
    contact_email: 'test@test.com'
  });
  assert(complete.status === 200, 'Complete onboarding returns 200');

  // 7. Verify onboarding is marked complete
  const meAfter = await apiCall('GET', '/api/me', token);
  assert(meAfter.body.onboarding_completed === true, 'onboarding_completed is now true');

  // 8. Regular endpoints should now WORK
  console.log('\n[TEST] Routes unblocked after onboarding');
  const dashboardAfter = await apiCall('GET', '/api/dashboard', token);
  assert(dashboardAfter.status === 200, '/api/dashboard now returns 200');
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch(e) {
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
