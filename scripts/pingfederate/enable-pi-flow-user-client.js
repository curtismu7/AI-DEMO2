#!/usr/bin/env node
// enable-pi-flow-user-client.js — let the BFF's PingFederate end-user client open pi.flow sign-ins.
//
// Why this exists: PF refuses `response_mode=pi.flow` unless BOTH
//   1. the server-wide Authentication API is on (/authenticationApi/settings.apiEnabled), and
//   2. the client has allowAuthenticationApiInit.
// Turning (2) on makes PF force restrictScopes=true. With an empty allowed list the NORMAL
// redirect login then fails `invalid_scope`, so this script also sets the allowed list to every
// scope PF defines (the restriction becomes a no-op) and PROVES the normal login still works.
//
// Defaults to a dry run. `--apply` changes PF; if any post-check fails it restores the
// pre-change client automatically. Never prints the admin password or the client secret.
//
// Usage:
//   node scripts/pingfederate/enable-pi-flow-user-client.js            # dry run: shows what would change
//   node scripts/pingfederate/enable-pi-flow-user-client.js --apply    # change PF, verify, revert on failure
//
// Env overrides: PF_ADMIN_BASE, PF_ENGINE, PF_USER_CLIENT_ID, PF_USER_REDIRECT_URI, PINGFEDERATE_ADMIN_PASSWORD.
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // local mkcert PF
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ADMIN = process.env.PF_ADMIN_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const ENGINE = process.env.PF_ENGINE || 'https://local.ping-devops.com:9031';
const CLIENT_ID = process.env.PF_USER_CLIENT_ID || 'ai-demo-pf-user';
const REDIRECT = process.env.PF_USER_REDIRECT_URI || 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback';
const BFF_LOGIN_SCOPE = 'openid profile email offline_access'; // what the BFF requests for PF sign-in
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
  const line = env.split('\n').find((l) => l.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error('No admin password: set PINGFEDERATE_ADMIN_PASSWORD or run PF in the ai-demo-pingfederate container.');
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

const headers = {
  Authorization: `Basic ${Buffer.from(`administrator:${adminPassword()}`).toString('base64')}`,
  'X-XSRF-Header': 'x',
  Accept: 'application/json',
};
const get = async (p) => { const r = await fetch(`${ADMIN}${p}`, { headers }); if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`); return r.json(); };
const put = (p, body) => fetch(`${ADMIN}${p}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// One authorize request; returns the facts the checks need.
async function authorize(scope, mode) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope,
    code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'check', ...(mode ? { response_mode: mode } : {}),
  });
  const r = await fetch(`${ENGINE}/as/authorization.oauth2?${q}`, { headers: { Accept: 'application/json' }, redirect: 'manual' });
  const loc = r.headers.get('location');
  const out = { http: r.status, error: loc ? new URL(loc).searchParams.get('error') : null, flowStatus: null };
  if (mode) { try { out.flowStatus = (await r.json()).status; } catch (_) { /* not json */ } }
  return out;
}

// bogus code -> invalid_grant means the client authenticated; invalid_client means its secret broke.
async function clientSecretStillWorks() {
  let secret = '';
  try { secret = execFileSync('docker', ['exec', 'ai-demo-api-server', 'printenv', 'PF_USER_CLIENT_SECRET']).toString().trim(); } catch (_) { /* not available */ }
  if (!secret) return 'unchecked';
  const r = await fetch(`${ENGINE}/as/token.oauth2`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: 'bogus', redirect_uri: REDIRECT, code_verifier: VERIFIER }),
  });
  return (await r.json().catch(() => ({}))).error === 'invalid_grant' ? 'ok' : 'FAILED';
}

(async () => {
  const api = await get('/authenticationApi/settings');
  const client = await get(`/oauth/clients/${CLIENT_ID}`);
  const scopes = ((await get('/oauth/authServerSettings')).scopes || []).map((s) => s.name);

  console.log(`Server Authentication API: apiEnabled=${api.apiEnabled} restrictAccessToRedirectlessMode=${api.restrictAccessToRedirectlessMode}`);
  console.log(`Client ${CLIENT_ID}: allowAuthenticationApiInit=${client.allowAuthenticationApiInit} restrictScopes=${client.restrictScopes} allowedScopes=${(client.restrictedScopes || []).length}`);
  console.log(`Plan: apiEnabled=true, restrictAccessToRedirectlessMode=true; client allowAuthenticationApiInit=true, restrictScopes=true, allowed list = all ${scopes.length} PF scopes.`);
  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to change PF.'); return; }

  const backup = path.join(os.tmpdir(), `pf-${CLIENT_ID}-before-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ api, client }, null, 2), { mode: 0o600 });
  console.log(`Backup written (mode 600): ${backup}`);

  const baseline = await authorize(BFF_LOGIN_SCOPE);
  if (baseline.http !== 200) throw new Error(`Refusing to start: the normal PF login is already failing (HTTP ${baseline.http}, ${baseline.error}).`);

  const revert = async () => {
    await put(`/oauth/clients/${CLIENT_ID}`, client);
    await put('/authenticationApi/settings', api);
    console.log('Reverted to the pre-change settings. Normal login now:', JSON.stringify(await authorize(BFF_LOGIN_SCOPE)));
  };

  try {
    const a = await put('/authenticationApi/settings', { ...api, apiEnabled: true, restrictAccessToRedirectlessMode: true });
    const c = await put(`/oauth/clients/${CLIENT_ID}`, { ...client, allowAuthenticationApiInit: true, restrictScopes: true, restrictedScopes: scopes });
    if (!a.ok || !c.ok) throw new Error(`PUT failed (settings ${a.status}, client ${c.status})`);

    const checks = {
      normalLogin: await authorize(BFF_LOGIN_SCOPE),
      broaderScope: await authorize('openid accounts:read transfer'),
      piFlow: await authorize(BFF_LOGIN_SCOPE, 'pi.flow'),
      secret: await clientSecretStillWorks(),
    };
    console.log('Checks:', JSON.stringify(checks));
    const ok = checks.normalLogin.http === 200 && !checks.broaderScope.error
      && checks.piFlow.http === 200 && checks.piFlow.flowStatus === 'USERNAME_PASSWORD_REQUIRED' && checks.secret !== 'FAILED';
    if (!ok) throw new Error('A post-check failed.');
    console.log('OK: pi.flow is enabled for the PF end-user client and the normal login still works.');
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    await revert();
    process.exitCode = 1;
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
