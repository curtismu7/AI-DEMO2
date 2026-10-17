#!/usr/bin/env node
'use strict';
/**
 * Make PingFederate trust every IdP the ID-JAG playground's Config page lists for the
 * PingFederate target: one OIDC IdP connection per IdP (entityId = issuer, its JWKS),
 * mapped to the MCP-gateway token manager so redeemed tokens work at the gateway.
 * PingFederate 13.1 then accepts that IdP's ID-JAGs in a JWT bearer grant.
 *
 * Usage:
 *   node scripts/pingfederate/sync-id-jag-trusted-idps.js --target=local   (docker PF; admin password stays in the container)
 *   node scripts/pingfederate/sync-id-jag-trusted-idps.js --target=se      (SE PF; needs `kubectl port-forward svc/pingfederate-admin 19999:9999`)
 *   --registry=<url>  defaults to https://local.ping-devops.com:4000/api/id-jag-playground/trusted-idps/pingfederate
 *   --dry-run         print what would change
 *   --token-env=<VAR> env var holding the BFF's registry bearer (default ID_JAG_REGISTRY_TOKEN)
 *
 * Only connections whose id starts with "idjag-" are created or updated; nothing is deleted.
 */
const { spawnSync, execFileSync } = require('child_process');
const http = require('http');
const https = require('https');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const target = args.target || 'local';
const registryUrl = args.registry || 'https://local.ping-devops.com:4000/api/id-jag-playground/trusted-idps/pingfederate';
const ATM = args.atm || 'aiDemoPfMcpGatewayJwtAtm';
const insecure = new https.Agent({ rejectUnauthorized: false }); // local + port-forwarded admin use self-signed certs
const tokenEnv = args['token-env'] || 'ID_JAG_REGISTRY_TOKEN';
const registryToken = process.env[tokenEnv];

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const headers = registryToken ? { Authorization: `Bearer ${registryToken}` } : {};
    lib.get(url, url.startsWith('https:') ? { agent: insecure, headers } : { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function seAdminPassword() {
  const ns = process.env.PINGFEDERATE_NAMESPACE || 'ping-devops-curtismuir';
  const b64 = execFileSync('kubectl', ['-n', ns, 'get', 'secret', 'pingfederate-admin', '-o', 'jsonpath={.data.password}']).toString();
  return Buffer.from(b64, 'base64').toString();
}

/** One admin API call. Returns { status, body }. */
function admin(method, path, body) {
  const data = body ? JSON.stringify(body) : '';
  if (target === 'local') {
    const script = 'curl -sk -o /tmp/pfout -w "%{http_code}" -u "administrator:$PING_IDENTITY_PASSWORD" '
      + '-H "X-XSRF-Header: PingFederate" -H "Content-Type: application/json" -X "$0" "https://localhost:9999/pf-admin-api/v1$1" '
      + (data ? '--data @- ' : '') + '&& printf "\\n" && cat /tmp/pfout && rm -f /tmp/pfout';
    const r = spawnSync('docker', ['exec', '-i', 'ai-demo-pingfederate', 'sh', '-c', script, method, path], { input: data });
    const [status, ...rest] = r.stdout.toString().split('\n');
    return Promise.resolve({ status: Number(status), body: rest.join('\n') ? JSON.parse(rest.join('\n')) : null });
  }
  const auth = Buffer.from(`administrator:${seAdminPassword()}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request(`https://localhost:19999/pf-admin-api/v1${path}`, {
      method, agent: insecure,
      headers: { Authorization: `Basic ${auth}`, 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json' },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const connectionId = (idp) => `idjag-${idp.id}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 32);

function connectionFor(idp) {
  const assertion = (name) => ({ source: { type: 'ASSERTION' }, value: name });
  return {
    type: 'IDP',
    id: connectionId(idp),
    name: `ID-JAG issuer: ${idp.name || idp.issuer}`.slice(0, 64),
    entityId: idp.issuer,
    active: true,
    loggingMode: 'STANDARD',
    // An OIDC IdP connection is how PingFederate learns an issuer's keys; browser SSO is never used.
    oidcClientCredentials: { clientId: 'id-jag-trust-only' },
    idpBrowserSso: {
      protocol: 'OIDC',
      oidcProviderSettings: {
        scopes: 'openid',
        authorizationEndpoint: `${idp.issuer.replace(/\/$/, '')}/authorize`,
        tokenEndpoint: `${idp.issuer.replace(/\/$/, '')}/token`,
        jwksURL: idp.jwksUrl,
        loginType: 'CODE',
        authenticationScheme: 'BASIC',
      },
      enabledProfiles: [],
      idpIdentityMapping: 'NONE',
      attributeContract: { coreAttributes: [{ name: 'sub', masked: false }], extendedAttributes: [] },
      adapterMappings: [],
      authenticationPolicyContractMappings: [],
    },
    idpOAuthGrantAttributeMapping: {
      idpOAuthAttributeContract: { coreAttributes: [], extendedAttributes: [{ name: 'sub' }, { name: 'client_id' }, { name: 'scope' }] },
      accessTokenManagerMappings: [{
        accessTokenManagerRef: { id: ATM },
        attributeSources: [],
        attributeContractFulfillment: {
          sub: assertion('sub'),
          Username: assertion('sub'),
          client_id: assertion('client_id'),
          scope: assertion('scope'),
          act: { source: { type: 'NO_MAPPING' } },
          spiffeId: { source: { type: 'NO_MAPPING' } },
        },
        issuanceCriteria: { conditionalCriteria: [] },
      }],
    },
  };
}

(async () => {
  if (!registryToken) throw new Error(`${tokenEnv} is not set; the registry endpoint needs it as a Bearer (export it, or pass --token-env=<VAR>)`);
  const { idps = [] } = await getJson(registryUrl);
  const existing = await admin('GET', '/sp/idpConnections');
  if (existing.status !== 200) throw new Error(`PingFederate admin API -> HTTP ${existing.status}`);
  const byEntity = new Map((existing.body.items || []).map((c) => [c.entityId, c]));
  console.log(`[id-jag-sync] ${idps.length} PingFederate-target IdP(s) in the registry; target PF: ${target}`);
  for (const idp of idps) {
    const want = connectionFor(idp);
    const have = byEntity.get(idp.issuer);
    if (have && !have.id.startsWith('idjag-')) {
      console.log(`  skip ${idp.issuer}: already trusted by connection ${have.id} (not managed here)`);
      continue;
    }
    if (args['dry-run']) { console.log(`  would ${have ? 'update' : 'create'} ${want.id} for ${idp.issuer}`); continue; }
    const r = have ? await admin('PUT', `/sp/idpConnections/${have.id}`, { ...want, id: have.id })
      : await admin('POST', '/sp/idpConnections', want);
    const ok = r.status === 200 || r.status === 201;
    console.log(`  ${ok ? (have ? 'updated' : 'created') : 'FAILED'} ${want.id} for ${idp.issuer}${ok ? '' : `: HTTP ${r.status} ${JSON.stringify(r.body?.validationErrors || r.body?.message || '')}`}`);
    if (!ok) process.exitCode = 1;
  }
})().catch((err) => { console.error(`[id-jag-sync] ${err.message}`); process.exit(1); });
