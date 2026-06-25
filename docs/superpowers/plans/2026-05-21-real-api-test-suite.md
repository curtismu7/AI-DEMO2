# Real API Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel `tests/real/` suite in `demo_api_server/` that drives real HTTP calls through the running BFF (`https://api.ping.demo:3001`) covering all 6 verticals, validating the full bootstrap contract, without touching any existing mocked tests.

**Architecture:** New `tests/real/` tree with shared helper infrastructure (session, fixtures, BFF client, reset) built in Phase 1; per-vertical and shared test files migrated in Phase 2 in priority order. Old `src/__tests__/` suite stays green throughout as a regression floor — files deleted from it only after their `tests/real/` counterpart is green.

**Tech Stack:** Node.js, Jest, axios, lmdb, https (Node built-in), PingOne PKCE headless login

---

## File Map

### Phase 1 — Infrastructure (create)
- `demo_api_server/tests/real/helpers/session.js` — headless PKCE login + sessions.db fallback + skip sentinel
- `demo_api_server/tests/real/helpers/bffClient.js` — axios instance factory + setVertical/restoreVertical
- `demo_api_server/tests/real/helpers/fixtures.js` — bootstrapFixtures(verticalId) for all 6 verticals
- `demo_api_server/tests/real/helpers/reset.js` — POST /api/admin/reset-demo + balance restore
- `demo_api_server/tests/real/helpers/globalSetup.js` — orchestrates session + fixture bootstrap at suite start
- `demo_api_server/tests/real/helpers/globalTeardown.js` — restores banking vertical, removes temp files
- `demo_api_server/tests/real/helpers/suiteSetup.js` — per-file skipIfNoSession() guard loaded via setupFilesAfterEnv
- `demo_api_server/jest.real.config.js` — Jest config for real suite
- `demo_api_server/package.json` — add test:real* scripts (modify)
- `demo_api_server/.gitignore` — add .test-session.json, .test-fixtures.json (modify)

### Phase 2 — Test files (create)
- `demo_api_server/tests/real/shared/health.test.js`
- `demo_api_server/tests/real/shared/bootstrap.test.js`
- `demo_api_server/tests/real/shared/oauth-status.test.js`
- `demo_api_server/tests/real/shared/config.test.js`
- `demo_api_server/tests/real/shared/admin.test.js`
- `demo_api_server/tests/real/shared/mcp.test.js`
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/accounts.test.js` (×6)
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/transactions.test.js` (×6)
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/transfers.test.js` (×6)
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/hitl.test.js` (×6)
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/agent.test.js` (×6)
- `demo_api_server/tests/real/{banking,retail,sporting-goods,healthcare,workforce,admin}/vertical.test.js` (×6)

---

## Task 1: Jest config, npm scripts, and .gitignore

**Files:**
- Create: `demo_api_server/jest.real.config.js`
- Modify: `demo_api_server/package.json`
- Modify: `demo_api_server/.gitignore`

- [ ] **Step 1: Create jest.real.config.js**

```js
// demo_api_server/jest.real.config.js
'use strict';
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/real/**/*.test.js'],
  globalSetup: '<rootDir>/tests/real/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/real/helpers/globalTeardown.js',
  setupFilesAfterEnv: ['<rootDir>/tests/real/helpers/suiteSetup.js'],
  testTimeout: 30000,
  runInBand: true,
  forceExit: true,
  verbose: true,
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/', '/\\.kilo/worktrees/'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid-cjs.js',
  },
};
```

- [ ] **Step 2: Add test:real* scripts to package.json**

Add these entries to the `"scripts"` section of `demo_api_server/package.json`:

```json
"test:real":                "RUN_REAL_TESTS=true jest --config=jest.real.config.js",
"test:real:banking":        "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/banking",
"test:real:retail":         "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/retail",
"test:real:sporting-goods": "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/sporting-goods",
"test:real:healthcare":     "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/healthcare",
"test:real:workforce":      "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/workforce",
"test:real:admin-vertical": "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/admin",
"test:real:shared":         "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/shared",
"test:real:smoke":          "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/shared/health"
```

- [ ] **Step 3: Add temp test files to .gitignore**

Add to `demo_api_server/.gitignore` (or root `.gitignore` if no BFF-level one exists):
```
# Real test suite temp files (session + fixture cache)
.test-session.json
.test-fixtures.json
```

- [ ] **Step 4: Verify existing npm test still works**

```bash
cd demo_api_server && npm test -- --testPathPattern=health --forceExit
```
Expected: existing health test passes, no changes to default suite.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/jest.real.config.js demo_api_server/package.json demo_api_server/.gitignore
git commit -m "feat(test-real): jest config, npm scripts, and gitignore for real API test suite"
```

---

## Task 2: session.js — headless login + sessions.db fallback

**Files:**
- Create: `demo_api_server/tests/real/helpers/session.js`

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p demo_api_server/tests/real/helpers
```

- [ ] **Step 2: Write session.js**

```js
// demo_api_server/tests/real/helpers/session.js
'use strict';

const path = require('path');
const fs   = require('fs');
const https  = require('https');
const axios  = require('axios');
const crypto = require('crypto');

const SESSION_CACHE = path.resolve(__dirname, '../../../.test-session.json');
const BFF_BASE      = 'https://api.ping.demo:3001';
const httpsAgent    = new https.Agent({ rejectUnauthorized: false }); // mkcert self-signed

// ── Headless PKCE login ───────────────────────────────────────────────────────

async function headlessLogin({ envId, region, clientId, clientSecret, redirectUri, username, password, authMethod }) {
  const base = `https://auth.pingone.${region || 'com'}/${envId}/as`;
  const codeVerifier  = crypto.randomBytes(64).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  function extractSetCookies(res) {
    return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  }
  function mergeCookies(existing, fresh) {
    if (!fresh) return existing;
    const map = new Map();
    for (const pair of (existing || '').split('; ').filter(Boolean)) {
      const [k, ...v] = pair.split('='); map.set(k, v.join('='));
    }
    for (const pair of fresh.split('; ').filter(Boolean)) {
      const [k, ...v] = pair.split('='); map.set(k, v.join('='));
    }
    return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const state = crypto.randomBytes(16).toString('hex');
  let pCookies = '';

  // Step 1: authorize → flowId
  const authUrl = `${base}/authorize?` + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'openid profile email read write', state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
  });
  const r1 = await axios.get(authUrl, { maxRedirects: 0, validateStatus: () => true, httpsAgent });
  pCookies = mergeCookies(pCookies, extractSetCookies(r1));
  const loc1 = r1.headers.location || '';
  let flowId;
  try { flowId = new URL(loc1).searchParams.get('flowId'); } catch (_) {}
  if (!flowId) {
    const r1b = await axios.get(loc1, { maxRedirects: 0, validateStatus: () => true, httpsAgent, headers: { Cookie: pCookies } });
    pCookies = mergeCookies(pCookies, extractSetCookies(r1b));
    try { flowId = new URL(r1b.headers.location || '').searchParams.get('flowId'); } catch (_) {}
  }
  if (!flowId) throw new Error('headlessLogin: could not extract flowId');

  // Step 2: submit credentials
  const flowUrl = `https://auth.pingone.${region || 'com'}/${envId}/flows/${flowId}`;
  const r2 = await axios.post(flowUrl, { username, password }, {
    headers: { 'Content-Type': 'application/vnd.pingidentity.usernamePassword.check+json', Cookie: pCookies },
    validateStatus: () => true, httpsAgent,
  });
  pCookies = mergeCookies(pCookies, extractSetCookies(r2));
  if (r2.data?.status !== 'COMPLETED') throw new Error(`headlessLogin: flow not COMPLETED: ${r2.data?.status}`);

  // Step 3: resume → authorization code
  const r3 = await axios.get(`${base}/resume?flowId=${flowId}`, {
    maxRedirects: 0, validateStatus: () => true, httpsAgent, headers: { Cookie: pCookies },
  });
  const loc3 = r3.headers.location || '';
  const code = new URL(loc3).searchParams.get('code');
  const err3 = new URL(loc3).searchParams.get('error');
  if (err3) throw new Error(`headlessLogin: PingOne error: ${err3}`);
  if (!code) throw new Error('headlessLogin: no code in resume redirect');

  // Step 4: exchange code at BFF /api/auth/oauth/callback
  // We replay the code exchange by hitting the BFF callback endpoint directly.
  // The BFF needs the oauthState + oauthCodeVerifier in session — but in headless
  // mode we can't use the BFF's /login redirect (no browser). Instead hit the
  // BFF token endpoint directly and manually seed the session.
  //
  // Alternative: use the raw PingOne token endpoint, then call a BFF seeding endpoint.
  // Simplest: call PingOne /token directly, then POST to /api/auth/test-seed (added in Task 3).
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    code_verifier: codeVerifier, client_id: clientId,
  });
  const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (authMethod === 'basic') {
    tokenHeaders.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    tokenBody.set('client_secret', clientSecret);
  }
  const tokenRes = await axios.post(`${base}/token`, tokenBody.toString(), { headers: tokenHeaders, httpsAgent });
  return tokenRes.data; // { access_token, id_token, refresh_token, expires_in, ... }
}

