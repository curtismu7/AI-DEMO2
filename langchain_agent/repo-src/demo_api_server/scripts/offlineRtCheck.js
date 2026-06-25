#!/usr/bin/env node
'use strict';

/**
 * offlineRtCheck.js — SESSION_REPLAN Phase 0 probe.
 *
 * IMPORTANT — what this actually tests: it terminates the user's SSO session by DELETING it
 * via the Management API. That is a FORCED sign-off (a full token revocation), which is the
 * Phase 3 RP-initiated-logout behaviour — NOT a natural idle/max SSO timeout. PingOne anchors
 * the Refresh Token Rolling Duration to "the most recent user authentication event", not to
 * the live session, so a natural timeout does NOT necessarily revoke an offline RT even though
 * a forced delete does. Use this script to verify LOGOUT revocation; it does NOT prove
 * timeout-survival (set a short SSO idle timeout and wait to test that).
 *
 *   PASS  -> refresh still works after forced session deletion.
 *   FAIL  -> forced session deletion revoked the RT. EXPECTED for logout. Does NOT by itself
 *            mean the RT dies on a natural timeout — see note above.
 *
 * Method (scientific, rotation-safe):
 *   1. CONTROL : refresh once with the supplied RT. Proves the RT is currently valid and
 *                yields a rotated RT2 (PingOne rotates on every use) + an access_token whose
 *                `sub` identifies the user. Abort if this fails (bad/stale input, not a result).
 *   2. TERMINATE: list + delete ALL of that user's PingOne SSO sessions (Management API).
 *   3. TEST    : refresh with RT2. Success => session-independent; invalid_grant => bound.
 *
 * Inputs (env or flags):
 *   REFRESH_TOKEN   (required)  a FRESH end-user refresh token (e.g. from a just-completed
 *                               browser login). Pass via env or --refresh-token=<...>.
 *   Reads PingOne env/client/worker creds from demo_api_server/.env automatically.
 *
 * Usage:
 *   REFRESH_TOKEN=... node demo_api_server/scripts/offlineRtCheck.js
 *   node demo_api_server/scripts/offlineRtCheck.js --refresh-token=...
 *
 * Read-only except for deleting the test user's SSO sessions (which is the whole point).
 * It does NOT print tokens or secrets.
 */

const fs = require('fs');
const path = require('path');

// ---- tiny .env loader (only the keys we need; does not override real env) ----
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function jwtSub(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function postForm(url, form, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

async function refresh(tokenEndpoint, clientId, clientSecret, refreshToken) {
  // Demo User App uses CLIENT_SECRET_POST — creds in the body.
  return postForm(tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

async function workerToken(tokenEndpoint, id, secret) {
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const { status, body } = await postForm(
    tokenEndpoint,
    { grant_type: 'client_credentials' },
    { Authorization: `Basic ${basic}` },
  );
  if (status !== 200 || !body.access_token) throw new Error(`worker token mint failed (HTTP ${status})`);
  return body.access_token;
}

async function deleteUserSessions(apiBase, envId, userId, mgmtToken) {
  const listUrl = `${apiBase}/v1/environments/${envId}/users/${userId}/sessions`;
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${mgmtToken}` } });
  if (!res.ok) throw new Error(`list sessions failed (HTTP ${res.status})`);
  const data = await res.json();
  const sessions = data?._embedded?.sessions || [];
  let deleted = 0;
  for (const s of sessions) {
    const del = await fetch(`${listUrl}/${s.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${mgmtToken}` },
    });
    if (del.ok) deleted += 1;
  }
  return { found: sessions.length, deleted };
}

async function main() {
  loadEnv();

  const refreshToken = process.env.REFRESH_TOKEN || arg('refresh-token');
  if (!refreshToken) {
    console.error('ERROR: provide a fresh end-user refresh token via REFRESH_TOKEN=... or --refresh-token=...');
    process.exit(2);
  }

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const clientId = process.env.PINGONE_USER_CLIENT_ID;
  const clientSecret = process.env.PINGONE_USER_CLIENT_SECRET;
  const workerId = process.env.PINGONE_WORKER_CLIENT_ID;
  const workerSecret = process.env.PINGONE_WORKER_CLIENT_SECRET;

  for (const [k, v] of Object.entries({ envId, clientId, clientSecret, workerId, workerSecret })) {
    if (!v) { console.error(`ERROR: missing required config: ${k}`); process.exit(2); }
  }

  const tokenEndpoint = `https://auth.pingone.${region}/${envId}/as/token`;
  const apiBase = `https://api.pingone.${region}`;

  console.log('=== offline-RT check (SESSION_REPLAN Phase 0) ===');
  console.log(`env=${envId} region=${region}`);

  // 1. CONTROL refresh
  console.log('\n[1] control refresh (proves RT valid, rotates to RT2, identifies user)...');
  const ctrl = await refresh(tokenEndpoint, clientId, clientSecret, refreshToken);
  if (ctrl.status !== 200 || !ctrl.body.refresh_token) {
    console.error(`    CONTROL FAILED (HTTP ${ctrl.status}, error=${ctrl.body.error || '?'}).`);
    console.error('    The supplied refresh token is not currently valid — get a fresh one. This is NOT a result.');
    process.exit(3);
  }
  const rt2 = ctrl.body.refresh_token;
  const userId = jwtSub(ctrl.body.access_token || '');
  console.log(`    OK. rotated to RT2. user sub=${userId || '(could not decode — opaque AT?)'}`);
  if (!userId) {
    console.error('    Cannot identify the user from the access token (opaque/encrypted) — cannot terminate sessions; aborting.');
    process.exit(3);
  }

  // 2. TERMINATE SSO sessions
  console.log('\n[2] terminating the user\'s PingOne SSO session(s)...');
  const mgmt = await workerToken(tokenEndpoint, workerId, workerSecret);
  const { found, deleted } = await deleteUserSessions(apiBase, envId, userId, mgmt);
  console.log(`    sessions found=${found} deleted=${deleted}`);
  if (found === 0) {
    console.warn('    WARNING: no active SSO sessions found to delete — the test may be inconclusive.');
    console.warn('    (Log in via the browser immediately before running, so a session exists.)');
  }

  // 3. TEST refresh after SSO termination
  console.log('\n[3] test refresh AFTER SSO termination (the decisive step)...');
  const test = await refresh(tokenEndpoint, clientId, clientSecret, rt2);

  console.log('\n=== VERDICT (forced session-deletion test — NOT a timeout test) ===');
  if (test.status === 200 && test.body.access_token) {
    console.log('PASS — refresh still works after forced session deletion.');
    process.exit(0);
  }
  console.log(`FAIL — forced session deletion revoked the RT (HTTP ${test.status}, error=${test.body.error || '?'}).`);
  console.log('       This is EXPECTED logout behaviour (good for Phase 3 RP-initiated logout).');
  console.log('       It does NOT prove the RT dies on a natural idle/max SSO timeout —');
  console.log('       PingOne anchors RT rolling to the auth event, not the live session.');
  console.log('       To test timeout-survival: set a short SSO idle timeout and wait.');
  process.exit(1);
}

main().catch((err) => {
  console.error('offlineRtCheck error:', err.message);
  process.exit(4);
});
