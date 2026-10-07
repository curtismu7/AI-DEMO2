#!/usr/bin/env node
// Turn PingFederate's global authentication sessions on (or back off), so a user who has
// signed in once is not asked to sign in again by the next authorize request (CIMD etc).
// With sessions off PF logs "no session ID was found in request" on every authorize.
//
//   node scripts/pingfederate/provision-pf-sso-session.js            dry run
//   node scripts/pingfederate/provision-pf-sso-session.js --apply    enable, backup in tmp
//   node scripts/pingfederate/provision-pf-sso-session.js --remove   restore enableSessions=false
//
// The PF admin password is read in-process from the container env and never printed.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.PF_ADMIN_API || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const POLICY = 'session/authenticationSessionPolicies/global';

/** Pure: the global policy with sessions switched to `enabled`. */
function withSessions(policy, enabled) {
  return { ...policy, enableSessions: enabled };
}

function client() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
  const pw = env.find((l) => l.startsWith('PING_IDENTITY_PASSWORD='))?.slice('PING_IDENTITY_PASSWORD='.length);
  if (!pw) throw new Error('PING_IDENTITY_PASSWORD not found in ai-demo-pingfederate env');
  const headers = { Authorization: 'Basic ' + Buffer.from(`administrator:${pw}`).toString('base64'), 'X-XSRF-Header': 'x', 'Content-Type': 'application/json', Accept: 'application/json' };
  return async (method, body) => {
    const r = await fetch(`${ROOT}/${POLICY}`, { method, headers, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${POLICY} -> ${r.status}`);
    return r.json();
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const call = client();
  const current = await call('GET');
  const want = withSessions(current, !remove);
  console.log(`enableSessions: ${current.enableSessions} -> ${want.enableSessions}`);
  if (current.enableSessions === want.enableSessions) return console.log('already in that state, nothing to do');
  if (!apply && !remove) return console.log('dry run; re-run with --apply');
  const backup = path.join(os.tmpdir(), `pf-global-session-policy-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 2));
  console.log('backup:', backup);
  const after = await call('PUT', want);
  if (after.enableSessions !== want.enableSessions) throw new Error('read-back mismatch');
  console.log('applied; enableSessions =', after.enableSessions);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { withSessions };