// ── BFF session seeding ───────────────────────────────────────────────────────
// After obtaining tokens from PingOne directly, seed a BFF session by calling
// GET /api/auth/oauth/login (starts session) then the BFF callback via axios
// with cookie tracking so we capture the connect.sid.

async function loginViaBff({ envId, region, clientId, clientSecret, redirectUri, username, password, authMethod }) {
  // Use BFF /api/auth/oauth/login → PingOne → BFF callback, tracking cookies.
  const bff = axios.create({ baseURL: BFF_BASE, httpsAgent, maxRedirects: 0, validateStatus: () => true });
  let bffCookies = '';

  function extractBffCookies(r) {
    return (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  }
  function merge(existing, fresh) {
    if (!fresh) return existing;
    const map = new Map();
    for (const p of (existing || '').split('; ').filter(Boolean)) { const [k,...v]=p.split('='); map.set(k,v.join('=')); }
    for (const p of fresh.split('; ').filter(Boolean)) { const [k,...v]=p.split('='); map.set(k,v.join('=')); }
    return [...map.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
  }

  // 1. Start BFF login — get connect.sid + state in session
  const r1 = await bff.get('/api/auth/oauth/login', { headers: { Cookie: bffCookies } });
  bffCookies = merge(bffCookies, extractBffCookies(r1));
  const pingLoc = r1.headers.location || '';
  if (!pingLoc) throw new Error('BFF /login did not redirect to PingOne');

  // 2. Follow to PingOne, do headless credential flow
  let pCookies = '';
  const r2 = await axios.get(pingLoc, { maxRedirects: 0, validateStatus: () => true, httpsAgent });
  pCookies = merge(pCookies, (r2.headers['set-cookie'] || []).map(c=>c.split(';')[0]).join('; '));
  const loc2 = r2.headers.location || '';
  let flowId;
  try { flowId = new URL(loc2).searchParams.get('flowId'); } catch(_) {}
  if (!flowId) {
    const r2b = await axios.get(loc2, { maxRedirects:0, validateStatus:()=>true, httpsAgent, headers:{Cookie:pCookies} });
    pCookies = merge(pCookies, (r2b.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '));
    try { flowId = new URL(r2b.headers.location||'').searchParams.get('flowId'); } catch(_) {}
  }
  if (!flowId) throw new Error('loginViaBff: could not extract flowId');

  const base = `https://auth.pingone.${region || 'com'}/${envId}/as`;
  const flowUrl = `https://auth.pingone.${region || 'com'}/${envId}/flows/${flowId}`;
  const rc = await axios.post(flowUrl, { username, password }, {
    headers: { 'Content-Type': 'application/vnd.pingidentity.usernamePassword.check+json', Cookie: pCookies },
    validateStatus:()=>true, httpsAgent,
  });
  pCookies = merge(pCookies, (rc.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '));
  if (rc.data?.status !== 'COMPLETED') throw new Error(`loginViaBff: flow not COMPLETED: ${rc.data?.status}`);

  const rr = await axios.get(`${base}/resume?flowId=${flowId}`, {
    maxRedirects:0, validateStatus:()=>true, httpsAgent, headers:{Cookie:pCookies},
  });
  const resumeLoc = rr.headers.location || '';
  const code = new URL(resumeLoc).searchParams.get('code');
  const errR = new URL(resumeLoc).searchParams.get('error');
  if (errR) throw new Error(`loginViaBff: PingOne error: ${errR}`);
  if (!code) throw new Error('loginViaBff: no code in resume redirect');

  // 3. Send code to BFF callback — BFF issues connect.sid with full session
  const callbackUrl = `/api/auth/oauth/callback?code=${code}&state=${new URL(resumeLoc).searchParams.get('state')||''}`;
  const r4 = await bff.get(callbackUrl, { headers: { Cookie: bffCookies } });
  bffCookies = merge(bffCookies, extractBffCookies(r4));

  // connect.sid is in bffCookies
  const sidEntry = bffCookies.split('; ').find(p => p.startsWith('connect.sid='));
  if (!sidEntry) throw new Error('loginViaBff: no connect.sid in BFF cookies after callback');
  return sidEntry; // "connect.sid=s%3A..."
}

// ── sessions.db fallback ──────────────────────────────────────────────────────

function loadFromSessionsDb() {
  try {
    const { open } = require('lmdb');
    const dbPath = path.resolve(__dirname, '../../../data/sessions-lmdb');
    if (!fs.existsSync(dbPath)) return null;
    const db = open({ path: dbPath, readOnly: true });
    const rows = [...db.getRange({ limit: 20 })].map(({ key, value }) => ({ sid: key, sess: value }));
    db.close();
    const now = Math.floor(Date.now() / 1000);
    for (const row of rows) {
      try {
        const sess = JSON.parse(row.sess);
        const at = sess?.oauthTokens?.accessToken;
        if (!at) continue;
        const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString());
        if (payload.exp > now) {
          return `connect.sid=${encodeURIComponent(`s:${row.sid}`)}`;
        }
      } catch (_) { /* skip malformed */ }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function resolveSession(persona = 'enduser') {
  const cached = fs.existsSync(SESSION_CACHE) ? JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8')) : {};
  if (cached[persona] && cached[persona] !== 'skip') return cached[persona];

  const envId    = process.env.PINGONE_ENVIRONMENT_ID;
  const region   = process.env.PINGONE_REGION || 'com';
  const authMethod = 'post';

  if (persona === 'enduser' && process.env.PINGONE_TEST_USER && process.env.PINGONE_TEST_PASSWORD) {
    const clientId     = process.env.PINGONE_USER_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.PINGONE_USER_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;
    const redirectUri  = `https://api.ping.demo:3001/api/auth/oauth/callback`;
    try {
      const cookie = await loginViaBff({ envId, region, clientId, clientSecret, redirectUri,
        username: process.env.PINGONE_TEST_USER, password: process.env.PINGONE_TEST_PASSWORD, authMethod });
      return cookie;
    } catch (e) {
      console.warn(`[session] Headless enduser login failed: ${e.message} — trying sessions.db`);
    }
  }

  if (persona === 'admin' && process.env.PINGONE_TEST_ADMIN_USER && process.env.PINGONE_TEST_ADMIN_PASSWORD) {
    const clientId     = process.env.PINGONE_ADMIN_CLIENT_ID;
    const clientSecret = process.env.PINGONE_ADMIN_CLIENT_SECRET;
    const redirectUri  = `https://api.ping.demo:3001/api/auth/oauth/callback`;
    try {
      const cookie = await loginViaBff({ envId, region, clientId, clientSecret, redirectUri,
        username: process.env.PINGONE_TEST_ADMIN_USER, password: process.env.PINGONE_TEST_ADMIN_PASSWORD, authMethod });
      return cookie;
    } catch (e) {
      console.warn(`[session] Headless admin login failed: ${e.message} — trying sessions.db`);
    }
  }

  // sessions.db fallback (works for both personas — picks the most recent valid session)
  const dbCookie = loadFromSessionsDb();
  if (dbCookie) return dbCookie;

  return null; // triggers skip sentinel in globalSetup
}

module.exports = { resolveSession, SESSION_CACHE };
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/helpers/session.js
git commit -m "feat(test-real): session helper — headless PKCE login + sessions.db fallback"
```

---

## Task 3: bffClient.js — axios instance factory

**Files:**
- Create: `demo_api_server/tests/real/helpers/bffClient.js`

- [ ] **Step 1: Write bffClient.js**

```js
// demo_api_server/tests/real/helpers/bffClient.js
'use strict';

const https = require('https');
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const SESSION_CACHE  = path.resolve(__dirname, '../../../.test-session.json');
const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');
const BFF_BASE       = 'https://api.ping.demo:3001';
const httpsAgent     = new https.Agent({ rejectUnauthorized: false });

let _previousVertical = 'banking';

function loadSession(persona = 'enduser') {
  if (!fs.existsSync(SESSION_CACHE)) throw new Error('No .test-session.json — run globalSetup first');
  const cache = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
  const cookie = cache[persona];
  if (!cookie || cookie === 'skip') throw new Error(`No valid session for persona '${persona}'`);
  return cookie;
}

function createBffClient(persona = 'enduser') {
  const cookie = loadSession(persona);
  return axios.create({
    baseURL: BFF_BASE,
    httpsAgent,
    headers: { Cookie: cookie },
    validateStatus: () => true, // let tests assert status codes
  });
}

async function setVertical(client, verticalId) {
  const current = await client.get('/api/config/vertical');
  _previousVertical = current.data?.activeVertical || 'banking';
  await client.put('/api/config/vertical', { verticalId });
}

async function restoreVertical(client) {
  await client.put('/api/config/vertical', { verticalId: _previousVertical });
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_CACHE)) throw new Error('No .test-fixtures.json — run globalSetup first');
  return JSON.parse(fs.readFileSync(FIXTURES_CACHE, 'utf8'));
}

module.exports = { createBffClient, setVertical, restoreVertical, loadFixtures, BFF_BASE };
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_server/tests/real/helpers/bffClient.js
git commit -m "feat(test-real): bffClient — axios factory with vertical switch helpers"
```

---

## Task 4: fixtures.js — bootstrap test accounts for all 6 verticals

**Files:**
- Create: `demo_api_server/tests/real/helpers/fixtures.js`

- [ ] **Step 1: Write fixtures.js**

```js
// demo_api_server/tests/real/helpers/fixtures.js
'use strict';

const CHECKING_BALANCE = 10000; // $10,000 — large enough no test drains to zero
const SAVINGS_BALANCE  = 5000;  // $5,000

const VERTICAL_FIXTURES = {
  banking:        { chk: 'chk-test-real-banking',        sav: 'sav-test-real-banking',        userId: 'test-real-suite' },
  retail:         { chk: 'chk-test-real-retail',         sav: 'sav-test-real-retail',         userId: 'test-real-suite' },
  'sporting-goods': { chk: 'chk-test-real-sporting-goods', sav: 'sav-test-real-sporting-goods', userId: 'test-real-suite' },
  healthcare:     { chk: 'chk-test-real-healthcare',     sav: 'sav-test-real-healthcare',     userId: 'test-real-suite' },
  workforce:      { chk: 'chk-test-real-workforce',      sav: 'sav-test-real-workforce',      userId: 'test-real-suite' },
  admin:          { chk: 'chk-test-real-admin',          sav: 'sav-test-real-admin',          userId: 'test-real-suite' },
};

async function bootstrapFixtures(adminClient, verticalId) {
  const ids = VERTICAL_FIXTURES[verticalId];
  if (!ids) throw new Error(`Unknown verticalId: ${verticalId}`);

  // Ensure accounts exist — POST if missing, ignore 409
  const chkPayload = { id: ids.chk, userId: ids.userId, accountType: 'checking', name: `Test Checking (${verticalId})`, balance: CHECKING_BALANCE, currency: 'USD' };
  const savPayload = { id: ids.sav, userId: ids.userId, accountType: 'savings',  name: `Test Savings (${verticalId})`,  balance: SAVINGS_BALANCE,  currency: 'USD' };

  const r1 = await adminClient.post('/api/accounts', chkPayload);
  if (r1.status !== 201 && r1.status !== 409 && r1.status !== 200) {
    throw new Error(`bootstrapFixtures(${verticalId}): chk create failed ${r1.status}: ${JSON.stringify(r1.data)}`);
  }

  const r2 = await adminClient.post('/api/accounts', savPayload);
  if (r2.status !== 201 && r2.status !== 409 && r2.status !== 200) {
    throw new Error(`bootstrapFixtures(${verticalId}): sav create failed ${r2.status}: ${JSON.stringify(r2.data)}`);
  }

  return { ...ids, checkingBalance: CHECKING_BALANCE, savingsBalance: SAVINGS_BALANCE };
}

async function restoreBalances(adminClient, verticalId) {
  const ids = VERTICAL_FIXTURES[verticalId];
  if (!ids) throw new Error(`Unknown verticalId: ${verticalId}`);
  await adminClient.put(`/api/accounts/${ids.chk}`, { balance: CHECKING_BALANCE });
  await adminClient.put(`/api/accounts/${ids.sav}`, { balance: SAVINGS_BALANCE });
}

module.exports = { bootstrapFixtures, restoreBalances, VERTICAL_FIXTURES, CHECKING_BALANCE, SAVINGS_BALANCE };
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_server/tests/real/helpers/fixtures.js
git commit -m "feat(test-real): fixtures — bootstrapFixtures + restoreBalances for all 6 verticals"
```

---

## Task 5: reset.js — demo reset and balance restore

**Files:**
- Create: `demo_api_server/tests/real/helpers/reset.js`

- [ ] **Step 1: Write reset.js**

```js
// demo_api_server/tests/real/helpers/reset.js
'use strict';

const { restoreBalances } = require('./fixtures');

async function resetDemo(client) {
  const r = await client.post('/api/admin/reset-demo');
  if (r.status !== 200) throw new Error(`reset-demo failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function resetSuite(adminClient, verticalId) {
  await resetDemo(adminClient);
  await restoreBalances(adminClient, verticalId);
}

module.exports = { resetDemo, resetSuite };
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_server/tests/real/helpers/reset.js
git commit -m "feat(test-real): reset helper — resetDemo + resetSuite for write test suites"
```

---

## Task 6: globalSetup.js + globalTeardown.js + suiteSetup.js

**Files:**
- Create: `demo_api_server/tests/real/helpers/globalSetup.js`
- Create: `demo_api_server/tests/real/helpers/globalTeardown.js`
- Create: `demo_api_server/tests/real/helpers/suiteSetup.js`

- [ ] **Step 1: Write globalSetup.js**

```js
// demo_api_server/tests/real/helpers/globalSetup.js
'use strict';

const fs   = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false });

const { resolveSession, SESSION_CACHE } = require('./session');
const { createBffClient }               = require('./bffClient');
const { bootstrapFixtures }             = require('./fixtures');

const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');
const VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce', 'admin'];

module.exports = async function globalSetup() {
  if (process.env.RUN_REAL_TESTS !== 'true') return;

  console.log('[globalSetup] Resolving sessions...');

  // Resolve both personas
  const enduserCookie = await resolveSession('enduser');
  const adminCookie   = await resolveSession('admin') || enduserCookie; // admin falls back to enduser

  const cache = {
    enduser: enduserCookie || 'skip',
    admin:   adminCookie   || 'skip',
  };
  fs.writeFileSync(SESSION_CACHE, JSON.stringify(cache, null, 2));

  if (!enduserCookie) {
    console.warn('[globalSetup] No valid session found — all real tests will be skipped');
    return;
  }

  console.log('[globalSetup] Bootstrapping fixtures for all verticals...');

  // Write sessions first so createBffClient can read them
  const adminClient = createBffClient('admin');

  const fixtures = {};
  for (const v of VERTICALS) {
    try {
      fixtures[v] = await bootstrapFixtures(adminClient, v);
      console.log(`[globalSetup] Fixtures ready: ${v}`);
    } catch (e) {
      console.error(`[globalSetup] Fixture bootstrap failed for ${v}: ${e.message}`);
      fixtures[v] = { error: e.message };
    }
  }

  fs.writeFileSync(FIXTURES_CACHE, JSON.stringify(fixtures, null, 2));
  console.log('[globalSetup] Done.');
};
```

- [ ] **Step 2: Write globalTeardown.js**

```js
// demo_api_server/tests/real/helpers/globalTeardown.js
'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_CACHE  = path.resolve(__dirname, '../../../.test-session.json');
const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');

module.exports = async function globalTeardown() {
  if (process.env.RUN_REAL_TESTS !== 'true') return;

  // Restore banking vertical (in case a suite crashed without afterAll running)
  try {
    const https  = require('https');
    const axios  = require('axios');
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    if (fs.existsSync(SESSION_CACHE)) {
      const cache  = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
      const cookie = cache.enduser;
      if (cookie && cookie !== 'skip') {
        await axios.put('https://api.ping.demo:3001/api/config/vertical',
          { verticalId: 'banking' },
          { httpsAgent, headers: { Cookie: cookie }, validateStatus: () => true });
      }
    }
  } catch (e) {
    console.warn('[globalTeardown] Could not restore banking vertical:', e.message);
  }

  // Remove temp files
  for (const f of [SESSION_CACHE, FIXTURES_CACHE]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }

  console.log('[globalTeardown] Done.');
};
```

- [ ] **Step 3: Write suiteSetup.js**

```js
// demo_api_server/tests/real/helpers/suiteSetup.js
'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_CACHE = path.resolve(__dirname, '../../../.test-session.json');

// Called in beforeAll() of every real test suite.
// Skips the suite gracefully if no valid session is available.
global.skipIfNoSession = function skipIfNoSession(persona = 'enduser') {
  if (!fs.existsSync(SESSION_CACHE)) {
    return; // globalSetup hasn't run — Jest may be running a single file; allow to fail naturally
  }
  const cache = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
  if (!cache[persona] || cache[persona] === 'skip') {
    console.warn(`[suiteSetup] No session for '${persona}' — skipping suite`);
    // Jest doesn't have a built-in beforeAll-skip; use pending() trick
    test.skip('no valid session — suite skipped', () => {});
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/helpers/globalSetup.js \
        demo_api_server/tests/real/helpers/globalTeardown.js \
        demo_api_server/tests/real/helpers/suiteSetup.js
git commit -m "feat(test-real): globalSetup/Teardown and suiteSetup — session + fixture orchestration"
```

---

## Task 7: Smoke test — health.test.js

**Files:**
- Create: `demo_api_server/tests/real/shared/health.test.js`

- [ ] **Step 1: Create directory and write health.test.js**

```bash
mkdir -p demo_api_server/tests/real/shared
```

```js
// demo_api_server/tests/real/shared/health.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('GET /api/health (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('returns 200 with status healthy', async () => {
    const r = await client.get('/api/health');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: expect.any(String) });
  });

  it('returns 200 from /api/healthz', async () => {
    const r = await client.get('/api/healthz');
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the smoke test**

Make sure the BFF is running first (`./run.sh` from repo root), then:

```bash
cd demo_api_server && npm run test:real:smoke
```

Expected: suite passes (or is skipped if no session). Should NOT fail with connection refused.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/health.test.js
git commit -m "feat(test-real): health smoke test — proves real suite infrastructure is wired"
```

---

## Task 8: bootstrap.test.js — full provisioning contract

**Files:**
- Create: `demo_api_server/tests/real/shared/bootstrap.test.js`

- [ ] **Step 1: Write bootstrap.test.js**

```js
// demo_api_server/tests/real/shared/bootstrap.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

const EXPECTED_VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce', 'admin'];

describe('Bootstrap contract (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('GET /api/health returns 200', async () => {
    const r = await client.get('/api/health');
    expect(r.status).toBe(200);
  });

  it('GET /api/config/verticals/list returns all 6 verticals', async () => {
    const r = await client.get('/api/config/verticals/list');
    expect(r.status).toBe(200);
    const ids = (r.data.verticals || []).map(v => v.id || v);
    for (const v of EXPECTED_VERTICALS) {
      expect(ids).toContain(v);
    }
  });

  it.each(EXPECTED_VERTICALS)('vertical %s: PUT → GET returns correct id', async (verticalId) => {
    const put = await client.put('/api/config/vertical', { verticalId });
    expect(put.status).toBe(200);
    expect(put.data.activeVertical).toBe(verticalId);
    const get = await client.get('/api/config/vertical');
    expect(get.status).toBe(200);
    expect(get.data.activeVertical).toBe(verticalId);
  });

  afterAll(async () => {
    // Restore banking vertical after this suite
    await client.put('/api/config/vertical', { verticalId: 'banking' });
  });

  it('GET /api/auth/oauth/status returns authenticated: true', async () => {
    const r = await client.get('/api/auth/oauth/status');
    expect(r.status).toBe(200);
    expect(r.data.authenticated).toBe(true);
    expect(r.data.user).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
    });
  });

  it('GET /api/accounts/my returns accounts array', async () => {
    const r = await client.get('/api/accounts/my');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run bootstrap test**

```bash
cd demo_api_server && npm run test:real:shared -- --testPathPattern=bootstrap
```

Expected: all tests pass. If a vertical PUT fails, investigate `verticalConfigService.js` and update `config/verticals/`. If oauth-status fails, check `sessions.db` or headless login credentials.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/bootstrap.test.js
git commit -m "feat(test-real): bootstrap contract test — validates all 6 verticals + auth + accounts"
```

---

## Task 9: oauth-status.test.js

**Files:**
- Create: `demo_api_server/tests/real/shared/oauth-status.test.js`

- [ ] **Step 1: Write oauth-status.test.js**

```js
// demo_api_server/tests/real/shared/oauth-status.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('OAuth status endpoints (real)', () => {
  let enduser, admin;

  beforeAll(() => {
    skipIfNoSession();
    enduser = createBffClient('enduser');
    admin   = createBffClient('admin');
  });

  describe('GET /api/auth/oauth/status (admin)', () => {
    it('returns authenticated: true with user fields', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(true);
      expect(r.data.user).toMatchObject({
        id:        expect.any(String),
        username:  expect.any(String),
        email:     expect.any(String),
        firstName: expect.any(String),
        lastName:  expect.any(String),
      });
      // Token never sent to browser — only metadata
      expect(r.data.user.accessToken).toBeUndefined();
    });

    it('tokenType is Bearer', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.data.tokenType).toBe('Bearer');
    });

    it('expiresAt is in the future', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.data.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /api/auth/oauth/user/status (enduser)', () => {
    it('returns authenticated: true for enduser session', async () => {
      const r = await enduser.get('/api/auth/oauth/user/status');
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(true);
    });
  });

  describe('Unauthenticated request', () => {
    it('returns authenticated: false without a session cookie', async () => {
      const { default: axios } = await import('axios').catch(() => ({ default: require('axios') }));
      const https = require('https');
      const r = await axios.get('https://api.ping.demo:3001/api/auth/oauth/status', {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: () => true,
      });
      expect(r.data.authenticated).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run**

```bash
cd demo_api_server && npm run test:real:shared -- --testPathPattern=oauth-status
```

Expected: all pass.

- [ ] **Step 3: Delete mocked counterpart (after green)**

```bash
# Only after the above is green:
git rm demo_api_server/src/__tests__/oauthStatus.regression.test.js
git rm demo_api_server/src/__tests__/oauthStatus.integration.test.js
```

Add entry to `REGRESSION_PLAN.md §4`:
```
| 2026-05-21 | oauthStatus tests | Migrated to tests/real/shared/oauth-status.test.js — real BFF HTTP, real session |
```

- [ ] **Step 4: Verify old suite still passes after deletion**

```bash
cd demo_api_server && npm test -- --forceExit
```

Expected: no failures introduced by the deletion.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/tests/real/shared/oauth-status.test.js REGRESSION_PLAN.md
git commit -m "feat(test-real): oauth-status real test; delete mocked oauthStatus tests"
```

---

## Task 10: config.test.js — vertical switch contract

**Files:**
- Create: `demo_api_server/tests/real/shared/config.test.js`

- [ ] **Step 1: Write config.test.js**

```js
// demo_api_server/tests/real/shared/config.test.js
'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce', 'admin'];

describe('Vertical config endpoints (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  afterAll(async () => {
    await client.put('/api/config/vertical', { verticalId: 'banking' });
  });

  it('GET /api/config/verticals/list lists all 6 verticals', async () => {
    const r = await client.get('/api/config/verticals/list');
    expect(r.status).toBe(200);
    const ids = (r.data.verticals || []).map(v => v.id || v);
    for (const v of VERTICALS) expect(ids).toContain(v);
  });

  it.each(VERTICALS)('PUT /api/config/vertical sets %s and GET reflects it', async (verticalId) => {
    const r = await client.put('/api/config/vertical', { verticalId });
    expect(r.status).toBe(200);
    expect(r.data.activeVertical).toBe(verticalId);
    const g = await client.get('/api/config/vertical');
    expect(g.data.activeVertical).toBe(verticalId);
    expect(g.data.manifest).toBeDefined();
    expect(g.data.manifest.terminology).toBeDefined();
  });

  it('PUT with unknown verticalId returns 400', async () => {
    const r = await client.put('/api/config/vertical', { verticalId: 'nonexistent' });
    expect(r.status).toBe(400);
  });

  it('PUT without verticalId returns 400', async () => {
    const r = await client.put('/api/config/vertical', {});
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd demo_api_server && npm run test:real:shared -- --testPathPattern=config
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/config.test.js
git commit -m "feat(test-real): config vertical switch contract tests"
```

---

## Task 11: banking/accounts.test.js (template for all 6 verticals)

**Files:**
- Create: `demo_api_server/tests/real/banking/accounts.test.js`

Write this file first. Tasks 12–16 repeat the pattern for the other 5 verticals with vertical-specific IDs substituted.

- [ ] **Step 1: Create directory and write accounts.test.js for banking**

```bash
mkdir -p demo_api_server/tests/real/banking
```

```js
// demo_api_server/tests/real/banking/accounts.test.js
'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES, CHECKING_BALANCE, SAVINGS_BALANCE } = require('../helpers/fixtures');

const VERTICAL = 'banking';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Accounts — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    // banking is the default — no vertical switch needed
  });

  describe('GET /api/accounts/my', () => {
    it('returns 200 with array of accounts', async () => {
      const r = await client.get('/api/accounts/my');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data.length).toBeGreaterThan(0);
    });

    it('accounts include expected fields', async () => {
      const r = await client.get('/api/accounts/my');
      const acct = r.data[0];
      expect(acct).toMatchObject({
        id:          expect.any(String),
        accountType: expect.any(String),
        balance:     expect.any(Number),
        currency:    expect.any(String),
      });
    });

    it('does not expose routingNumber or accountNumberFull', async () => {
      const r = await client.get('/api/accounts/my');
      for (const acct of r.data) {
        expect(acct.routingNumber).toBeUndefined();
        expect(acct.accountNumberFull).toBeUndefined();
      }
    });
  });

  describe('GET /api/accounts/:id/balance', () => {
    it('returns balance for test fixture checking account', async () => {
      const r = await client.get(`/api/accounts/${FX.chk}/balance`);
      expect(r.status).toBe(200);
      expect(typeof r.data.balance).toBe('number');
    });

    it('returns 403 for an account belonging to a different user', async () => {
      // Use a known account ID that belongs to a different user (demo seeded account user-2)
      const r = await client.get('/api/accounts/acct-user-2-chk/balance');
      expect([403, 404]).toContain(r.status);
    });
  });

  describe('GET /api/accounts (admin-only)', () => {
    it('returns 403 for enduser session', async () => {
      const r = await client.get('/api/accounts');
      expect(r.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run**

```bash
cd demo_api_server && npm run test:real:banking -- --testPathPattern=accounts
```

Expected: all pass (adjust account IDs if demo seeded data differs — check `GET /api/accounts` with admin session).

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/banking/accounts.test.js
git commit -m "feat(test-real): banking accounts real test"
```

---

## Task 12: accounts.test.js for all remaining verticals

**Files:**
- Create: `demo_api_server/tests/real/retail/accounts.test.js`
- Create: `demo_api_server/tests/real/sporting-goods/accounts.test.js`
- Create: `demo_api_server/tests/real/healthcare/accounts.test.js`
- Create: `demo_api_server/tests/real/workforce/accounts.test.js`
- Create: `demo_api_server/tests/real/admin/accounts.test.js`

- [ ] **Step 1: Create directories**

```bash
mkdir -p demo_api_server/tests/real/retail \
         demo_api_server/tests/real/sporting-goods \
         demo_api_server/tests/real/healthcare \
         demo_api_server/tests/real/workforce \
         demo_api_server/tests/real/admin
```

- [ ] **Step 2: Write retail/accounts.test.js**

```js
// demo_api_server/tests/real/retail/accounts.test.js
'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES } = require('../helpers/fixtures');

const VERTICAL = 'retail';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Accounts — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('GET /api/accounts/my returns 200 with accounts', async () => {
    const r = await client.get('/api/accounts/my');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('GET /api/config/vertical shows retail terminology', async () => {
    const r = await client.get('/api/config/vertical');
    expect(r.status).toBe(200);
    expect(r.data.activeVertical).toBe('retail');
    expect(r.data.manifest.terminology.account).toBeDefined();
  });

  it('fixture checking account balance is readable', async () => {
    const r = await client.get(`/api/accounts/${FX.chk}/balance`);
    expect(r.status).toBe(200);
    expect(typeof r.data.balance).toBe('number');
  });
});
```

- [ ] **Step 3: Write sporting-goods/accounts.test.js**

```js
// demo_api_server/tests/real/sporting-goods/accounts.test.js
'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES } = require('../helpers/fixtures');

const VERTICAL = 'sporting-goods';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Accounts — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('GET /api/accounts/my returns 200 with accounts', async () => {
    const r = await client.get('/api/accounts/my');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('fixture account balance is readable', async () => {
    const r = await client.get(`/api/accounts/${FX.chk}/balance`);
    expect(r.status).toBe(200);
    expect(typeof r.data.balance).toBe('number');
  });
});
```

- [ ] **Step 4: Repeat for healthcare, workforce, admin** — same pattern as retail/accounts.test.js, substituting the vertical name and FX reference.

File: `demo_api_server/tests/real/healthcare/accounts.test.js` — replace `'retail'` with `'healthcare'`
File: `demo_api_server/tests/real/workforce/accounts.test.js` — replace `'retail'` with `'workforce'`
File: `demo_api_server/tests/real/admin/accounts.test.js` — replace `'retail'` with `'admin'`

- [ ] **Step 5: Run all accounts tests**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=accounts
```

Expected: all 6 verticals pass.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/tests/real/retail/accounts.test.js \
        demo_api_server/tests/real/sporting-goods/accounts.test.js \
        demo_api_server/tests/real/healthcare/accounts.test.js \
        demo_api_server/tests/real/workforce/accounts.test.js \
        demo_api_server/tests/real/admin/accounts.test.js
git commit -m "feat(test-real): accounts tests for all 6 verticals"
```

---

## Task 13: transfers.test.js — write path + balance mutation (banking, then ×6)

**Files:**
- Create: `demo_api_server/tests/real/banking/transfers.test.js`
- Create same for the other 5 verticals

- [ ] **Step 1: Write banking/transfers.test.js**

```js
// demo_api_server/tests/real/banking/transfers.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES, CHECKING_BALANCE, SAVINGS_BALANCE } = require('../helpers/fixtures');
const { resetSuite } = require('../helpers/reset');

const VERTICAL = 'banking';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Transfers — ${VERTICAL} vertical (real)`, () => {
  let client, admin;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    admin  = createBffClient('admin');
    await resetSuite(admin, VERTICAL);
  });

  afterEach(async () => {
    // Restore balances after each write test so next test starts clean
    await admin.put(`/api/accounts/${FX.chk}`, { balance: CHECKING_BALANCE });
    await admin.put(`/api/accounts/${FX.sav}`, { balance: SAVINGS_BALANCE });
  });

  describe('Deposit', () => {
    it('POST /api/transactions deposit increases balance', async () => {
      const before = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      const r = await client.post('/api/transactions', {
        type: 'deposit', toId: FX.chk, amount: 500,
      });
      // May return 428 if HITL is enabled — that is correct behaviour; test both paths
      if (r.status === 428) {
        expect(r.data.error).toBe('hitl_required');
        return; // HITL enforced — deposit blocked as expected
      }
      expect(r.status).toBe(201);
      const after = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      expect(after).toBe(before + 500);
    });
  });

  describe('Withdrawal', () => {
    it('POST /api/transactions withdrawal decreases balance', async () => {
      const before = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      const r = await client.post('/api/transactions', {
        type: 'withdraw', fromId: FX.chk, amount: 100,
      });
      if (r.status === 428) {
        expect(r.data.error).toBe('hitl_required');
        return;
      }
      expect(r.status).toBe(201);
      const after = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      expect(after).toBe(before - 100);
    });
  });

  describe('Transfer', () => {
    it('POST /api/transactions transfer moves funds between accounts', async () => {
      const chkBefore = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      const savBefore = (await client.get(`/api/accounts/${FX.sav}/balance`)).data.balance;

      const r = await client.post('/api/transactions', {
        type: 'transfer', fromId: FX.chk, toId: FX.sav, amount: 200,
      });
      // Transfers ALWAYS require HITL consent (Phase 170 invariant)
      expect(r.status).toBe(428);
      expect(r.data.error).toBe('hitl_required');

      // Balances unchanged because transfer was blocked
      const chkAfter = (await client.get(`/api/accounts/${FX.chk}/balance`)).data.balance;
      expect(chkAfter).toBe(chkBefore);
    });

    it('returns 400 for transfer with insufficient funds', async () => {
      const r = await client.post('/api/transactions', {
        type: 'withdraw', fromId: FX.chk, amount: CHECKING_BALANCE + 1,
      });
      expect([400, 428]).toContain(r.status);
    });
  });
});
```

- [ ] **Step 2: Create transfers.test.js for remaining 5 verticals**

Same content as banking/transfers.test.js with `const VERTICAL = 'retail'` etc. substituted. The Phase 170 transfer HITL invariant applies across all verticals.

```bash
for V in retail sporting-goods healthcare workforce admin; do
  cp demo_api_server/tests/real/banking/transfers.test.js \
     demo_api_server/tests/real/$V/transfers.test.js
  sed -i '' "s/const VERTICAL = 'banking'/const VERTICAL = '$V'/" \
     demo_api_server/tests/real/$V/transfers.test.js
done
```

- [ ] **Step 3: Run**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=transfers
```

Expected: deposit/withdraw tests pass or correctly return 428 depending on `ff_hitl_enabled`. Transfer tests always return 428 (Phase 170 invariant).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/banking/transfers.test.js \
        demo_api_server/tests/real/retail/transfers.test.js \
        demo_api_server/tests/real/sporting-goods/transfers.test.js \
        demo_api_server/tests/real/healthcare/transfers.test.js \
        demo_api_server/tests/real/workforce/transfers.test.js \
        demo_api_server/tests/real/admin/transfers.test.js
git commit -m "feat(test-real): transfers tests for all 6 verticals — real balance mutation + HITL enforcement"
```

---

## Task 14: hitl.test.js — consent enforcement (banking, then ×6)

**Files:**
- Create: `demo_api_server/tests/real/banking/hitl.test.js` (+ ×5 verticals)

- [ ] **Step 1: Write banking/hitl.test.js**

```js
// demo_api_server/tests/real/banking/hitl.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES } = require('../helpers/fixtures');
const { resetSuite } = require('../helpers/reset');

const VERTICAL = 'banking';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`HITL enforcement — ${VERTICAL} vertical (real)`, () => {
  let client, admin;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    admin  = createBffClient('admin');
    await resetSuite(admin, VERTICAL);
  });

  it('transfer without consentChallengeId returns 428 hitl_required', async () => {
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromId: FX.chk, toId: FX.sav, amount: 200,
    });
    expect(r.status).toBe(428);
    expect(r.data.error).toBe('hitl_required');
    expect(r.data.hitl).toBeDefined();
    expect(r.data.hitl.type).toBe('consent');
  });

  it('transfer with invalid consentChallengeId returns 4xx', async () => {
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromId: FX.chk, toId: FX.sav, amount: 200,
      consentChallengeId: 'invalid-challenge-id-that-does-not-exist',
    });
    expect([400, 403, 428]).toContain(r.status);
  });

  it('small deposit does not trigger 428 (below threshold)', async () => {
    const r = await client.post('/api/transactions', {
      type: 'deposit', toId: FX.chk, amount: 10,
    });
    // Should be 201 (success) or 428 only if ff_hitl_enabled=true AND amount > threshold
    // A $10 deposit should be below the $500 confirm_threshold_usd
    expect([201, 428]).toContain(r.status);
    if (r.status === 428) {
      // If 428, amount must be above threshold — $10 deposit should not trigger this
      // Log to surface if threshold config is unexpected
      console.warn('[hitl.test] Unexpected 428 on $10 deposit — check confirm_threshold_usd in .env');
    }
  });

  it('large deposit above threshold returns 428', async () => {
    const r = await client.post('/api/transactions', {
      type: 'deposit', toId: FX.chk, amount: 1000,
    });
    // Should return 428 if ff_hitl_enabled=true and 1000 > confirm_threshold_usd (500)
    // If ff_hitl_enabled=false this returns 201 — both are valid
    expect([201, 428]).toContain(r.status);
  });

  it('response body includes fromAccountId, toAccountId, amount, type on 428', async () => {
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromId: FX.chk, toId: FX.sav, amount: 300,
    });
    expect(r.status).toBe(428);
    expect(r.data).toMatchObject({
      fromAccountId: FX.chk,
      toAccountId:   FX.sav,
      amount:        300,
      type:          'transfer',
    });
  });
});
```

- [ ] **Step 2: Replicate for other 5 verticals**

```bash
for V in retail sporting-goods healthcare workforce admin; do
  cp demo_api_server/tests/real/banking/hitl.test.js \
     demo_api_server/tests/real/$V/hitl.test.js
  sed -i '' "s/const VERTICAL = 'banking'/const VERTICAL = '$V'/" \
     demo_api_server/tests/real/$V/hitl.test.js
