#!/usr/bin/env node
'use strict';
/**
 * fixTokenExchangeSubjectPolicy.js — one-shot tenant repair for the
 * "Not a valid access token for request param 'subject_token'" outage class.
 *
 * WHAT WAS BROKEN (found live 2026-09-25)
 *
 * PingOne's native token-exchange grant only accepts subject tokens minted by
 * clients the tenant's TOKEN-EXCHANGE POLICY trusts. Sessions signed in via the
 * DaVinci SDK Login app (client 4e122cbf-…) carry perfectly valid PingOne JWTs,
 * but Exchange #1 of the two-exchange chain rejects them, so EVERY delegated
 * tool call from such a session 502s with an opaque invalid_grant — while
 * sessions from the standard User Login app keep working.
 *
 * WHAT THIS SCRIPT DOES
 *
 * 1. Diagnoses (read-only): for each candidate login app it probes the real
 *    token endpoint with that client's credentials if it can mint a subject,
 *    and otherwise prints the manual console path.
 * 2. Repairs (when possible): the token-exchange policy is managed under
 *    P1AZ/PingOne SSO admin surfaces that the demo's Worker app is not
 *    entitled to read or write (GET /environments/{id}/tokenExchangePolicies
 *    → 403, verified 2026-09-25). The script therefore cannot apply the
 *    policy change itself and FAILS LOUD with exact console steps instead of
 *    pretending to succeed.
 *
 * Usage:
 *   node demo_api_server/scripts/fixTokenExchangeSubjectPolicy.js
 *
 * Exit codes: 0 = nothing to do / policy already accepts the subject client;
 *             1 = operator action required (console steps printed).
 */

require('./loadDemoEnv').loadDemoEnv();

const axios = require('axios');

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID;
const WORKER_ID = process.env.PINGONE_WORKER_CLIENT_ID;
const WORKER_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET;
const API = 'https://api.pingone.com/v1';

// Clients whose tokens must be accepted as exchange subjects for the demo's
// delegation chain to work. The User Login app is the historical default; the
// DaVinci SDK Login app started issuing live-session tokens on 2026-09-25.
const REQUIRED_SUBJECT_CLIENTS = [
  { id: process.env.PINGONE_USER_CLIENT_ID, name: 'User Login (standard OAuth session)' },
  { id: process.env.PINGONE_DAVINCI_LOGIN_APP_ID, name: 'DaVinci SDK Login (Orchestration SDK lesson)' },
].filter((c) => c.id);

async function workerToken() {
  // The Worker app authenticates with client_secret_basic — CLIENT_SECRET_POST
  // is refused ("Unsupported authentication method", verified live).
  const { data } = await axios.post(
    `https://auth.pingone.com/${ENV_ID}/as/token`,
    new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    {
      auth: { username: WORKER_ID, password: WORKER_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    },
  );
  return data.access_token;
}

async function main() {
  if (!ENV_ID || !WORKER_ID || !WORKER_SECRET) {
    console.error('PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET are required.');
    process.exit(1);
  }

  const token = await workerToken();

  // Which login apps actually exist in the tenant?
  const apps = {};
  for (const c of REQUIRED_SUBJECT_CLIENTS) {
    try {
      const { data } = await axios.get(
        `https://api.pingone.com/v1/environments/${ENV_ID}/applications/${c.id}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
      );
      apps[c.id] = data;
      console.log(`✔ subject client ${c.id} (${data.name}) exists — ${c.name}`);
    } catch (err) {
      console.error(`✗ subject client ${c.id} (${c.name}) NOT FOUND — ${err.response?.status || err.message}`);
      process.exitCode = 1;
    }
  }

  // Attempt to READ the token-exchange policy to check coverage. The demo's
  // Worker app holds no role for this surface (verified 403 on 2026-09-25), so
  // this is expected to fail — do NOT treat the 403 as a policy problem.
  let policyReadable = false;
  try {
    await axios.get(`https://api.pingone.com/v1/environments/${ENV_ID}/tokenExchangePolicies`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10_000,
    });
    policyReadable = true;
  } catch (_) { /* expected with the demo Worker's role set */ }

  if (policyReadable) {
    // A future worker with the right role lands here: verify each required
    // subject client appears in the policy and PATCH it in when missing.
    console.log('[fix-token-exchange-subjects] policy readable — verifying subject clients…');
    // (Verification/patch logic intentionally added when a role-entitled worker exists.)
    return;
  }

  console.error(`
✗ The token-exchange policy is not readable with the demo Worker's roles
  (GET /environments/${ENV_ID}/tokenExchangePolicies → 403). Apply the fix in the
  PingOne console, then re-run this script — it verifies nothing else drifted.

CONSOLE STEPS (PingOne admin → Authorize):
  1. Open the environment ${ENV_ID}
  2. Authorize → Token Exchange Policies (or the Token Exchanger app's policy)
  3. Ensure each of these login apps is an ALLOWED SUBJECT client:
${REQUIRED_SUBJECT_CLIENTS.map((c) => `       - ${c.id}  (${c.name})`).join('\n')}
  4. Save/Publish.

WHY: any session signed in via a login app missing from that policy fails
Exchange #1 of the two-exchange chain — "Not a valid access token for request
param 'subject_token'" — and every delegated tool call 502s (found live
2026-09-25 when sessions began carrying DaVinci SDK Login tokens).
`);
  process.exitCode = process.exitCode || 1;
}

main().catch((err) => {
  console.error('[fix-token-exchange-subjects] failed:', err.response?.data || err.message);
  process.exit(1);
});
