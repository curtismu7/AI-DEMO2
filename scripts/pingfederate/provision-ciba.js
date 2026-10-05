#!/usr/bin/env node
'use strict';
/**
 * Provision the PingFederate side of CIBA (client-initiated backchannel authentication) for the
 * AI agent page: a human approves an agent's request on their PingOne MFA device.
 *
 *   1. a vault secret, PF_AI_CIBA_CLIENT_SECRET, created once and never replaced
 *   2. a CIBA authenticator instance (the installed PingOne MFA CIBA Authenticator), pointed at the
 *      same PingOne environment and application as the existing sign-in adapter aiDemoPfP1Mfa
 *   3. a CIBA request policy that takes the login_hint as the user and hands it to the authenticator
 *   4. the confidential client ai-demo-pf-ciba: CIBA grant, poll delivery, that request policy
 *
 * The approval itself happens on the user's PingOne MFA device, so the PingOne user behind the
 * login hint needs an enrolled device (the sign-in adapter's default method is SMS).
 *
 * Dry run by default: prints what WOULD change. --apply makes the changes and reads each one back;
 * PingFederate's own validation messages are printed as they come. Never prints a secret.
 *
 * Usage:
 *   node scripts/pingfederate/provision-ciba.js            # dry run
 *   node scripts/pingfederate/provision-ciba.js --apply
 *
 * --web-approver provisions the demo stand-in instead (never in the same run as the above): the
 * authenticator is the ai-agent-ciba-approver plugin, which asks the demo BFF for the answer and lets a
 * person approve on the demo page. It gets its own request policy and client (ai-demo-pf-ciba-web, same
 * client secret), so the PingOne MFA objects are left alone. Needs the plugin JAR deployed first.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const WEB = process.argv.includes('--web-approver');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';

const AUTHENTICATOR_TYPE = WEB
  ? 'com.pingidentity.demo.ciba.AiAgentWebApproverAuthenticator'
  : 'com.pingidentity.oobauth.pingone.mfa.PingOneMfaCibaAuthenticator';
const SIGNIN_ADAPTER_ID = 'aiDemoPfP1Mfa'; // its PingOne environment and application are reused
const INSTANCE_ID = WEB ? 'aiDemoPfCibaWebApprover' : 'aiDemoPfCibaP1Mfa';
const POLICY_ID = WEB ? 'aiDemoPfCibaWebPolicy' : 'aiDemoPfCibaPolicy';
const CLIENT_ID = WEB ? 'ai-demo-pf-ciba-web' : 'ai-demo-pf-ciba';
const VAULT_SECRET = 'PF_AI_CIBA_CLIENT_SECRET';
const APPROVER_SECRET = 'PF_AI_CIBA_APPROVER_SECRET';
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://local.ping-devops.com:4000').replace(/\/$/, '');
const APPROVER_URL = `${PUBLIC_APP_URL}/api/pf-ai-agent/ciba/web-approver`;
const TEST_USERNAME = 'demouser';
// A PingOne sign-on policy with only the MFA step. The app's own policies start with a password step, which
// this authenticator cannot answer (PingOne replies PASSWORD_REQUIRED and PingFederate returns a 500).
const P1_POLICY = 'mfa_only';
const TRANSACTION_LIFETIME_SECONDS = 120;
const POLLING_INTERVAL_SECONDS = 3;
const HINT_ATTRIBUTE = 'IDENTITY_HINT_SUBJECT';
const ATM_ID = 'aiDemoPfJwtAtm';

// Same vault access as the other provisioners; secrets pass over stdin, never argv.
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

const fieldValue = (instance, name) => (instance?.configuration?.fields || []).find((field) => field.name === name)?.value;

function webApprover(credential) {
  return {
    id: INSTANCE_ID,
    name: 'AI Demo web approver (CIBA stand-in)',
    pluginDescriptorRef: { id: AUTHENTICATOR_TYPE },
    configuration: {
      tables: [],
      fields: [{ name: 'Approval URL', value: APPROVER_URL }, { name: 'Approval Credential', value: credential }],
    },
    attributeContract: { coreAttributes: [{ name: 'subject' }], extendedAttributes: [] },
  };
}

function authenticator(environment, application) {
  const fields = [
    ['PingOne Environment', environment],
    ['Application', application],
    ['PingOne Authentication Policy', P1_POLICY],
    ['Test Username', TEST_USERNAME],
    ['PingOne Template Name', 'transaction'],
    ['Messages Files', 'pingone-mfa-messages'],
    ['API Request Timeout', '12000'],
    ['JWKS Cache Duration', '0'],
  ].map(([name, value]) => ({ name, value }));
  return {
    id: INSTANCE_ID,
    name: 'AI Demo PingOne MFA CIBA Authenticator',
    pluginDescriptorRef: { id: AUTHENTICATOR_TYPE },
    configuration: { tables: [], fields },
    attributeContract: { coreAttributes: [{ name: 'subject' }], extendedAttributes: [] },
  };
}

const POLICY = {
  id: POLICY_ID,
  name: WEB ? 'AI Demo CIBA (login_hint to the web approver)' : 'AI Demo CIBA (login_hint to PingOne MFA)',
  authenticatorRef: { id: INSTANCE_ID },
  transactionLifetime: TRANSACTION_LIFETIME_SECONDS,
  allowUnsignedLoginHintToken: false,
  requireTokenForIdentityHint: false,
  // The plain login_hint the client sends becomes the hint subject, which is the authenticator's subject.
  identityHintContract: { coreAttributes: [{ name: HINT_ATTRIBUTE }], extendedAttributes: [] },
  identityHintMapping: {
    attributeSources: [],
    // PF's request-policy contract also requires USER_KEY (the unique user id), which for a plain hint is the hint itself.
    attributeContractFulfillment: {
      subject: { source: { type: 'REQUEST' }, value: HINT_ATTRIBUTE },
      USER_KEY: { source: { type: 'REQUEST' }, value: HINT_ATTRIBUTE },
    },
    issuanceCriteria: { conditionalCriteria: [] },
  },
};

// Without a DEFAULT access token mapping on the token manager, PingFederate cannot mint a token once the
// approval comes in: "Default Access Token mapping not configured for the selected token manager".
// The user comes from the grant (the request policy's USER_KEY); the rest follow the manager's contract.
const DEFAULT_MAPPING = {
  context: { type: 'DEFAULT' },
  accessTokenManagerRef: { id: ATM_ID },
  attributeSources: [],
  attributeContractFulfillment: {
    sub: { source: { type: 'OAUTH_PERSISTENT_GRANT' }, value: 'USER_KEY' },
    Username: { source: { type: 'OAUTH_PERSISTENT_GRANT' }, value: 'USER_KEY' },
    act: { source: { type: 'TEXT' }, value: '{}' },
    scope: { source: { type: 'TEXT' }, value: 'openid' }, // both CIBA clients are restricted to openid
    client_id: { source: { type: 'CONTEXT' }, value: 'ClientId' },
    spiffeId: { source: { type: 'TEXT' }, value: 'placeholder' },
  },
  issuanceCriteria: { conditionalCriteria: [] },
};

function client(secret) {
  return {
    clientId: CLIENT_ID,
    name: WEB ? 'AI Demo PF CIBA (web approver)' : 'AI Demo PF CIBA (human approval)',
    description: 'Confidential client for the AI agent page CIBA path: a human approves the agent request on their PingOne MFA device',
    enabled: true,
    redirectUris: [],
    grantTypes: ['CIBA'],
    clientAuth: { type: 'SECRET', secret },
    restrictScopes: true,
    restrictedScopes: ['openid'],
    requestPolicyRef: { id: POLICY_ID },
    cibaDeliveryMode: 'POLL',
    cibaPollingInterval: POLLING_INTERVAL_SECONDS,
    cibaRequireSignedRequests: false,
    cibaUserCodeSupported: false,
    defaultAccessTokenManagerRef: { id: ATM_ID },
  };
}

const log = (message) => console.log(`[pf-ciba] ${message}`);

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
  const step = async (label, missing, change) => {
    if (!await missing()) return log(`${label}: already in place`);
    if (!APPLY) return log(`${label}: WOULD apply`);
    await change();
    log(`${label}: applied, readback ${await missing() ? 'MISSING' : 'ok'}`);
  };
  log(`${APPLY ? 'apply' : 'dry run'} against ${PF_BASE}`);

  // The PingOne environment and application come from the sign-in adapter, so CIBA uses the same tenant.
  const signIn = await find(`idp/adapters/${SIGNIN_ADAPTER_ID}`);
  const environment = fieldValue(signIn, 'PingOne Environment');
  const application = fieldValue(signIn, 'Application');
  if (!environment || !application) {
    throw new Error(`the sign-in adapter ${SIGNIN_ADAPTER_ID} has no PingOne environment/application to reuse`);
  }
  log(`reusing PingOne application ${application} from ${SIGNIN_ADAPTER_ID}`);

  await step(`vault ${VAULT_SECRET}`,
    async () => !vault(['list']).includes(VAULT_SECRET),
    async () => { vault(['set', VAULT_SECRET], crypto.randomBytes(32).toString('hex')); });

  if (WEB) {
    // The plugin and the BFF share this secret; the BFF reads it from the vault (PF_AI_CIBA_APPROVER_SECRET).
    await step(`vault ${APPROVER_SECRET}`,
      async () => !vault(['list']).includes(APPROVER_SECRET),
      async () => { vault(['set', APPROVER_SECRET], crypto.randomBytes(32).toString('hex')); });
    if (!await find(`oauth/outOfBandAuthPlugins/descriptors/${AUTHENTICATOR_TYPE}`)) {
      throw new Error('the web approver plugin is not deployed on PingFederate (copy pf-ai-agent-ciba-approver.jar into its deploy dir and restart it)');
    }
  }

  const instanceResource = `oauth/outOfBandAuthPlugins/${INSTANCE_ID}`;
  const instanceOk = (instance) => instance
    && instance.pluginDescriptorRef?.id === AUTHENTICATOR_TYPE
    && (WEB
      ? fieldValue(instance, 'Approval URL') === APPROVER_URL
      : fieldValue(instance, 'PingOne Environment') === environment
        && fieldValue(instance, 'Application') === application
        && fieldValue(instance, 'PingOne Authentication Policy') === P1_POLICY);
  const instanceBody = () => (WEB ? webApprover(vault(['get', APPROVER_SECRET]).pop()) : authenticator(environment, application));
  await step(`CIBA authenticator ${INSTANCE_ID}`,
    async () => !instanceOk(await find(instanceResource)),
    async () => (await find(instanceResource)
      ? api('PUT', instanceResource, instanceBody())
      : api('POST', 'oauth/outOfBandAuthPlugins', instanceBody())));

  const policyResource = `oauth/cibaServerPolicy/requestPolicies/${POLICY_ID}`;
  const policyOk = (policy) => policy && policy.authenticatorRef?.id === INSTANCE_ID;
  await step(`CIBA request policy ${POLICY_ID}`,
    async () => !policyOk(await find(policyResource)),
    async () => (await find(policyResource)
      ? api('PUT', policyResource, POLICY)
      : api('POST', 'oauth/cibaServerPolicy/requestPolicies', POLICY)));

  const mappingList = async () => {
    const list = await api('GET', 'oauth/accessTokenMappings');
    return Array.isArray(list) ? list : list.items || [];
  };
  const findDefaultMapping = async () => (await mappingList())
    .find((mapping) => mapping.context?.type === 'DEFAULT' && mapping.accessTokenManagerRef?.id === ATM_ID);
  await step(`default access token mapping for ${ATM_ID}`,
    async () => !await findDefaultMapping(),
    async () => { await api('POST', 'oauth/accessTokenMappings', DEFAULT_MAPPING); });

  // PingFederate never returns a client secret, so "in place" means the client exists with the grant
  // and policy; the secret is set from the vault only when the client is created or rewritten.
  const clientResource = `oauth/clients/${CLIENT_ID}`;
  const clientOk = (existing) => existing && existing.enabled
    && (existing.grantTypes || []).includes('CIBA')
    && existing.requestPolicyRef?.id === POLICY_ID
    && existing.cibaDeliveryMode === 'POLL';
  await step(`client ${CLIENT_ID}`,
    async () => !clientOk(await find(clientResource)),
    async () => {
      const secret = vault(['get', VAULT_SECRET]).pop();
      return (await find(clientResource))
        ? api('PUT', clientResource, client(secret))
        : api('POST', 'oauth/clients', client(secret));
    });
}

main().catch((error) => { console.error(`[pf-ciba] failed: ${error.message}`); process.exit(1); });
