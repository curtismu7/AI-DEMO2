#!/usr/bin/env node
'use strict';
/**
 * Make the demo ID-JAG playground's pf-pf mode (PingFederate -> PingFederate) work on SE.
 * SE PingFederate ISSUES the ID-JAG; the Acme PingFederate REDEEMS it with a JWT bearer grant,
 * exactly as the local Docker PingFederate does for the SE issuer. Two sides, run separately,
 * each against its own admin API over a port-forward:
 *
 *   --side=issuer    SE issuing PingFederate (ns ping-devops-curtismuir, svc/pingfederate-admin 19999)
 *       SP connection aiDemoPfIdJagAcmeSp: entity id = the Acme issuer, ID-JAG enabled. Its shape is
 *       CLONED at run time from the existing SP connection aiDemoPfIdJagLocalPfSp (read-only GET),
 *       with the entity id, resource URI and client_id swapped.
 *   --side=redeemer  Acme PingFederate (ns ping-devops-cmuir, svc/pingfederate-admin 29999)
 *       IdP connection idjagFromSePf  OAuth assertion grant: trusts the SE issuer and its JWKS
 *       access token manager idjagRedeemerAtm  JWT, Resource URIs include the playground resource
 *       client ai-demo-pf-idjag-redeemer       EXTENSION (JWT bearer) grant, secret from
 *                                              PF_IDJAG_PF_REDEEMER_CLIENT_SECRET, never printed
 *       missing scopes added to the authorization server settings (additive)
 *
 * Mirrors what the local Docker PingFederate has today (objects aiDemoSePfIdJagIdp,
 * aiDemoPfMcpGatewayJwtAtm, ai-demo-pf-idjag-redeemer, read from it).
 *
 * DRY RUN BY DEFAULT: nothing is written without --apply. Idempotent: ok / keep / FAIL lines.
 * --remove deletes only the objects above (still a dry run until --apply).
 * Acme's existing demo objects (acme-agent, acme-user, password grant, acme connections, keys) are
 * never changed; the only existing object touched is authServerSettings, to ADD scopes.
 *
 * SAFETY: before ANY request that could write (and in dry run too), the script reads
 * /serverSettings and refuses unless federationInfo.baseUrl is https://<--host>. A port-forward
 * pointed at the wrong namespace is therefore stopped, not trusted.
 *
 *   kubectl -n ping-devops-curtismuir port-forward svc/pingfederate-admin 19999:9999 &
 *   node scripts/pingfederate/configure-pfpf-se.js --side=issuer                 # dry run
 *   node scripts/pingfederate/configure-pfpf-se.js --side=issuer --apply
 *   kubectl -n ping-devops-cmuir port-forward svc/pingfederate-admin 29999:9999 &
 *   node scripts/pingfederate/configure-pfpf-se.js --side=redeemer --apply
 *
 * Options: --side=issuer|redeemer (required)  --apply  --remove
 *          --ns --port --host      per-side defaults (see sideDefaults)
 *          --issuer-url=https://cmuir-pf.ping-devops.com            (SE issuing PingFederate)
 *          --redeemer-url=https://cmuir-pf-acme.ping-devops.com     (Acme PingFederate)
 *          --resource=https://api.ping.demo:3036/mcp                (must equal PF_IDJAG_PF_RESOURCE)
 *          --client-id=ai-demo-pf-idjag-redeemer   --template-sp=aiDemoPfIdJagLocalPfSp
 *          --scopes="mcp:invoke accounts:read read"   --signing-key=acme-idjag-signing
 *          --env-file=demo_api_server/.env   (source of PF_IDJAG_PF_REDEEMER_CLIENT_SECRET if not exported)
 * Admin password: PINGFEDERATE_ADMIN_PASSWORD, else the pingfederate-admin secret in --ns (read-only kubectl).
 *
 * UNVERIFIED (no SE access when written; the object shapes below were read from the LOCAL Docker PF):
 *   U1 two SP connections with the same resource URI on the SE issuer (aiDemoPfIdJagLocalPfSp and the
 *      new one): if PingFederate rejects it, pass a distinct --resource on BOTH sides and set
 *      PF_IDJAG_PF_RESOURCE to it
 *   U2 the Acme PingFederate version accepts the same IdP connection / token manager / client bodies
 *   U3 whether the MCP gateway trusts the Acme issuer (step 4 of the playground); redeem (step 3) does not need it
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '../..');
const SP_ID = 'aiDemoPfIdJagAcmeSp';
const IDP_ID = 'idjagFromSePf';
const ATM_ID = 'idjagRedeemerAtm';
const DEFAULT_CLIENT = 'ai-demo-pf-idjag-redeemer';
const DEFAULT_RESOURCE = 'https://api.ping.demo:3036/mcp';
const DEFAULT_SCOPES = 'mcp:invoke accounts:read read';
const SECRET_VAR = 'PF_IDJAG_PF_REDEEMER_CLIENT_SECRET';
const JWT_PLUGIN = 'com.pingidentity.pf.access.token.management.plugins.JwtBearerAccessTokenManagementPlugin';
const SAML_POLICY = 'aiDemoSamlPolicy'; // owned by configure-saml-idjag.js

// ---------- pure helpers (unit-tested; no I/O) ----------

function parseArgs(argv) {
  return Object.fromEntries(argv.map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }));
}

function sideDefaults(side) {
  if (side === 'issuer') return { ns: 'ping-devops-curtismuir', port: '19999', host: 'cmuir-pf.ping-devops.com' };
  if (side === 'redeemer') return { ns: 'ping-devops-cmuir', port: '29999', host: 'cmuir-pf-acme.ping-devops.com' };
  throw new Error('--side=issuer or --side=redeemer is required');
}

const normalizeBase = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

/** The identity gate: is the admin API we reached the PingFederate whose public host is `host`? */
function checkIdentity(serverSettings, host) {
  const expected = `https://${host}`;
  const got = serverSettings && typeof serverSettings === 'object' ? serverSettings.federationInfo?.baseUrl : undefined;
  return { ok: !!got && normalizeBase(got) === normalizeBase(expected), got: got || null, expected };
}

