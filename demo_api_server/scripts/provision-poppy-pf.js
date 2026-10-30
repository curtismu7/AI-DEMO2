#!/usr/bin/env node
/**
 * provision-poppy-pf.js — PingFederate objects a Poppy (Personal Agent Protocol) agent needs.
 *
 *   PF_ADMIN_URL=https://localhost:9999 PF_ADMIN_USER=administrator PF_ADMIN_PASSWORD=... \
 *   POPPY_AGENT_CLIENT_ID=https://agent.example/client.json \
 *     node scripts/provision-poppy-pf.js [--apply]
 *
 * Dry run by default; --apply writes. Creates or updates only:
 *   - access token manager poppyJwtAtm (own signing key id, client_id claim from the request)
 *   - mapping authz_req|aiDemoPfHtmlForm|poppyJwtAtm (client_id <- CONTEXT ClientId)
 *   - CIMD policy poppyAgentCimd for POPPY_AGENT_CLIENT_ID (one exact URL per policy)
 *
 * The shared aiDemoPfJwtAtm mapping hardcodes client_id, so Poppy gets its own manager.
 * Needs the signing certificate POPPY_SIGNING_CERT (default aidemopf-idjag-signing) on the PF.
 * PF caches CIMD clients for 5+ minutes, so a policy change can take that long to show.
 * Set NODE_TLS_REJECT_UNAUTHORIZED=0 for a local self-signed admin certificate.
 */
const apply = process.argv.includes('--apply');
const base = `${process.env.PF_ADMIN_URL || 'https://localhost:9999'}/pf-admin-api/v1`;
const user = process.env.PF_ADMIN_USER || 'administrator';
const password = process.env.PF_ADMIN_PASSWORD;
const agent = process.env.POPPY_AGENT_CLIENT_ID;
const cert = process.env.POPPY_SIGNING_CERT || 'aidemopf-idjag-signing';
const issuer = process.env.PF_ISSUER || 'https://local.ping-devops.com:9031';

const ATM_ID = 'poppyJwtAtm';
const POLICY_ID = 'poppyAgentCimd';
const ADAPTER_ID = process.env.POPPY_ADAPTER_ID || 'aiDemoPfHtmlForm';
const MAPPING_ID = `authz_req|${ADAPTER_ID}|${ATM_ID}`;

if (!password || !agent) {
  console.error('PF_ADMIN_PASSWORD and POPPY_AGENT_CLIENT_ID are required');
  process.exit(1);
}

const headers = {
  Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  'X-XSRF-Header': 'PingFederate',
  'Content-Type': 'application/json',
};

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function upsert(label, collection, id, desired) {
  const existing = await call('GET', `${collection}/${encodeURIComponent(id)}`);
  const exists = existing.status === 200;
  console.log(`${apply ? 'APPLY' : 'WOULD'} ${exists ? 'PUT' : 'POST'} ${label} (${id})`);
  if (!apply) return;
  const res = exists
    ? await call('PUT', `${collection}/${encodeURIComponent(id)}`, { ...desired, ...(existing.body.sequenceNumber ? { sequenceNumber: existing.body.sequenceNumber } : {}) })
    : await call('POST', collection, desired);
  if (res.status >= 300) throw new Error(`${label}: ${res.status} ${JSON.stringify(res.body)}`);
}

const field = (name, value) => ({ name, value });

const atm = {
  id: ATM_ID,
  name: 'Poppy JWT ATM',
  pluginDescriptorRef: { id: 'com.pingidentity.pf.access.token.management.plugins.JwtBearerAccessTokenManagementPlugin' },
  configuration: {
    tables: [
      { name: 'Certificates', rows: [{ fields: [field('Key ID', 'poppy-signing'), field('Certificate', cert)], defaultRow: false }] },
      { name: 'Symmetric Keys', rows: [] },
    ],
    fields: [
      field('Token Lifetime', '60'),
      field('Use Centralized Signing Key', 'false'),
      field('JWS Algorithm', 'RS256'),
      field('Active Signing Certificate Key ID', 'poppy-signing'),
      field('Include Key ID Header Parameter', 'true'),
      field('Client ID Claim Name', 'client_id'),
      field('Scope Claim Name', 'scope'),
      field('Space Delimit Scope Values', 'true'),
      field('Include Issued At Claim', 'true'),
      field('JWT ID Claim Length', '22'),
      field('Type Header Value', 'JWT'),
      field('Issuer Claim Value', issuer),
      field('Audience Claim Value', 'enduser.ping.demo'),
      field('Publish Keys to the PingFederate JWKS Endpoint', 'true'),
    ],
  },
  attributeContract: {
    coreAttributes: [],
    extendedAttributes: ['sub', 'act', 'Username', 'client_id', 'spiffeId'].map((name) => ({ name, multiValued: false })),
  },
  selectionSettings: { resourceUris: [] },
  accessControlSettings: { restrictClients: false, allowedClients: [] },
  sessionValidationSettings: { checkValidAuthnSession: false, checkSessionRevocationStatus: false, updateAuthnSessionActivity: false, includeSessionId: false },
};

const mapping = {
  id: MAPPING_ID,
  context: { type: 'IDP_ADAPTER', contextRef: { id: ADAPTER_ID } },
  accessTokenManagerRef: { id: ATM_ID },
  attributeSources: [],
  attributeContractFulfillment: {
    sub: { source: { type: 'ADAPTER' }, value: 'username' },
    act: { source: { type: 'TEXT' }, value: '{}' },
    Username: { source: { type: 'ADAPTER' }, value: 'username' },
    client_id: { source: { type: 'CONTEXT' }, value: 'ClientId' },
    spiffeId: { source: { type: 'TEXT' }, value: 'placeholder' },
  },
  issuanceCriteria: { conditionalCriteria: [] },
};

const policy = {
  id: POLICY_ID,
  name: 'Poppy agent CIMD',
  enabled: true,
  metadataUrls: [agent],
  defaultAccessTokenManagerRef: { id: ATM_ID },
  // Without this, an `openid` scope or the default manager wins and client_id comes back hardcoded.
  restrictToDefaultAccessTokenManager: true,
  requireProofKeyForCodeExchange: true,
};

(async () => {
  await upsert('access token manager', '/oauth/accessTokenManagers', ATM_ID, atm);
  await upsert('token mapping', '/oauth/accessTokenMappings', MAPPING_ID, mapping);
  await upsert('CIMD policy', '/oauth/cimd/policies', POLICY_ID, policy);
  console.log(apply ? 'Done.' : 'Dry run only; pass --apply to write.');
})().catch((e) => { console.error(e.message); process.exit(1); });