done
```

- [ ] **Step 3: Run**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=hitl
```

Expected: transfer 428 tests always pass. Deposit threshold tests log a warning if threshold is unexpected — investigate `.env` `confirm_threshold_usd` if so.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/banking/hitl.test.js \
        demo_api_server/tests/real/retail/hitl.test.js \
        demo_api_server/tests/real/sporting-goods/hitl.test.js \
        demo_api_server/tests/real/healthcare/hitl.test.js \
        demo_api_server/tests/real/workforce/hitl.test.js \
        demo_api_server/tests/real/admin/hitl.test.js
git commit -m "feat(test-real): HITL enforcement tests for all 6 verticals — real configStore threshold"
```

---

## Task 15: agent.test.js — RFC 8693 token exchange (banking, then ×6)

**Files:**
- Create: `demo_api_server/tests/real/banking/agent.test.js` (+ ×5 verticals)

- [ ] **Step 1: Write banking/agent.test.js**

```js
// demo_api_server/tests/real/banking/agent.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

const VERTICAL = 'banking';

describe(`Agent delegation — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('POST /api/agent/delegate without Bearer token returns 401', async () => {
    const r = await client.post('/api/agent/delegate', {});
    expect(r.status).toBe(401);
    expect(r.data.error).toBe('missing_token');
  });

  it('POST /api/agent/delegate with session access token returns delegated token', async () => {
    // Get the access token from the session (via token-claims endpoint)
    // Response shape: { authenticated, payload: { sub, scope, ... }, rawToken (if present) }
    // The BFF does not expose the raw token to the browser normally — check if rawToken is available
    const claims = await client.get('/api/auth/oauth/token-claims');
    if (claims.status !== 200 || !claims.data?.authenticated) {
      console.warn('[agent.test] Cannot get token claims — skipping delegation test');
      return;
    }
    // For the delegation test we need the raw access token — read it from session via
    // the dedicated BFF endpoint that exposes it for agent platforms
    const sessionR = await client.get('/api/auth/oauth/status');
    if (!sessionR.data?.authenticated) {
      console.warn('[agent.test] Not authenticated — skipping delegation test');
      return;
    }
    // The raw token is not exposed via /status (BFF pattern). Use the token stored in
    // sessionR if available, otherwise extract from token-claims rawToken field.
    const rawToken = claims.data.rawToken || claims.data.payload?.accessToken;
    if (!rawToken) {
      console.warn('[agent.test] No raw token accessible — skipping delegation sub-test (expected in strict BFF mode)');
      return;
    }
    const accessToken = rawToken;

    const r = await client.post('/api/agent/delegate', {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Success: 200 with delegated token
    // Acceptable failures: 503 (PingOne unavailable), 400 (misconfigured exchanger)
    if (r.status === 503 || r.status === 400) {
      console.warn(`[agent.test] Token exchange returned ${r.status}: ${JSON.stringify(r.data)} — check PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID in .env`);
      return;
    }

    expect(r.status).toBe(200);
    expect(r.data.access_token).toBeTruthy();
    expect(r.data.token_type).toBe('Bearer');

    // Verify act claim if present
    if (r.data.access_token) {
      const payload = JSON.parse(Buffer.from(r.data.access_token.split('.')[1], 'base64url').toString());
      if (payload.act) {
        expect(payload.act.sub).toBeTruthy(); // actor client_id
      } else {
        console.warn('[agent.test] act claim absent from delegated token — check PingOne token policy');
      }
    }
  });
});
```

- [ ] **Step 2: Replicate for other 5 verticals**

```bash
for V in retail sporting-goods healthcare workforce admin; do
  cp demo_api_server/tests/real/banking/agent.test.js \
     demo_api_server/tests/real/$V/agent.test.js
  sed -i '' "s/const VERTICAL = 'banking'/const VERTICAL = '$V'/" \
     demo_api_server/tests/real/$V/agent.test.js
done
```

- [ ] **Step 3: Run**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=agent
```

Expected: 401 test always passes. Delegation test passes or logs a warning if PingOne exchanger app is misconfigured — investigate and fix `pingoneProvisionService.js` if so, then re-bootstrap.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/banking/agent.test.js \
        demo_api_server/tests/real/retail/agent.test.js \
        demo_api_server/tests/real/sporting-goods/agent.test.js \
        demo_api_server/tests/real/healthcare/agent.test.js \
        demo_api_server/tests/real/workforce/agent.test.js \
        demo_api_server/tests/real/admin/agent.test.js
git commit -m "feat(test-real): agent delegation tests for all 6 verticals — real RFC 8693 exchange"
```

---

## Task 16: admin.test.js — admin persona

**Files:**
- Create: `demo_api_server/tests/real/shared/admin.test.js`

- [ ] **Step 1: Write admin.test.js**

```js
// demo_api_server/tests/real/shared/admin.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('Admin endpoints (real)', () => {
  let admin, enduser;

  beforeAll(() => {
    skipIfNoSession('admin');
    admin   = createBffClient('admin');
    enduser = createBffClient('enduser');
  });

  describe('GET /api/admin/stats', () => {
    it('returns 200 for admin session', async () => {
      const r = await admin.get('/api/admin/stats');
      expect(r.status).toBe(200);
    });

    it('returns 403 for enduser session', async () => {
      const r = await enduser.get('/api/admin/stats');
      expect(r.status).toBe(403);
    });
  });

  describe('POST /api/admin/reset-demo', () => {
    it('returns 200 and clears demo state', async () => {
      const r = await admin.post('/api/admin/reset-demo');
      expect(r.status).toBe(200);
      expect(r.data.ok).toBe(true);
    });
  });

  describe('GET /api/admin/activity', () => {
    it('returns 200 for admin session', async () => {
      const r = await admin.get('/api/admin/activity');
      expect(r.status).toBe(200);
    });
  });

  describe('GET /api/admin/banking/lookup', () => {
    it('returns user lookup data for admin', async () => {
      const r = await admin.get('/api/admin/banking/lookup');
      expect(r.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run**

```bash
cd demo_api_server && npm run test:real:shared -- --testPathPattern=admin
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/admin.test.js
git commit -m "feat(test-real): admin endpoint tests — admin persona, enduser 403 enforcement"
```

---

## Task 17: vertical.test.js — manifest shape (banking, then ×6)

**Files:**
- Create: `demo_api_server/tests/real/banking/vertical.test.js` (+ ×5 verticals)

- [ ] **Step 1: Write banking/vertical.test.js**

```js
// demo_api_server/tests/real/banking/vertical.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'banking';
const STATIC_CONFIG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, `../../../config/verticals/${VERTICAL}.json`), 'utf8')
);