/** Deep copy without the fields PingFederate sets itself (and its self links). */
function stripReadOnly(obj) {
  if (Array.isArray(obj)) return obj.map(stripReadOnly);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj)
      .filter(([k]) => !['location', 'creationDate', 'modificationDate', 'lastModified', 'sequenceNumber'].includes(k))
      .map(([k, v]) => [k, stripReadOnly(v)]));
  }
  return obj;
}

const scopeNames = (s) => String(s || '').split(/\s+/).filter(Boolean);

/**
 * New SP connection for the Acme issuer, cloned from the template (aiDemoPfIdJagLocalPfSp): same
 * signing settings and token exchange settings, entity id / resource / client_id swapped. The SAML
 * mapping is left to configure-saml-idjag.js.
 */
function cloneSpFrom(template, { id, name, entityId, resource, clientId }) {
  const tes = template?.oauthTokenExchangeSettings;
  if (!tes) throw new Error(`template SP connection ${template?.id || '(missing)'} has no oauthTokenExchangeSettings; cannot copy its shape`);
  const mappings = (tes.processorPolicyMappings || []).filter((m) => m.processorPolicyRef?.id !== SAML_POLICY);
  if (!mappings.length) throw new Error(`template SP connection ${template.id} has no ID-JAG processor policy mapping to copy`);
  const sp = stripReadOnly(JSON.parse(JSON.stringify(template)));
  sp.id = id;
  sp.name = name;
  sp.entityId = entityId;
  sp.active = true;
  sp.oauthTokenExchangeSettings.resourceUris = [resource];
  sp.oauthTokenExchangeSettings.processorPolicyMappings = mappings.map((m) => {
    const copy = JSON.parse(JSON.stringify(m));
    copy.attributeContractFulfillment = { ...copy.attributeContractFulfillment, client_id: { source: { type: 'TEXT' }, value: clientId } };
    return copy;
  });
  return sp;
}

