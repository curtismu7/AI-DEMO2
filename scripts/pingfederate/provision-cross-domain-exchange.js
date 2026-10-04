#!/usr/bin/env node
'use strict';
/**
 * Provision the PingFederate side of the AI agent page's third path, "cross-domain exchange":
 * the BFF sends the user's PF access token to PingFederate's token endpoint for an ID-JAG, then
 * redeems that ID-JAG at a third-party token endpoint (the opt-in mock in the BFF).
 *
 *   1. two secrets in the vault, created once and never replaced:
 *        PF_AI_CROSS_DOMAIN_CLIENT_SECRET  the PF token-exchange client's secret
 *        PF_AI_THIRD_PARTY_CLIENT_SECRET   the third-party token endpoint's client secret
 *   2. the scope tp:read
 *   3. a token exchange processor policy that takes a PF access token as the subject, with NO actor
 *      (aiDemoStandardTePolicy and aiDemoPfStep9TePolicy both require one), reusing the existing
 *      subject processor aiDemoPfAccessSubjectProcessor
 *   4. an ID-JAG SP connection whose entity ID is the audience and whose resource is the resource
 *   5. the confidential client ai-demo-pf-xdomain, allowed the token exchange grant and that policy
 *
 * The matching BFF values (PF_AI_CROSS_DOMAIN_*, PF_AI_THIRD_PARTY_*) live in docker-compose.yml;
 * keep the constants below in step with them.
 *
 * Dry run by default: prints what WOULD change. --apply makes the changes and reads each one back.
 * It never prints a password or a secret.
 *
 * Usage:
 *   node scripts/pingfederate/provision-cross-domain-exchange.js            # dry run
 *   node scripts/pingfederate/provision-cross-domain-exchange.js --apply
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';

// Keep in step with docker-compose.yml (PF_AI_CROSS_DOMAIN_* / PF_AI_THIRD_PARTY_*).
const AUDIENCE = 'https://third-party.ping.demo';
const RESOURCE = 'https://third-party.ping.demo/api';
const SCOPE = { name: 'tp:read', description: 'Read at the demo third-party authorization server', dynamic: false };
const CLIENT_ID = 'ai-demo-pf-xdomain';
const POLICY_ID = 'aiDemoPfCrossDomainTePolicy';
const SP_ID = 'aiDemoPfXdomainSp';
const SUBJECT_PROCESSOR_ID = 'aiDemoPfAccessSubjectProcessor';
const SIGNING_KEYPAIR_ID = 'aidemopf-idjag-signing';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const VAULT_SECRETS = ['PF_AI_CROSS_DOMAIN_CLIENT_SECRET', 'PF_AI_THIRD_PARTY_CLIENT_SECRET'];

const POLICY = {
  id: POLICY_ID,
  name: 'AI Demo PF Cross-Domain (ID-JAG from an access token)',
  actorTokenRequired: false,
  attributeContract: {
    coreAttributes: [{ name: 'subject' }],
    extendedAttributes: [{ name: 'scope' }, { name: 'client_id' }],
  },
  processorMappings: [{
    attributeSources: [],
    attributeContractFulfillment: {
      subject: { source: { type: 'SUBJECT_TOKEN' }, value: 'Username' },
      scope: { source: { type: 'CONTEXT' }, value: 'OAuthScopes' },
      client_id: { source: { type: 'SUBJECT_TOKEN' }, value: 'client_id' },
    },
    issuanceCriteria: { conditionalCriteria: [] },
    subjectTokenType: ACCESS_TOKEN_TYPE,
    subjectTokenProcessor: { id: SUBJECT_PROCESSOR_ID },
  }],
};

const SP = {
  type: 'SP',
  id: SP_ID,
  name: 'AI Demo PF Cross-Domain Third-Party Resource',
  entityId: AUDIENCE,
  active: true,
  loggingMode: 'STANDARD',
  virtualEntityIds: [],
  credentials: {
    certs: [],
    signingSettings: {
      signingKeyPairRef: { id: SIGNING_KEYPAIR_ID },
      algorithm: 'SHA256withRSA',
      includeCertInSignature: false,
      includeRawKeyInSignature: false,
    },
  },
  connectionTargetType: 'STANDARD',
  oauthTokenExchangeSettings: {
    resourceUris: [RESOURCE],
    minutesBefore: 5,
    minutesAfter: 30,
    idJagEnabled: true,
    attributeContract: {
      coreAttributes: [{ name: 'TOKEN_SUBJECT' }],
      extendedAttributes: [{ name: 'client_id' }, { name: 'scope' }],
    },
    processorPolicyMappings: [{
      attributeSources: [],
      attributeContractFulfillment: {
        TOKEN_SUBJECT: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'subject' },
        client_id: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'client_id' },
        scope: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'scope' },
      },
      issuanceCriteria: { conditionalCriteria: [] },
      processorPolicyRef: { id: POLICY_ID },
    }],
  },
};

function client(secret) {
  return {
    clientId: CLIENT_ID,
    name: 'AI Demo PF Cross-Domain Exchange',
    description: 'Token exchange client for the AI agent page cross-domain path (ID-JAG from a PF access token)',
    enabled: true,
    redirectUris: [],
    grantTypes: ['TOKEN_EXCHANGE'],
    clientAuth: { type: 'SECRET', secret },
    restrictScopes: true,
    restrictedScopes: [SCOPE.name],
    tokenExchangeProcessorPolicyRef: { id: POLICY_ID },
  };
}

// Same vault access as provision-ai-agent-features.js; secrets pass over stdin, never argv.
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

const log = (message) => console.log(`[pf-cross-domain] ${message}`);

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
  // A 404 on a single resource means "not there yet", anything else is a real failure.
  const find = async (resource) => {
    try { return await api('GET', resource); } catch (error) {
      if (/HTTP 404/.test(error.message)) return null;
      throw error;
    }
  };
  // One step: `missing` says whether work is needed (read fresh each call), `change` does it.
  const step = async (label, missing, change) => {
    if (!await missing()) return log(`${label}: already in place`);
    if (!APPLY) return log(`${label}: WOULD apply`);
    await change();
    log(`${label}: applied, readback ${await missing() ? 'MISSING' : 'ok'}`);
  };
  log(`${APPLY ? 'apply' : 'dry run'} against ${PF_BASE}`);

  // Secrets are created once; an existing entry is never replaced.
  for (const name of VAULT_SECRETS) {
    await step(`vault ${name}`,
      async () => !vault(['list']).includes(name),
      async () => { vault(['set', name], crypto.randomBytes(32).toString('hex')); });
  }

  await step(`scope ${SCOPE.name}`,
    async () => !(await api('GET', 'oauth/authServerSettings')).scopes.some((scope) => scope.name === SCOPE.name),
    async () => {
      const settings = await api('GET', 'oauth/authServerSettings');
      await api('PUT', 'oauth/authServerSettings', { ...settings, scopes: [...settings.scopes, SCOPE] });
    });

  const policyResource = `oauth/tokenExchange/processor/policies/${POLICY_ID}`;
  const policyOk = (policy) => policy && policy.actorTokenRequired === false
    && (policy.processorMappings || []).some((mapping) => mapping.subjectTokenType === ACCESS_TOKEN_TYPE
      && mapping.subjectTokenProcessor?.id === SUBJECT_PROCESSOR_ID);
  await step(`policy ${POLICY_ID}`,
    async () => !policyOk(await find(policyResource)),
    async () => (await find(policyResource)
      ? api('PUT', policyResource, POLICY)
      : api('POST', 'oauth/tokenExchange/processor/policies', POLICY)));

  const spResource = `idp/spConnections/${SP_ID}`;
  const spOk = (sp) => sp && sp.entityId === AUDIENCE && sp.active
    && sp.oauthTokenExchangeSettings?.idJagEnabled === true
    && (sp.oauthTokenExchangeSettings.resourceUris || []).includes(RESOURCE)
    && (sp.oauthTokenExchangeSettings.processorPolicyMappings || []).some((mapping) => mapping.processorPolicyRef?.id === POLICY_ID);
  await step(`SP connection ${SP_ID}`,
    async () => !spOk(await find(spResource)),
    async () => (await find(spResource)
      ? api('PUT', spResource, SP)
      : api('POST', 'idp/spConnections', SP)));

  // PingFederate never returns a client secret, so "in place" means the client exists with the
  // grant, policy and scope; its secret is set from the vault only when the client is created.
  const clientResource = `oauth/clients/${CLIENT_ID}`;
  const clientOk = (existing) => existing && existing.enabled
    && (existing.grantTypes || []).includes('TOKEN_EXCHANGE')
    && existing.tokenExchangeProcessorPolicyRef?.id === POLICY_ID
    && (existing.restrictedScopes || []).includes(SCOPE.name);
  await step(`client ${CLIENT_ID}`,
    async () => !clientOk(await find(clientResource)),
    async () => {
      const secret = vault(['get', 'PF_AI_CROSS_DOMAIN_CLIENT_SECRET']).pop();
      return (await find(clientResource))
        ? api('PUT', clientResource, client(secret))
        : api('POST', 'oauth/clients', client(secret));
    });
}

main().catch((error) => { console.error(`[pf-cross-domain] failed: ${error.message}`); process.exit(1); });
