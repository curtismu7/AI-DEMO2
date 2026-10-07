#!/usr/bin/env node
// Turn on PingFederate SSO for the PF sign-in adapter, so a user who has signed in once is not
// asked to sign in again by the next authorize request (CIMD etc). PF needs BOTH:
//   1. global authentication sessions enabled, and
//   2. a session policy for the authentication source (the adapter), or no session is ever created
//      and PF logs "no session ID was found in request" on every authorize.
//
//   node scripts/pingfederate/provision-pf-sso-session.js            dry run
//   node scripts/pingfederate/provision-pf-sso-session.js --apply    enable (backup in tmp)
//   node scripts/pingfederate/provision-pf-sso-session.js --remove   put both back
//
// The PF admin password is read in-process from the container env and never printed.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.PF_ADMIN_API || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const GLOBAL = 'session/authenticationSessionPolicies/global';
const POLICIES = 'session/authenticationSessionPolicies';
const ADAPTER_ID = 'aiDemoPfHtmlForm';
const POLICY_ID = 'aiDemoPfSso';

/** Pure: the global policy with sessions switched to `enabled`. */
function withSessions(policy, enabled) {
  return { ...policy, enableSessions: enabled };
}

/** Pure: the per-source policy that makes the PF sign-in adapter create an SSO session. */
function adapterPolicy() {
  return {
    id: POLICY_ID,
    authenticationSource: { type: 'IDP_ADAPTER', sourceRef: { id: ADAPTER_ID } },
    enableSessions: true,
    persistent: false,
  };
}

function client() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
  const pw = env.find((l) => l.startsWith('PING_IDENTITY_PASSWORD='))?.slice('PING_IDENTITY_PASSWORD='.length);
  if (!pw) throw new Error('PING_IDENTITY_PASSWORD not found in ai-demo-pingfederate env');
  const headers = { Authorization: 'Basic ' + Buffer.from(`administrator:${pw}`).toString('base64'), 'X-XSRF-Header': 'x', 'Content-Type': 'application/json', Accept: 'application/json' };
  return async (method, p, body) => {
    const r = await fetch(`${ROOT}/${p}`, { method, headers, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const call = client();
  const current = await call('GET', GLOBAL);
  const existing = ((await call('GET', POLICIES)).items || []).find((p) => p.id === POLICY_ID);
  const wantSessions = !remove;
  console.log(`global enableSessions: ${current.enableSessions} -> ${wantSessions}`);
  console.log(`adapter policy ${POLICY_ID}: ${existing ? 'present' : 'absent'} -> ${wantSessions ? 'present' : 'absent'}`);
  if (!apply && !remove) return console.log('dry run; re-run with --apply');

  const backup = path.join(os.tmpdir(), `pf-session-policy-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ global: current, adapterPolicy: existing || null }, null, 2));
  console.log('backup:', backup);

  if (current.enableSessions !== wantSessions) {
    const after = await call('PUT', GLOBAL, withSessions(current, wantSessions));
    if (after.enableSessions !== wantSessions) throw new Error('global read-back mismatch');
  }
  if (wantSessions && !existing) await call('POST', POLICIES, adapterPolicy());
  if (!wantSessions && existing) await call('DELETE', `${POLICIES}/${POLICY_ID}`);

  const present = ((await call('GET', POLICIES)).items || []).some((p) => p.id === POLICY_ID);
  if (present !== wantSessions) throw new Error('adapter policy read-back mismatch');
  console.log('applied; global =', wantSessions, ', adapter policy present =', present);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { withSessions, adapterPolicy };