/** What an SP connection does, without anything secret: for the dry-run output. */
function describeSp(sp) {
  const maps = sp.oauthTokenExchangeSettings?.processorPolicyMappings || [];
  const val = (m, k) => m.attributeContractFulfillment?.[k]?.value;
  return {
    entityId: sp.entityId,
    resourceUris: sp.oauthTokenExchangeSettings?.resourceUris || [],
    policies: maps.map((m) => m.processorPolicyRef?.id),
    clientIds: maps.map((m) => val(m, 'client_id')).filter(Boolean),
    scopes: maps.map((m) => val(m, 'scope')).filter(Boolean),
    signingKey: sp.credentials?.signingSettings?.signingKeyPairRef?.id || null,
  };
}

const assertion = (name) => ({ source: { type: 'ASSERTION' }, value: name });

/** OAuth assertion grant IdP connection (shape read from the local aiDemoSePfIdJagIdp). */
function buildIdpConnection({ id, entityId, atmId }) {
  const base = entityId.replace(/\/$/, '');
  return {
    type: 'IDP', id, name: 'SE PingFederate (ID-JAG issuer)', entityId: base, active: true, loggingMode: 'STANDARD',
    // An OIDC IdP connection is how PingFederate learns an issuer's keys; browser SSO is never used.
    oidcClientCredentials: { clientId: 'id-jag-trust-only' },
    idpBrowserSso: {
      protocol: 'OIDC',
      oidcProviderSettings: {
        scopes: 'openid', authorizationEndpoint: `${base}/as/authorization.oauth2`, tokenEndpoint: `${base}/as/token.oauth2`,
        jwksURL: `${base}/pf/JWKS`, loginType: 'CODE', authenticationScheme: 'BASIC',
      },
      enabledProfiles: [], idpIdentityMapping: 'NONE',
      attributeContract: { coreAttributes: [{ name: 'sub', masked: false }], extendedAttributes: [] },
      adapterMappings: [], authenticationPolicyContractMappings: [],
    },
    idpOAuthGrantAttributeMapping: {
      idpOAuthAttributeContract: { coreAttributes: [], extendedAttributes: [{ name: 'sub' }, { name: 'client_id' }, { name: 'scope' }] },
      accessTokenManagerMappings: [{
        accessTokenManagerRef: { id: atmId }, attributeSources: [],
        attributeContractFulfillment: {
          sub: assertion('sub'), Username: assertion('sub'), client_id: assertion('client_id'), scope: assertion('scope'),
          act: { source: { type: 'NO_MAPPING' } },
        },
        issuanceCriteria: { conditionalCriteria: [] },
      }],
    },
  };
}

/** Client that redeems with the JWT bearer grant (grant type EXTENSION), as on the local PingFederate. */
function buildRedeemerClient(secret, { clientId, atmId }) {
  return {
    clientId, name: 'AI Demo ID-JAG redeemer (PF as resource AS)', enabled: true, redirectUris: [],
    description: 'Redeems ID-JAGs from the SE PingFederate with a JWT bearer grant',
    grantTypes: ['EXTENSION'], clientAuth: { type: 'SECRET', secret },
    restrictScopes: false, bypassApprovalPage: true,
    defaultAccessTokenManagerRef: { id: atmId }, restrictToDefaultAccessTokenManager: true,
  };
}

const describeClient = (c) => ({ clientId: c.clientId, grantTypes: c.grantTypes, authType: c.clientAuth?.type, tokenManager: c.defaultAccessTokenManagerRef?.id });

