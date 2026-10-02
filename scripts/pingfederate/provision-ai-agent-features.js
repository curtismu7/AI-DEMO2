#!/usr/bin/env node
'use strict';
/**
 * provision-ai-agent-features.js — prepare the LOCAL PingFederate for the
 * PingFederate AI Agent demos (docs/ENV.md, "PingFederate AI Agent feature
 * demos"): Client ID Metadata Documents (CIMD) and rich authorization requests
 * (RAR).
 *
 * Additive and idempotent. Each step reads first and changes nothing that is
 * already in place:
 *   1. scope `transactions:write` on the authorization server
 *   2. the mkcert root as a trusted CA, so PingFederate can fetch the BFF's
 *      client metadata document over HTTPS
 *   3. CIMD enabled, with one policy restricted to that exact document URL
 *   4. a lookup credential in the vault (PF_AI_RAR_LOOKUP_SECRET), created
 *      once, which the RAR processor presents to the BFF
 *   5. a `banking_transaction` authorization detail type, handled by an
 *      instance of the processor in plugins/ai-agent-rar (its JAR must already
 *      be in PingFederate's deploy directory — see that plugin's README),
 *      configured to look the signed-in user's accounts and limit up from the BFF
 *   6. the public PKCE client `ai-demo-pf-rar`, allowed that detail type
 *
 * NOT done here, because each is a decision or needs a running browser login:
 *   - the BFF's own switches (PF_AI_CIMD_ENABLED, PF_AI_RAR_ENABLED,
 *     PF_AI_RAR_CLIENT_ID, PF_PAR_ENDPOINT) — docs/ENV.md
 *   - consent rendering — plugin README
 *   - the third-party authorization server exchange and the DaVinci login
 *
 * Dry run by default: prints what WOULD change. --apply makes the changes and
 * reads each one back. It never prints a password or a secret.
 *
 * Usage:
 *   node scripts/pingfederate/provision-ai-agent-features.js            # dry run
 *   node scripts/pingfederate/provision-ai-agent-features.js --apply
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://local.ping-devops.com:4000').replace(/\/$/, '');

const SCOPE = { name: 'transactions:write', description: 'Authorize a banking transaction (RAR banking_transaction)', dynamic: false };
const CA = { id: 'aidemomkcertroot', file: path.join(MAIN, 'certs', 'mkcert-rootCA.pem') };
const CIMD_POLICY = {
  id: 'aiDemoPfCimdPolicy',
  name: 'AI Demo PF Agent CIMD',
  enabled: true,
  // The one document this demo serves — no wildcard, so no other URL can
  // register itself as a client.
  metadataUrls: [`${PUBLIC_APP_URL}/api/pf-ai-agent/cimd/client-metadata.json`],
  requireProofKeyForCodeExchange: true,
  defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
};
// Where the processor looks up the signed-in user's accounts and limit, and the
// vault entry holding the credential it presents there. The BFF reads the same
// entry (PF_AI_RAR_LOOKUP_SECRET) to check it.
const RAR_LIMITS_URL = `${PUBLIC_APP_URL}/api/pf-ai-agent/rar/user-limits`;
const RAR_LOOKUP_SECRET = 'PF_AI_RAR_LOOKUP_SECRET';
const RAR_PROCESSOR = {
  id: 'aiDemoBankingTxnProcessor', // PingFederate caps plugin IDs at 32 alphanumerics
  name: 'AI Demo banking_transaction processor',
  pluginDescriptorRef: { id: 'com.pingidentity.demo.rar.AiAgentAuthorizationDetailProcessor' },
};
const RAR_TYPE = {
  type: 'banking_transaction',
  description: 'AI Demo banking transaction authorization detail',
  authorizationDetailProcessorRef: { id: RAR_PROCESSOR.id },
};
// PingFederate 13.1 gives a CIMD client no authorization detail types and has
// no setting to change that, so RAR gets its own registered public client.
const RAR_CLIENT = {
  clientId: 'ai-demo-pf-rar',
  name: 'AI Demo PF RAR (public PKCE)',
  enabled: true,
  redirectUris: [`${PUBLIC_APP_URL}/api/pf-ai-agent/cimd/callback`],
  grantTypes: ['AUTHORIZATION_CODE'],
  clientAuth: { type: 'NONE' },
  requireProofKeyForCodeExchange: true,
  restrictScopes: true,
  restrictedScopes: ['email', 'openid', 'profile', SCOPE.name],
  authorizationDetailTypes: [RAR_TYPE.type],
  defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
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

const log = (message) => console.log(`[pf-agent-features] ${message}`);

async function main() {
  // The local PF admin API uses a self-signed chain.
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
  log(`${APPLY ? 'apply' : 'dry run'} against ${PF_BASE}`);

  await step(`scope ${SCOPE.name}`,
    async () => !(await api('GET', 'oauth/authServerSettings')).scopes.some((scope) => scope.name === SCOPE.name),
    async () => {
      const settings = await api('GET', 'oauth/authServerSettings');
      await api('PUT', 'oauth/authServerSettings', { ...settings, scopes: [...settings.scopes, SCOPE] });
    });

  const pem = fs.readFileSync(CA.file, 'utf8');
  const fingerprint = crypto.createHash('sha256').update(new crypto.X509Certificate(pem).raw).digest('hex').toUpperCase();
  await step('trusted CA mkcert root',
    async () => !((await api('GET', 'certificates/ca')).items || []).some((item) => String(item.sha256Fingerprint || '').replace(/:/g, '').toUpperCase() === fingerprint),
    () => api('POST', 'certificates/ca/import', { id: CA.id, fileData: Buffer.from(pem).toString('base64') }));

  await step('CIMD enabled',
    async () => !(await api('GET', 'oauth/cimd/settings')).cimdEnabled,
    async () => api('PUT', 'oauth/cimd/settings', { ...await api('GET', 'oauth/cimd/settings'), cimdEnabled: true }));

  const policyOk = (policy) => policy && policy.enabled && policy.requireProofKeyForCodeExchange
    && policy.metadataUrls.length === 1 && policy.metadataUrls[0] === CIMD_POLICY.metadataUrls[0];
  const findPolicy = async () => ((await api('GET', 'oauth/cimd/policies')).items || []).find((item) => item.id === CIMD_POLICY.id);
  await step(`CIMD policy ${CIMD_POLICY.id}`,
    async () => !policyOk(await findPolicy()),
    async () => (await findPolicy()
      ? api('PUT', `oauth/cimd/policies/${CIMD_POLICY.id}`, CIMD_POLICY)
      : api('POST', 'oauth/cimd/policies', CIMD_POLICY)));

  // The lookup credential is created once and kept; an existing one is never replaced.
  await step(`vault ${RAR_LOOKUP_SECRET}`,
    async () => !vault(['list']).includes(RAR_LOOKUP_SECRET),
    async () => { vault(['set', RAR_LOOKUP_SECRET], crypto.randomBytes(32).toString('hex')); });

  // PingFederate never returns the credential, so "in place" means the instance
  // exists and points at the lookup URL. Applying sends both fields.
  const findProcessor = async () => ((await api('GET', 'oauth/authorizationDetailProcessors')).items || []).find((item) => item.id === RAR_PROCESSOR.id);
  const limitsUrlOf = (processor) => (processor?.configuration?.fields || []).find((field) => field.name === 'User Limits URL')?.value;
  await step(`RAR processor ${RAR_PROCESSOR.id}`,
    async () => limitsUrlOf(await findProcessor()) !== RAR_LIMITS_URL,
    async () => {
      const body = {
        ...RAR_PROCESSOR,
        configuration: { tables: [], fields: [
          { name: 'User Limits URL', value: RAR_LIMITS_URL },
          { name: 'User Limits Credential', value: vault(['get', RAR_LOOKUP_SECRET]).pop() },
        ] },
      };
      return (await findProcessor())
        ? api('PUT', `oauth/authorizationDetailProcessors/${RAR_PROCESSOR.id}`, body)
        : api('POST', 'oauth/authorizationDetailProcessors', body);
    });

  await step(`RAR type ${RAR_TYPE.type}`,
    async () => !((await api('GET', 'oauth/authorizationDetailTypes')).items || [])
      .some((item) => item.type === RAR_TYPE.type && item.active && item.authorizationDetailProcessorRef?.id === RAR_PROCESSOR.id),
    () => api('POST', 'oauth/authorizationDetailTypes', RAR_TYPE));

  const findClient = async () => ((await api('GET', 'oauth/clients')).items || []).find((item) => item.clientId === RAR_CLIENT.clientId);
  await step(`RAR client ${RAR_CLIENT.clientId}`,
    async () => {
      const client = await findClient();
      return !(client && client.enabled && client.requireProofKeyForCodeExchange
        && (client.authorizationDetailTypes || []).includes(RAR_TYPE.type)
        && (client.redirectUris || []).includes(RAR_CLIENT.redirectUris[0]));
    },
    async () => (await findClient()
      ? api('PUT', `oauth/clients/${RAR_CLIENT.clientId}`, RAR_CLIENT)
      : api('POST', 'oauth/clients', RAR_CLIENT)));
}

main().catch((error) => { console.error(`[pf-agent-features] failed: ${error.message}`); process.exit(1); });
