#!/usr/bin/env node
'use strict';
/**
 * provision-core.js — the PingFederate objects no other script creates and that
 * every PF flow depends on: base URL, signing key, the three JWT access token
 * managers, the access-token subject processor, the standard token-exchange
 * policy (aiDemoStandardTePolicy) with one ATM mapping per manager, the four
 * role clients and (unless --no-introspection) the introspection client.
 *
 * Needs no PingOne and no vault. Idempotent: an existing object is left alone
 * (never edited, never re-keyed). Client secrets come from the environment
 * (<ROLE>_CLIENT_SECRET), else from PF_SECRETS_FILE, else are generated into that
 * file (mode 600). Secrets are never printed.
 *
 * Env: PF_BASE (admin API, REQUIRED, no default; port 9999 / container ai-demo-pingfederate also need
 * I_KNOW_THIS_IS_THE_LIVE_PF=yes), PINGFEDERATE_ADMIN_PASSWORD, PF_BASE_URL (public origin; the PF base URL is
 * only changed when this is set explicitly), PF_SECRETS_FILE,
 * PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID, PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID,
 * PF_AI_AGENT_ACTOR_CLIENT_ID, PF_MCP_SERVICE_ACTOR_CLIENT_ID.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Host allowlist for the self-signed local demo PF; any other host keeps TLS verification on.
function insecureTlsAllowed(baseUrl) {
  let host;
  try { host = new URL(baseUrl).hostname; } catch { return false; }
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.ping-devops.com') || host.endsWith('.ping.demo');
}
// The live local PF: admin port 9999 or the ai-demo-pingfederate container. Needs an explicit flag.
function isLiveTarget(baseUrl, container) {
  let port = '';
  try { port = new URL(baseUrl).port; } catch { /* checked by the caller */ }
  return port === '9999' || container === 'ai-demo-pingfederate';
}
const PF_BASE = process.env.PF_BASE || '';
const BASE_URL_EXPLICIT = Boolean(process.env.PF_BASE_URL);
const PUBLIC_URL = process.env.PF_BASE_URL || 'https://local.ping-devops.com:9031';
const PASSWORD = process.env.PINGFEDERATE_ADMIN_PASSWORD;
const SECRETS_FILE = process.env.PF_SECRETS_FILE || path.join(__dirname, '.pf-client-secrets.env');
const WITH_INTROSPECTION = !process.argv.includes('--no-introspection');
const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, '../../demo_api_server/config/demoReadinessPingFederateProfiles.json'), 'utf8'));

const KEYPAIR = 'aidemopf-atm-signing';

const PROCESSOR = 'aiDemoPfAccessSubjectProcessor';
const POLICY = 'aiDemoStandardTePolicy';
const JWT_PLUGIN = 'com.pingidentity.pf.access.token.management.plugins.JwtBearerAccessTokenManagementPlugin';
const ATM_ATTRS = ['sub', 'Username', 'act', 'scope', 'client_id'];

const AGENT_ATM = 'aiDemoPfAgentGwJwtAtm';
const MCP_ATM = 'aiDemoPfMcpGatewayJwtAtm';
const BANKING_ATM = 'aiDemoPfJwtAtm';
const ROLES = [
  { env: 'PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID', def: 'ai-demo-pf-agent-exchange', atm: AGENT_ATM, policy: POLICY },
  { env: 'PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID', def: 'ai-demo-pf-mcp-exchange', atm: MCP_ATM, policy: POLICY },
  { env: 'PF_AI_AGENT_ACTOR_CLIENT_ID', def: 'ai-demo-pf-agent-actor', atm: BANKING_ATM },
  { env: 'PF_MCP_SERVICE_ACTOR_CLIENT_ID', def: 'ai-demo-pf-mcp-actor', atm: BANKING_ATM },
];

const auth = 'Basic ' + Buffer.from(`administrator:${PASSWORD}`).toString('base64');