/** JWT token manager from the descriptor defaults (field names are not guessed), then the local settings. */
function buildRedeemerAtm(descriptor, { id, issuer, resource, signingKeyId }) {
  const cd = descriptor?.configDescriptor || {};
  const fields = (cd.fields || []).filter((f) => f.defaultValue !== undefined && f.defaultValue !== null)
    .map((f) => ({ name: f.name, value: String(f.defaultValue) }));
  const set = (name, value) => { const f = fields.find((x) => x.name === name); if (f) f.value = value; else fields.push({ name, value }); };
  const keyId = `${id}-key`; // PingFederate wants key ids unique across token managers
  set('Token Lifetime', '60');
  set('Use Centralized Signing Key', 'false');
  set('JWS Algorithm', 'RS256');
  set('Active Signing Certificate Key ID', keyId);
  set('Include Key ID Header Parameter', 'true');
  set('Issuer Claim Value', issuer.replace(/\/$/, ''));
  set('Audience Claim Value', resource);
  set('Publish Keys to the PingFederate JWKS Endpoint', 'false');
  return {
    id, name: 'AI Demo ID-JAG redeemer JWT access tokens', pluginDescriptorRef: { id: descriptor?.id || JWT_PLUGIN },
    configuration: {
      fields,
      tables: [
        { name: 'Certificates', rows: [{ defaultRow: false, fields: [{ name: 'Key ID', value: keyId }, { name: 'Certificate', value: signingKeyId }] }] },
        { name: 'Symmetric Keys', rows: [] },
      ],
    },
    attributeContract: { coreAttributes: [], extendedAttributes: ['sub', 'Username', 'act', 'scope', 'client_id'].map((name) => ({ name })) },
    selectionSettings: { resourceUris: /^https?:\/\//.test(resource) ? [resource] : [] }, // PF rejects non-URI values here
    accessControlSettings: { restrictClients: false, allowedClients: [] },
    sessionValidationSettings: { checkValidAuthnSession: false, checkSessionRevocationStatus: false, updateAuthnSessionActivity: false, includeSessionId: false },
  };
}

function missingScopes(authServerSettings, wanted) {
  const have = new Set((authServerSettings?.scopes || []).map((s) => s.name));
  return wanted.filter((s) => !have.has(s));
}

const envValue = (content, key) => ((content || '').split('\n').find((l) => l.startsWith(`${key}=`)) || '').slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1');

// ---------- I/O (only reached from main) ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const side = args.side;
  const d = sideDefaults(side);
  const NS = args.ns || d.ns;
  const PORT = args.port || d.port;
  const HOST = args.host || d.host;
  const APPLY = !!args.apply;
  const REMOVE = !!args.remove;
  const ISSUER_URL = (args['issuer-url'] || 'https://cmuir-pf.ping-devops.com').replace(/\/$/, '');
  const REDEEMER_URL = (args['redeemer-url'] || 'https://cmuir-pf-acme.ping-devops.com').replace(/\/$/, '');
  const RESOURCE = args.resource || DEFAULT_RESOURCE;
  const CLIENT = args['client-id'] || DEFAULT_CLIENT;
  const TEMPLATE_SP = args['template-sp'] || 'aiDemoPfIdJagLocalPfSp';
  const SCOPES = scopeNames(args.scopes || DEFAULT_SCOPES);
  const SIGNING_KEY = args['signing-key'] || 'acme-idjag-signing';
  const ENV_FILE = path.resolve(REPO, args['env-file'] || 'demo_api_server/.env');

  const adminPw = process.env.PINGFEDERATE_ADMIN_PASSWORD
    || Buffer.from(execFileSync('kubectl', ['-n', NS, 'get', 'secret', 'pingfederate-admin', '-o', 'jsonpath={.data.password}']).toString(), 'base64').toString();
  const agent = new https.Agent({ rejectUnauthorized: false }); // port-forwarded admin API, self-signed

  function api(method, p, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(`https://localhost:${PORT}/pf-admin-api/v1${p}`, {
        method, agent, timeout: 20000,
        headers: { Authorization: `Basic ${Buffer.from(`administrator:${adminPw}`).toString('base64')}`, 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json' },
      }, (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => { let j = null; try { j = out ? JSON.parse(out) : null; } catch { j = out; } resolve({ status: res.statusCode, body: j }); });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('admin API timed out')));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
  /** Writes are skipped unless --apply; GET always goes through. */
  const write = (method, p, body) => (APPLY ? api(method, p, body) : Promise.resolve({ status: 200, dry: true }));

  let failed = false;
  function report(what, r) {
    const ok = r.status >= 200 && r.status < 300;
    if (!ok) failed = true;
    console.log(`  ${!APPLY && ok ? 'would' : ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: HTTP ${r.status} ${JSON.stringify(r.body?.validationErrors || r.body?.message || r.body)}`}`);
  }
  async function ensure(what, getPath, postPath, body) {
    if ((await api('GET', getPath)).status === 200) { console.log(`  keep ${what}`); return; }
    report(`create ${what}`, await write('POST', postPath, typeof body === 'function' ? await body() : body));
  }
  async function drop(what, p) {
    if ((await api('GET', p)).status === 404) { console.log(`  keep ${what} (absent)`); return; }
    report(`delete ${what}`, await write('DELETE', p));
  }
  const refuse = (msg) => { console.error(`[pfpf-se] REFUSING: ${msg}`); process.exit(2); };

  console.log(`[pfpf-se] side=${side} ${REMOVE ? 'remove' : 'configure'} via localhost:${PORT} (ns ${NS}), expecting https://${HOST}${APPLY ? '' : ' -- DRY RUN, reads only (add --apply to write)'}`);

  // Identity gate: before anything else, in dry run too.
  const ss = await api('GET', '/serverSettings');
  const id = checkIdentity(ss.status === 200 ? ss.body : null, HOST);
  if (!id.ok) {
    refuse(`localhost:${PORT} answered ${ss.status === 200 ? `baseUrl ${id.got || '(none)'}` : `HTTP ${ss.status}`}, not ${id.expected}. `
      + `The port-forward points at the wrong PingFederate (this side needs ns ${NS}). Nothing was changed.`);
  }
  console.log(`  ok   identity: admin API is ${id.got}`);

  if (side === 'issuer') {
    if (normalizeBase(id.got) !== normalizeBase(ISSUER_URL)) refuse(`this side must run against ${ISSUER_URL}, the admin API is ${id.got}`);
    const spPath = `/idp/spConnections/${SP_ID}`;
    if (REMOVE) {
      await drop(`SP connection ${SP_ID}`, spPath);
    } else {
      const mine = await api('GET', spPath);
      if (mine.status === 200) {
        const ok = normalizeBase(mine.body.entityId) === normalizeBase(REDEEMER_URL);
        if (!ok) { failed = true; console.log(`  FAIL SP ${SP_ID} exists with entity id ${mine.body.entityId}, expected ${REDEEMER_URL}; remove it first (--remove)`); }
        else console.log(`  keep SP connection ${SP_ID} (entity ${mine.body.entityId})`);
      } else {
        const all = await api('GET', '/idp/spConnections');
        const clash = (all.body?.items || []).find((c) => normalizeBase(c.entityId) === normalizeBase(REDEEMER_URL));
        if (clash) { failed = true; console.log(`  FAIL SP connection ${clash.id} already has entity id ${REDEEMER_URL}; not creating a duplicate`); }
        else {
          const tpl = await api('GET', `/idp/spConnections/${encodeURIComponent(TEMPLATE_SP)}`);
          if (tpl.status !== 200) {
            console.log(`  FAIL template SP connection ${TEMPLATE_SP} not found (HTTP ${tpl.status}). Candidates:`);
            for (const c of all.body?.items || []) console.log(`    ${c.id}\tentity ${c.entityId}`);
            process.exit(2);
          }
          const body = cloneSpFrom(tpl.body, { id: SP_ID, name: 'ID-JAG to Acme PingFederate', entityId: REDEEMER_URL, resource: RESOURCE, clientId: CLIENT });
          console.log(`    shape (cloned from ${TEMPLATE_SP}): ${JSON.stringify(describeSp(body))}`);
          report(`create SP connection ${SP_ID} (entity ${REDEEMER_URL})`, await write('POST', '/idp/spConnections', body));
        }
      }
    }
  } else {
    if (normalizeBase(id.got) !== normalizeBase(REDEEMER_URL)) refuse(`this side must run against ${REDEEMER_URL}, the admin API is ${id.got}`);
    if (REMOVE) {
      await drop(`client ${CLIENT}`, `/oauth/clients/${CLIENT}`);
      await drop(`IdP connection ${IDP_ID}`, `/sp/idpConnections/${IDP_ID}`);
      await drop(`access token manager ${ATM_ID}`, `/oauth/accessTokenManagers/${ATM_ID}`);
    } else {
      const secret = process.env[SECRET_VAR] || envValue(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '', SECRET_VAR);
      const haveClient = (await api('GET', `/oauth/clients/${CLIENT}`)).status === 200;
      if (!secret && !haveClient && APPLY) refuse(`${SECRET_VAR} is not set (env, or ${path.relative(REPO, ENV_FILE)}); needed to create client ${CLIENT}`);
      console.log(`  ${secret ? 'ok  ' : 'WARN'} ${SECRET_VAR} ${secret ? 'present (not printed)' : 'NOT set; --apply will stop before creating the client'}`);

      const keys = await api('GET', '/keyPairs/signing');
      if (!(keys.body?.items || []).some((k) => k.id === SIGNING_KEY)) {
        refuse(`signing key ${SIGNING_KEY} is not on this PingFederate; run configure-acme-idp.js first (it creates it) or pass --signing-key`);
      }
      console.log(`  keep signing key ${SIGNING_KEY} (used to sign redeemed tokens; not published)`);

      const as = await api('GET', '/oauth/authServerSettings');
      const need = missingScopes(as.body, SCOPES);
      if (need.length) {
        const next = { ...as.body, scopes: [...(as.body.scopes || []), ...need.map((name) => ({ name, description: name, dynamic: false }))] };
        report(`add scopes ${need.join(' ')} (additive)`, await write('PUT', '/oauth/authServerSettings', next));
      } else console.log('  keep scopes');

      await ensure(`access token manager ${ATM_ID} (Resource URI ${RESOURCE})`, `/oauth/accessTokenManagers/${ATM_ID}`, '/oauth/accessTokenManagers', async () => {
        const desc = await api('GET', `/oauth/accessTokenManagers/descriptors/${JWT_PLUGIN}`);
        if (desc.status !== 200) throw new Error(`JWT access token manager descriptor -> HTTP ${desc.status}`);
        return buildRedeemerAtm(desc.body, { id: ATM_ID, issuer: REDEEMER_URL, resource: RESOURCE, signingKeyId: SIGNING_KEY });
      });

      const idps = await api('GET', '/sp/idpConnections');
      const trusted = (idps.body?.items || []).find((c) => normalizeBase(c.entityId) === normalizeBase(ISSUER_URL));
      if (trusted) console.log(`  keep IdP connection ${trusted.id} (already trusts ${ISSUER_URL})`);
      else report(`create IdP connection ${IDP_ID} (trusts ${ISSUER_URL}, JWKS ${ISSUER_URL}/pf/JWKS)`,
        await write('POST', '/sp/idpConnections', buildIdpConnection({ id: IDP_ID, entityId: ISSUER_URL, atmId: ATM_ID })));
      if (trusted && trusted.id !== IDP_ID) console.log(`    note: it is not ours (${IDP_ID}); make sure it maps to a token manager with Resource URI ${RESOURCE}`);

      if (haveClient) console.log(`  keep client ${CLIENT} (its secret cannot be read back; confirm it equals ${SECRET_VAR})`);
      else if (secret) report(`create client ${CLIENT} (EXTENSION grant, default token manager ${ATM_ID})`, await write('POST', '/oauth/clients', buildRedeemerClient(secret, { clientId: CLIENT, atmId: ATM_ID })));
    }
  }

  console.log(failed ? '[pfpf-se] finished with failures' : `[pfpf-se] ${APPLY ? 'done' : 'dry run complete, nothing written'}`);
  process.exit(failed ? 1 : 0);
}

module.exports = {
  parseArgs, sideDefaults, normalizeBase, checkIdentity, stripReadOnly, scopeNames, cloneSpFrom, describeSp,
  buildIdpConnection, buildRedeemerClient, describeClient, buildRedeemerAtm, missingScopes, envValue,
  SP_ID, IDP_ID, ATM_ID,
};

if (require.main === module) main().catch((err) => { console.error(`[pfpf-se] ${err.message || err.code || err}`); process.exit(1); });