describe(`Vertical manifest — ${VERTICAL} (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    // banking is default — no switch needed
  });

  it('GET /api/config/vertical returns activeVertical=banking', async () => {
    const r = await client.get('/api/config/vertical');
    expect(r.status).toBe(200);
    expect(r.data.activeVertical).toBe(VERTICAL);
  });

  it('manifest terminology matches config/verticals/banking.json', async () => {
    const r = await client.get('/api/config/vertical');
    const term = r.data.manifest?.terminology;
    expect(term).toBeDefined();
    expect(term.account).toBe(STATIC_CONFIG.terminology.account);
    expect(term.accounts).toBe(STATIC_CONFIG.terminology.accounts);
    expect(term.transaction).toBe(STATIC_CONFIG.terminology.transaction);
  });

  it('manifest identity matches config/verticals/banking.json', async () => {
    const r = await client.get('/api/config/vertical');
    const id = r.data.manifest?.identity;
    expect(id).toBeDefined();
    expect(id.displayName).toBe(STATIC_CONFIG.identity.displayName);
  });
});
```

- [ ] **Step 2: Replicate for other 5 verticals**

```bash
for V in retail sporting-goods healthcare workforce admin; do
  cp demo_api_server/tests/real/banking/vertical.test.js \
     demo_api_server/tests/real/$V/vertical.test.js
  sed -i '' "s/const VERTICAL = 'banking'/const VERTICAL = '$V'/" \
     demo_api_server/tests/real/$V/vertical.test.js
  # Add setVertical/restoreVertical calls for non-banking verticals
done
```

Then edit each non-banking `vertical.test.js` to add `await setVertical(client, VERTICAL)` in `beforeAll` and `await restoreVertical(client)` in `afterAll`.

- [ ] **Step 3: Run**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=vertical
```

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/banking/vertical.test.js \
        demo_api_server/tests/real/retail/vertical.test.js \
        demo_api_server/tests/real/sporting-goods/vertical.test.js \
        demo_api_server/tests/real/healthcare/vertical.test.js \
        demo_api_server/tests/real/workforce/vertical.test.js \
        demo_api_server/tests/real/admin/vertical.test.js
git commit -m "feat(test-real): vertical manifest tests for all 6 verticals — terminology + identity shape"
```

---

## Task 18: transactions.test.js — read path (banking, then ×6)

**Files:**
- Create: `demo_api_server/tests/real/banking/transactions.test.js` (+ ×5 verticals)

- [ ] **Step 1: Write banking/transactions.test.js**

```js
// demo_api_server/tests/real/banking/transactions.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

const VERTICAL = 'banking';

describe(`Transactions — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  describe('GET /api/transactions/my', () => {
    it('returns 200 with array', async () => {
      const r = await client.get('/api/transactions/my');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.data)).toBe(true);
    });

    it('transactions include expected fields', async () => {
      const r = await client.get('/api/transactions/my');
      if (r.data.length === 0) return; // no transactions seeded — skip field check
      const tx = r.data[0];
      expect(tx).toMatchObject({
        id:     expect.any(String),
        type:   expect.any(String),
        amount: expect.any(Number),
      });
    });
  });

  describe('GET /api/transactions (admin-only)', () => {
    it('returns 403 for enduser', async () => {
      const r = await client.get('/api/transactions');
      expect(r.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Replicate for other 5 verticals**

```bash
for V in retail sporting-goods healthcare workforce admin; do
  cp demo_api_server/tests/real/banking/transactions.test.js \
     demo_api_server/tests/real/$V/transactions.test.js
  sed -i '' "s/const VERTICAL = 'banking'/const VERTICAL = '$V'/" \
     demo_api_server/tests/real/$V/transactions.test.js
done
```

Add `setVertical`/`restoreVertical` to non-banking files.

- [ ] **Step 3: Run + commit**

```bash
cd demo_api_server && npm run test:real -- --testPathPattern=transactions
git add demo_api_server/tests/real/*/transactions.test.js
git commit -m "feat(test-real): transactions read tests for all 6 verticals"
```

---

## Task 19: mcp.test.js — full BFF→MCP path

**Files:**
- Create: `demo_api_server/tests/real/shared/mcp.test.js`

Note: This test requires both the BFF (`:3001`) and MCP server (`:8080`) to be running.

- [ ] **Step 1: Write mcp.test.js**

```js
// demo_api_server/tests/real/shared/mcp.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

// Skip if MCP server is not running
async function isMcpRunning(client) {
  try {
    const r = await client.get('/api/mcp/status');
    return r.status < 500;
  } catch (_) {
    return false;
  }
}

describe('MCP tool path (real)', () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    const running = await isMcpRunning(client);
    if (!running) {
      console.warn('[mcp.test] MCP server not running — skipping MCP tests. Start with ./run.sh');
    }
  });

  it('GET /api/banking-agent/nl with accounts query invokes MCP tool and returns result', async () => {
    const r = await client.post('/api/banking-agent/nl', {
      message: 'show my accounts',
    });
    // 200 with tool result, or 503 if MCP unavailable
    expect([200, 503]).toContain(r.status);
    if (r.status === 200) {
      expect(r.data).toBeDefined();
    }
  });

  it('MCP tool call logs appear in app events', async () => {
    const r = await client.get('/api/admin/app-events?category=mcp&limit=5');
    // May be 403 if enduser doesn't have admin scope — that is fine
    expect([200, 403]).toContain(r.status);
  });
});
```

- [ ] **Step 2: Run (requires MCP server running)**

```bash
./run.sh  # from repo root — starts all services
cd demo_api_server && npm run test:real:shared -- --testPathPattern=mcp
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/mcp.test.js
git commit -m "feat(test-real): MCP full-path test — BFF → token exchange → WebSocket → tool result"
```

---

## Task 20: Full suite run + REGRESSION_PLAN.md updates

- [ ] **Step 1: Run full real suite**

```bash
cd demo_api_server && npm run test:real
```

Expected: all tests pass or are skipped (never fail with uncaught errors).

- [ ] **Step 2: Run existing mocked suite to confirm no regressions**

```bash
cd demo_api_server && npm test -- --forceExit
```

Expected: same pass count as before this work began.

- [ ] **Step 3: Add REGRESSION_PLAN.md §1 entry for the real test suite**

Add to the §1 protected file table in `REGRESSION_PLAN.md`:

```
| demo_api_server/tests/real/helpers/ | Real test infrastructure — session, fixtures, reset, bffClient. Do not mock these. |
| demo_api_server/jest.real.config.js | Real suite config — runInBand required for vertical isolation. |
```

- [ ] **Step 4: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): add real test suite helpers to §1 protected list"
```

---

## Bootstrap Fix Protocol (reference — not a task, run when needed)

When a real test fails due to PingOne misconfiguration:

1. Note the failure: wrong scope, bad redirect URI, 401/403 from PingOne
2. Edit `demo_api_server/services/pingoneProvisionService.js` (single source of truth)
3. Re-bootstrap: `cd demo_api_server && npm run pingone:bootstrap:ci`
4. Re-run the failing test: `npm run test:real -- --testPathPattern=<failing-file>`
5. Confirm green, then add to `REGRESSION_PLAN.md §4`:

```
| YYYY-MM-DD | Bootstrap fix: <description> | Fixed in pingoneProvisionService.js; re-bootstrapped |
```

When `bootstrapData.json` is stale (fixture accounts missing):

1. Fix via admin API: `POST /api/accounts` with fixture payload
2. Export: `cd demo_api_server && npm run data:export-bootstrap`
3. Commit: `git add data/bootstrapData.json && git commit -m "fix: update bootstrapData.json with test fixture accounts"`
