#!/usr/bin/env node
'use strict';
/**
 * provision-pf-dcr.js — prepare a PingFederate for the PingFederate AI Agent
 * dynamic client registration demo (RFC 7591 / 7592 at /as/clients.oauth2).
 *
 * Additive and idempotent. Each step reads first and changes nothing that is
 * already in place:
 *   1. scope `dcr:register` on the authorization server: the initial access
 *      token scope, so only a holder of that token can register a client
 *   2. a credential in the vault (PF_AI_DCR_IAT_CLIENT_SECRET), created once
 *   3. the confidential client `ai-demo-pf-dcr-iat`: client credentials only,
 *      restricted to `dcr:register`. The BFF uses it to mint the initial access token
 *   4. dynamic client registration settings: initial access token required,
 *      registered clients limited to a few read scopes and the demo token
 *      manager, PKCE required, and allowed to delete themselves with their
 *      registration access token (PF names them with its `dc-` prefix)
 *
 * The same script runs against the local PF and the SE PF (PF_BASE): the SE PF
 * is internet-facing, which is why registration is never open.
 *
 * Dry run by default: prints what WOULD change. --apply makes the changes and
 * reads each one back. It never prints a password or a secret.
 *
 * Usage:
 *   node scripts/pingfederate/provision-pf-dcr.js            # dry run, local PF
 *   node scripts/pingfederate/provision-pf-dcr.js --apply
 *   PF_BASE=https://localhost:19999/pf-admin-api/v1 node scripts/pingfederate/provision-pf-dcr.js   # SE, via port-forward
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';

const SCOPE = { name: 'dcr:register', description: 'Register an OAuth client (DCR initial access token)', dynamic: false };
// What a dynamically registered client may ask for. Read scopes only: a client that
// registered itself never gets write or admin scopes.
const DCR_ALLOWED_SCOPES = ['openid', 'profile', 'email', 'accounts:read'];
const IAT_SECRET = 'PF_AI_DCR_IAT_CLIENT_SECRET';
const IAT_CLIENT = {
  clientId: 'ai-demo-pf-dcr-iat',
  name: 'AI Demo PF DCR initial access token',
  enabled: true,
  grantTypes: ['CLIENT_CREDENTIALS'],
  restrictScopes: true,
  restrictedScopes: [SCOPE.name],
  defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
};
const DCR_SETTINGS = {
  initialAccessTokenScope: SCOPE.name,
  restrictCommonScopes: true,
  restrictedCommonScopes: DCR_ALLOWED_SCOPES,
  allowedExclusiveScopes: [],
  defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
  restrictToDefaultAccessTokenManager: true,
  requireProofKeyForCodeExchange: true,
  allowClientDelete: true,
  enforceReplayPrevention: false,
  requireSignedRequests: false,
  policyRefs: [],
};

const VAULT_JS = path.join(MAIN, 'demo_api_server', 'scripts', 'vault.js');
function vault(args, input) {
  const envText = fs.readFileSync(path.join(MAIN, 'demo_api_server', '.env'), 'utf8');
  const password = (envText.match(/^VAULT_PASSWORD=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
  return execFileSync(process.execPath, [VAULT_JS, ...args], {
    env: { ...process.env, VAULT_PASSWORD: password, VAULT_PATH: path.join(MAIN, 'secrets.vault') },
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
  }).trim().split('\n');
}

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const lines = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
  const line = lines.find((entry) => entry.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error(`PING_IDENTITY_PASSWORD is not set on ${CONTAINER}`);
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

const log = (message) => console.log(`[pf-dcr] ${message}`);

async function main() {
  // The PF admin APIs (local, and SE through a port-forward) use self-signed chains.
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
  // One step: `missing` says whether work is needed (read fresh each call),
  // `change` does it. After applying, `missing` is the readback.
  const step = async (label, missing, change) => {
    if (!await missing()) return log(`${label}: already in place`);
    if (!APPLY) return log(`${label}: WOULD apply`);
    await change();
    log(`${label}: applied, readback ${await missing() ? 'MISSING' : 'ok'}`);
  };
  log(`${APPLY ? 'apply' : 'dry run'} against ${PF_BASE} (${(await api('GET', 'serverSettings')).federationInfo?.baseUrl})`);

  await step(`scope ${SCOPE.name}`,
    async () => !(await api('GET', 'oauth/authServerSettings')).scopes.some((scope) => scope.name === SCOPE.name),
    async () => {
      const settings = await api('GET', 'oauth/authServerSettings');
      await api('PUT', 'oauth/authServerSettings', { ...settings, scopes: [...settings.scopes, SCOPE] });
    });

  // Created once and kept; an existing one is never replaced.
  await step(`vault ${IAT_SECRET}`,
    async () => !vault(['list']).includes(IAT_SECRET),
    async () => { vault(['set', IAT_SECRET], crypto.randomBytes(32).toString('hex')); });

  // PingFederate never returns a client secret, so "in place" means the client has the
  // right shape. Creating it sends the vault secret; an existing client keeps its own.
  const findClient = async () => ((await api('GET', 'oauth/clients')).items || []).find((item) => item.clientId === IAT_CLIENT.clientId);
  await step(`client ${IAT_CLIENT.clientId}`,
    async () => {
      const client = await findClient();
      return !(client && client.enabled && client.grantTypes.length === 1 && client.grantTypes[0] === 'CLIENT_CREDENTIALS'
        && client.restrictScopes && client.restrictedScopes.length === 1 && client.restrictedScopes[0] === SCOPE.name);
    },
    async () => (await findClient()
      ? api('PUT', `oauth/clients/${IAT_CLIENT.clientId}`, { ...await findClient(), ...IAT_CLIENT })
      : api('POST', 'oauth/clients', {
        ...IAT_CLIENT,
        clientAuth: { type: 'SECRET', secret: vault(['get', IAT_SECRET]).pop() },
      })));

  const dcrOk = (dcr) => dcr && dcr.initialAccessTokenScope === SCOPE.name && dcr.restrictCommonScopes
    && [...(dcr.restrictedCommonScopes || [])].sort().join(' ') === [...DCR_ALLOWED_SCOPES].sort().join(' ')
    && dcr.allowClientDelete && dcr.requireProofKeyForCodeExchange;
  await step('dynamic client registration',
    async () => !dcrOk((await api('GET', 'oauth/clientSettings')).dynamicClientRegistration),
    async () => {
      const settings = await api('GET', 'oauth/clientSettings');
      await api('PUT', 'oauth/clientSettings', {
        ...settings,
        dynamicClientRegistration: { ...(settings.dynamicClientRegistration || {}), ...DCR_SETTINGS },
      });
    });
}

main().catch((error) => { console.error(`[pf-dcr] failed: ${error.message}`); process.exit(1); });
