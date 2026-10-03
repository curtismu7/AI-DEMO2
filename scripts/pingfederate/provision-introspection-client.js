#!/usr/bin/env node
'use strict';
/**
 * provision-introspection-client.js — give the BFF an identity that may introspect
 * PingFederate-issued access tokens (RFC 7662).
 *
 * PingFederate only answers /as/introspect.oauth2 for a client that holds the
 * "Access Token Validation (Client is a Resource Server)" grant. None of the demo's
 * login or exchange clients do, and the user client should not gain it, so this
 * creates one dedicated client with ONLY that grant, and puts its secret in the vault
 * as PF_INTROSPECTION_CLIENT_SECRET (read by tokenIntrospectionService).
 *
 * Dry run by default: prints what WOULD change. --apply creates the client and the
 * vault entry. Idempotent: an existing client with the grant, and an existing vault
 * entry, are left alone. It never prints the secret, never touches another client and
 * never rotates an existing secret.
 *
 * Usage:
 *   node scripts/pingfederate/provision-introspection-client.js            # dry run
 *   node scripts/pingfederate/provision-introspection-client.js --apply
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';
const CLIENT_ID = 'ai-demo-pf-introspection';
const GRANT = 'ACCESS_TOKEN_VALIDATION';
const VAULT_NAME = 'PF_INTROSPECTION_CLIENT_SECRET';

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
  const api = async (method, resource, body, okStatuses = []) => {
    const response = await fetch(`${PF_BASE}/${resource}`, {
      method,
      headers: { Authorization: auth, 'X-XSRF-Header': 'x', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok && !okStatuses.includes(response.status)) {
      const detail = (json.validationErrors || []).map((item) => item.message).join('; ') || json.message || '';
      throw new Error(`${method} ${resource} -> HTTP ${response.status} ${detail}`.trim());
    }
    return { status: response.status, json };
  };
  console.log(`[pf-introspection] ${APPLY ? 'apply' : 'dry run'} against ${PF_BASE}`);

  const inVault = vaultNames().includes(VAULT_NAME);
  const existing = await api('GET', `oauth/clients/${CLIENT_ID}`, undefined, [404]);

  if (existing.status === 404) {
    if (inVault) {
      throw new Error(`${VAULT_NAME} is in the vault but client ${CLIENT_ID} is not in PingFederate; remove the stale vault entry first (this script never overwrites a secret).`);
    }
    if (!APPLY) {
      console.log(`[pf-introspection] client ${CLIENT_ID}: WOULD create (grant ${GRANT}); vault ${VAULT_NAME}: WOULD set`);
      return;
    }
    const secret = crypto.randomBytes(36).toString('base64url');
    await api('POST', 'oauth/clients', {
      clientId: CLIENT_ID,
      name: 'AI Demo token introspection',
      description: 'Resource-server identity the BFF uses to introspect PingFederate-issued access tokens (RFC 7662). Created by scripts/pingfederate/provision-introspection-client.js.',
      enabled: true,
      grantTypes: [GRANT],
      clientAuth: { type: 'SECRET', secret },
    });
    vaultSet(VAULT_NAME, secret);
    const after = await api('GET', `oauth/clients/${CLIENT_ID}`);
    console.log(`[pf-introspection] client ${CLIENT_ID}: created, readback grants ${(after.json.grantTypes || []).join(',')}`);
    console.log(`[pf-introspection] vault ${VAULT_NAME}: set`);
    return;
  }

  const grants = existing.json.grantTypes || [];
  if (!grants.includes(GRANT)) {
    throw new Error(`client ${CLIENT_ID} exists but lacks ${GRANT} (has ${grants.join(',') || 'none'}); fix it in the PF console, this script does not edit an existing client.`);
  }
  console.log(`[pf-introspection] client ${CLIENT_ID}: already present with ${GRANT}`);
  if (!inVault) {
    throw new Error(`${VAULT_NAME} is not in the vault and PingFederate will not reveal the client's secret; set it with vault:set, or delete the client in the PF console and re-run with --apply.`);
  }
  console.log(`[pf-introspection] vault ${VAULT_NAME}: kept`);
}

main().catch((error) => { console.error(`[pf-introspection] failed: ${error.message}`); process.exit(1); });
