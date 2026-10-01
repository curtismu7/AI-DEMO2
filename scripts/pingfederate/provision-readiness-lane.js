#!/usr/bin/env node
'use strict';
/**
 * provision-readiness-lane.js — prepare the LOCAL PingFederate for the demo
 * readiness PingFederate lane (docs/demo-readiness.md).
 *
 * Two additive changes, both idempotent:
 *   1. the user client gains the lane BFF's redirect URI
 *   2. the browser-login user table gains one dedicated readiness user
 * and the lane's credentials go into the vault by name.
 *
 * Dry run by default: prints what WOULD change. --apply makes the changes and
 * reads them back. It never prints a password, a secret or a token, and never
 * touches another client, another user's row, or the client's own secret (the
 * admin API returns those encrypted and they are sent back unchanged).
 *
 * Usage:
 *   node scripts/pingfederate/provision-readiness-lane.js            # dry run
 *   node scripts/pingfederate/provision-readiness-lane.js --apply
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';
const CLIENT_ID = 'ai-demo-pf-user';
const PCV_ID = 'aiDemoPfSimplePcv';
const REDIRECT_URI = 'https://readiness-bff-pingfederate:3001/api/auth/oauth/user/callback';
const USERNAME = 'readiness-pingfederate-local';
const VAULT_PREFIX = 'DEMO_READINESS_LOCAL_PINGFEDERATE_';

const envText = fs.readFileSync(path.join(MAIN, 'demo_api_server', '.env'), 'utf8');
const envValue = (name) => (envText.match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^"|"$/g, '');
const vaultEnv = { ...process.env, VAULT_PASSWORD: envValue('VAULT_PASSWORD'), VAULT_PATH: path.join(MAIN, 'secrets.vault') };
const VAULT_JS = path.join(MAIN, 'demo_api_server', 'scripts', 'vault.js');
const vaultNames = () => execFileSync(process.execPath, [VAULT_JS, 'list'], { env: vaultEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map((line) => line.trim()).filter(Boolean);
const vaultSet = (name, value) => execFileSync(process.execPath, [VAULT_JS, 'set', name], { env: vaultEnv, input: value, stdio: ['pipe', 'ignore', 'ignore'] });

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const lines = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
  const line = lines.find((entry) => entry.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error(`PING_IDENTITY_PASSWORD is not set on ${CONTAINER}`);
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

async function main() {
  // The local PF admin API uses the mkcert/self-signed chain.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const auth = 'Basic ' + Buffer.from(`administrator:${adminPassword()}`).toString('base64');
  const api = async (method, resource, body) => {
    const response = await fetch(`${PF_BASE}/${resource}`, {
      method,
      headers: { Authorization: auth, 'X-XSRF-Header': 'x', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = (json.validationErrors || []).map((item) => item.message).join('; ') || json.message || '';
      throw new Error(`${method} ${resource} -> HTTP ${response.status} ${detail}`.trim());
    }
    return json;
  };
  const mode = APPLY ? 'apply' : 'dry run';
  console.log(`[pf-readiness] ${mode} against ${PF_BASE}`);

  // 1. Redirect URI on the user client.
  const client = await api('GET', `oauth/clients/${CLIENT_ID}`);
  if ((client.redirectUris || []).includes(REDIRECT_URI)) {
    console.log(`[pf-readiness] client ${CLIENT_ID}: redirect URI already present`);
  } else if (!APPLY) {
    console.log(`[pf-readiness] client ${CLIENT_ID}: WOULD add redirect URI ${REDIRECT_URI}`);
  } else {
    await api('PUT', `oauth/clients/${CLIENT_ID}`, { ...client, redirectUris: [...(client.redirectUris || []), REDIRECT_URI] });
    const after = await api('GET', `oauth/clients/${CLIENT_ID}`);
    console.log(`[pf-readiness] client ${CLIENT_ID}: redirect URI added, readback ${after.redirectUris.includes(REDIRECT_URI) ? 'ok' : 'MISSING'} (${after.redirectUris.length} URIs)`);
  }

  // 2. Readiness user in the browser-login user table.
  const pcv = await api('GET', `passwordCredentialValidators/${PCV_ID}`);
  const table = (pcv.configuration.tables || []).find((item) => item.name === 'Users');
  if (!table) throw new Error(`PCV ${PCV_ID} has no Users table`);
  const usernameOf = (row) => (row.fields.find((field) => field.name === 'Username') || {}).value;
  const exists = table.rows.some((row) => usernameOf(row) === USERNAME);
  let password = null;
  if (exists) {
    console.log(`[pf-readiness] user ${USERNAME}: already present (password left unchanged)`);
  } else if (!APPLY) {
    console.log(`[pf-readiness] user ${USERNAME}: WOULD add to ${PCV_ID} (${table.rows.length} existing users untouched)`);
  } else {
    password = `Rd9!${crypto.randomBytes(24).toString('base64url')}aZ`;
    table.rows.push({
      fields: [
        { name: 'Username', value: USERNAME },
        { name: 'Relax Password Requirements', value: 'false' },
        { name: 'Password', value: password },
        { name: 'Confirm Password', value: password },
      ],
      defaultRow: false,
    });
    await api('PUT', `passwordCredentialValidators/${PCV_ID}`, pcv);
    const after = await api('GET', `passwordCredentialValidators/${PCV_ID}`);
    const rows = after.configuration.tables.find((item) => item.name === 'Users').rows;
    console.log(`[pf-readiness] user ${USERNAME}: added, readback ${rows.some((row) => usernameOf(row) === USERNAME) ? 'ok' : 'MISSING'} (${rows.length} users)`);
  }

  // 3. Lane credentials in the vault, by name.
  const present = new Set(vaultNames());
  const wanted = [
    ['USERNAME', USERNAME, true],
    ['EXPECTED_SUBJECT', USERNAME, true],
    // Generated only when the user row is created; in a dry run that is "would".
    ['PASSWORD', password, password !== null || (!APPLY && !exists)],
    ['WORKER_TOKEN', crypto.randomBytes(32).toString('hex'), !present.has(`${VAULT_PREFIX}WORKER_TOKEN`)],
  ];
  for (const [suffix, value, write] of wanted) {
    const name = VAULT_PREFIX + suffix;
    if (!write) { console.log(`[pf-readiness] vault ${name}: ${present.has(name) ? 'kept' : 'NOT SET (no value to write)'}`); continue; }
    if (!APPLY) { console.log(`[pf-readiness] vault ${name}: WOULD ${present.has(name) ? 'update' : 'set'}`); continue; }
    vaultSet(name, value);
    console.log(`[pf-readiness] vault ${name}: set`);
  }
  if (exists && !present.has(`${VAULT_PREFIX}PASSWORD`)) {
    console.log(`[pf-readiness] WARNING: ${USERNAME} exists in PingFederate but its password is not in the vault. Remove the user row in the PF console and re-run with --apply.`);
  }
}

main().catch((error) => { console.error(`[pf-readiness] failed: ${error.message}`); process.exit(1); });