async function api(method, resource, body, okStatuses = []) {
  const res = await fetch(`${PF_BASE}/${resource}`, {
    method,
    headers: { Authorization: auth, 'X-XSRF-Header': 'x', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !okStatuses.includes(res.status)) {
    const detail = (json.validationErrors || []).map((v) => v.message).join('; ') || json.message || '';
    throw new Error(`${method} ${resource} -> HTTP ${res.status} ${detail}`.trim());
  }
  return { status: res.status, json };
}

// Create `body` at POST `collection` unless GET `collection/id` already finds it. An existing
// object is never edited; `differs(existing)` lists key fields that drift from the desired shape.
async function ensure(collection, id, body, label = collection, differs = () => []) {
  const name = decodeURIComponent(id);
  const found = await api('GET', `${collection}/${id}`, undefined, [404]);
  if (found.status === 200) {
    console.log(`[pf-core] ${label} ${name}: exists`);
    const drift = differs(found.json);
    if (drift.length) console.error(`[pf-core] WARNING ${label} ${name} differs from the desired shape (not changed): ${drift.join(', ')}`);
    return;
  }
  await api('POST', collection, body);
  console.log(`[pf-core] ${label} ${name}: created`);
}

function storedSecret(name) {
  if (process.env[name]) return process.env[name];
  const lines = fs.existsSync(SECRETS_FILE) ? fs.readFileSync(SECRETS_FILE, 'utf8').split('\n') : [];
  const hit = lines.find((l) => l.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}
function newSecret(name) {
  const secret = crypto.randomBytes(36).toString('base64url');
  fs.appendFileSync(SECRETS_FILE, `${name}=${secret}\n`, { mode: 0o600 });
  return secret;
}

// An existing client keeps its secret: PF never reveals it, so a missing stored value is reported, not regenerated.
async function ensureClient(clientId, secretName, name, grantTypes, extra = {}) {
  const found = await api('GET', `oauth/clients/${clientId}`, undefined, [404]);
  if (found.status === 200) {
    const c = found.json;
    const drift = [];
    if (JSON.stringify([...(c.grantTypes || [])].sort()) !== JSON.stringify([...grantTypes].sort())) drift.push('grantTypes');
    if (extra.defaultAccessTokenManagerRef && c.defaultAccessTokenManagerRef?.id !== extra.defaultAccessTokenManagerRef.id) drift.push('defaultAccessTokenManagerRef');
    if (extra.tokenExchangeProcessorPolicyRef && c.tokenExchangeProcessorPolicyRef?.id !== extra.tokenExchangeProcessorPolicyRef.id) drift.push('tokenExchangeProcessorPolicyRef');
    console.log(`[pf-core] client ${clientId}: exists`);
    if (drift.length) console.error(`[pf-core] WARNING client ${clientId} differs from the desired shape (not changed): ${drift.join(', ')}`);
    if (!storedSecret(secretName)) console.error(`[pf-core] WARNING the secret for client ${clientId} cannot be recovered (${secretName} is not in the environment or ${SECRETS_FILE}); set it manually. No new secret was written.`);
    return;
  }
  await api('POST', 'oauth/clients', clientBody(clientId, name, storedSecret(secretName) || newSecret(secretName), grantTypes, extra));
  console.log(`[pf-core] client ${clientId}: created`);
}

const link = (collection, id) => ({ id, location: `${PF_BASE}/${collection}/${id}` });

// Never overwrites an existing base URL unless PF_BASE_URL is given explicitly.
async function baseUrl() {
  const { json } = await api('GET', 'serverSettings');
  const current = json.federationInfo.baseUrl;
  if (!BASE_URL_EXPLICIT || current === PUBLIC_URL) { console.log(`[pf-core] base URL: ${current} (left as is)`); return; }
  json.federationInfo.baseUrl = PUBLIC_URL;
  await api('PUT', 'serverSettings', json);
  console.log(`[pf-core] base URL: set to ${PUBLIC_URL}`);
}

function atmBody(id, audience) {
  const f = (name, value) => ({ name, value });
  const keyId = `${id}-key`; // PF needs key ids unique across ATMs when keys are published
  return {
    id,
    name: id,
    pluginDescriptorRef: { id: JWT_PLUGIN },
    configuration: {
      tables: [
        { name: 'Symmetric Keys', rows: [] },
        { name: 'Certificates', rows: [{ fields: [f('Key ID', keyId), f('Certificate', KEYPAIR)] }] },
      ],
      fields: [
        f('Token Lifetime', '60'), f('JWS Algorithm', 'RS256'), f('Active Signing Certificate Key ID', keyId),
        f('Issuer Claim Value', profiles.accessTokenManagers[id].issuer), f('Audience Claim Value', audience),
        f('Publish Keys to the PingFederate JWKS Endpoint', 'true'), f('JWKS Endpoint Path', `/pf/${id}/JWKS`),
        f('Include Key ID Header Parameter', 'true'),
      ],
    },
    attributeContract: { coreAttributes: [], extendedAttributes: ATM_ATTRS.map((name) => ({ name })) },
    selectionSettings: { resourceUris: /^https?:\/\//.test(audience) ? [audience] : [] }, // PF rejects non-URI audiences here
    accessControlSettings: { restrictClients: false, allowedClients: [] },
    sessionValidationSettings: { checkValidAuthnSession: false, checkSessionRevocationStatus: false, updateAuthnSessionActivity: false, includeSessionId: false },
  };
}

function processorBody() {
  const f = (name, value) => ({ name, value });
  return {
    id: PROCESSOR,
    name: 'AI Demo PF Access Token Subject Processor',
    pluginDescriptorRef: { id: 'com.pingidentity.pf.tokenprocessors.jwt.JwtTokenProcessor' },
    configuration: {
      tables: [
        { name: 'Allowed Issuers', rows: [{ fields: [f('Issuer', PUBLIC_URL), f('JWKS URL', process.env.PF_JWKS_URL || `${PUBLIC_URL}/pf/${BANKING_ATM}/JWKS`), f('JWKS', '')] }] },
        { name: 'Allowed Audiences', rows: [] },
      ],
      fields: [
        f('Require Audience', 'false'), f('Require Expiration Time', 'true'), f('Require Issued At Time', 'false'),
        f('Require Not Before Time', 'false'), f('Default Cache Duration', '5'), f('Allowed Clock Skew', '60'), f('Max Future Validity', '60'),
      ],
    },
    attributeContract: { coreAttributes: [{ name: 'sub' }], extendedAttributes: ['scope', 'client_id', 'aud', 'iss', 'act'].map((name) => ({ name })) },
  };
}

function policyBody() {
  const from = (type, value) => ({ source: { type }, value });
  return {
    id: POLICY,
    name: 'AI Demo Standard Token Exchange',
    actorTokenRequired: true,
    attributeContract: { coreAttributes: [{ name: 'subject' }], extendedAttributes: ['scope', 'client_id', 'actor_client_id'].map((name) => ({ name })) },
    processorMappings: [{
      attributeSources: [],
      attributeContractFulfillment: {
        subject: from('SUBJECT_TOKEN', 'sub'), scope: from('SUBJECT_TOKEN', 'scope'),
        client_id: from('SUBJECT_TOKEN', 'client_id'), actor_client_id: from('ACTOR_TOKEN', 'client_id'),
      },
      issuanceCriteria: { conditionalCriteria: [] },
      subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenProcessor: link('idp/tokenProcessors', PROCESSOR),
      actorTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      actorTokenProcessor: link('idp/tokenProcessors', PROCESSOR),
    }],
  };
}

function atmMappingBody(atm) {
  const from = (type, value) => ({ source: { type }, value });
  return {
    id: `urn:ietf:params:oauth:grant-type:token-exchange|${POLICY}|${atm}`,
    context: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY', contextRef: link('oauth/tokenExchange/processor/policies', POLICY) },
    accessTokenManagerRef: link('oauth/accessTokenManagers', atm),
    attributeSources: [],
    attributeContractFulfillment: {
      sub: from('TOKEN_EXCHANGE_PROCESSOR_POLICY', 'subject'),
      Username: from('TOKEN_EXCHANGE_PROCESSOR_POLICY', 'subject'),
      scope: from('TOKEN_EXCHANGE_PROCESSOR_POLICY', 'scope'),
      client_id: from('TOKEN_EXCHANGE_PROCESSOR_POLICY', 'client_id'),
      act: from('EXPRESSION', '#{"sub": #this.get("tepp.actor_client_id").toString()}'),
    },
    issuanceCriteria: { conditionalCriteria: [] },
  };
}

function clientBody(clientId, name, secret, grantTypes, extra = {}) {
  return { clientId, name, enabled: true, grantTypes, bypassApprovalPage: true, restrictScopes: false, clientAuth: { type: 'SECRET', secret }, ...extra };
}

async function main() {
  if (!PF_BASE) throw new Error('PF_BASE is required (no default: the default would be the live PF)');
  if (!PASSWORD) throw new Error('PINGFEDERATE_ADMIN_PASSWORD is required');
  if (isLiveTarget(PF_BASE, process.env.PINGFEDERATE_CONTAINER_NAME) && process.env.I_KNOW_THIS_IS_THE_LIVE_PF !== 'yes') {
    throw new Error('refusing the live PF (admin port 9999 or container ai-demo-pingfederate) without I_KNOW_THIS_IS_THE_LIVE_PF=yes');
  }
  if (insecureTlsAllowed(PF_BASE)) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local demo names use a self-signed chain
  console.log(`[pf-core] against ${PF_BASE}`);
  await baseUrl();

  // the ATM key, and the ID-JAG key provision-a2a-sp-connections.sh hardcodes
  for (const id of [KEYPAIR, 'aidemopf-idjag-signing']) {
    const key = await api('GET', `keyPairs/signing/${id}`, undefined, [404]);
    if (key.status === 404) {
      await api('POST', 'keyPairs/signing/generate', {
        id, commonName: id, organization: 'AI Demo', country: 'US',
        keyAlgorithm: 'RSA', keySize: 2048, validDays: 3650, signatureAlgorithm: 'SHA256withRSA',
      });
      console.log(`[pf-core] signing key ${id}: created`);
    } else console.log(`[pf-core] signing key ${id}: exists`);
  }

  const atmIds = Object.keys(profiles.accessTokenManagers);
  for (const id of atmIds) {
    const want = atmBody(id, profiles.accessTokenManagers[id].audience);
    const field = (atm, n) => (atm.configuration?.fields || []).find((f) => f.name === n)?.value;
    await ensure('oauth/accessTokenManagers', id, want, 'token manager', (have) =>
      ['Issuer Claim Value', 'Audience Claim Value'].filter((n) => field(have, n) !== field(want, n)));
  }
  await ensure('idp/tokenProcessors', PROCESSOR, processorBody(), 'token processor');
  await ensure('oauth/tokenExchange/processor/policies', POLICY, policyBody(), 'exchange policy');
  for (const atm of atmIds) {
    const body = atmMappingBody(atm);
    await ensure('oauth/accessTokenMappings', encodeURIComponent(body.id), body, 'ATM mapping');
  }

  const expected = [];
  for (const r of ROLES) {
    const clientId = process.env[r.env] || r.def;
    expected.push(clientId);
    await ensureClient(clientId, r.env.replace('_CLIENT_ID', '_CLIENT_SECRET'), `AI Demo PF ${r.env}`, ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], {
      defaultAccessTokenManagerRef: link('oauth/accessTokenManagers', r.atm),
      restrictToDefaultAccessTokenManager: true,
      ...(r.policy ? { tokenExchangeProcessorPolicyRef: link('oauth/tokenExchange/processor/policies', r.policy) } : {}),
    });
  }
  if (WITH_INTROSPECTION) {
    const id = 'ai-demo-pf-introspection';
    expected.push(id);
    await ensureClient(id, 'PF_INTROSPECTION_CLIENT_SECRET', 'AI Demo token introspection', ['ACCESS_TOKEN_VALIDATION']);
  }

  // Readback: every expected object must be listed by the admin API.
  const have = new Set((await api('GET', 'oauth/clients')).json.items.map((c) => c.clientId));
  const haveAtm = new Set((await api('GET', 'oauth/accessTokenManagers')).json.items.map((a) => a.id));
  const missing = [...expected.filter((c) => !have.has(c)), ...atmIds.filter((a) => !haveAtm.has(a))];
  if (missing.length) throw new Error(`readback is missing: ${missing.join(', ')}`);
  console.log(`[pf-core] readback ok: ${expected.length} clients, ${atmIds.length} token managers`);
}
module.exports = { insecureTlsAllowed, isLiveTarget };
if (require.main === module) {
  main().catch((e) => {
    const why = e.cause?.code || e.cause?.message;
    console.error(`[pf-core] failed: ${e.message}${why ? ` (${why}; TLS verification is on unless the host is a local demo name)` : ''}`);
    process.exit(1);
  });
}
