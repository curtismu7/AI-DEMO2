#!/usr/bin/env node
'use strict';
/**
 * Teach the ISSUING PingFederate (SE) to take a SAML 2.0 assertion signed by the BFF and trade it
 * for an ID-JAG in ONE token exchange (the demo ID-JAG playground's SAML option, modes oauth-mcp
 * and pf-pf). Idempotent: existing objects are kept.
 *
 *   kubectl -n ping-devops-cmuir port-forward svc/pingfederate-admin 29999:9999 &
 *   node scripts/pingfederate/configure-saml-idjag.js --dry-run     # reads only
 *   node scripts/pingfederate/configure-saml-idjag.js --oauth-mcp-entity=<id> --pf-pf-entity=<id>
 *
 * Creates (ids are fixed; the CA id MUST be lower case):
 *   CA                       aidemosamlca       trusts the BFF signer certificate
 *   SAML 2.0 token processor aiDemoSaml         requires the Audience; SAML_SUBJECT from the NameID
 *   exchange policy          aiDemoSamlPolicy   subjectTokenType ...:saml2; subject + TOKEN_SUBJECT = SAML_SUBJECT
 *   client                   ai-demo-pf-saml    token exchange only; secret generated, written to the .env file
 *   one processor-policy mapping for aiDemoSamlPolicy on each SP connection the two modes use
 *
 * SP connections are DISCOVERED at run time (read-only GET /idp/spConnections) and selected by
 * entity id: oauth-mcp = pf_id_jag_audience, pf-pf = the local PingFederate issuer. Without
 * --oauth-mcp-entity / --pf-pf-entity the script prints the candidates and exits 2 BEFORE any
 * write, so you confirm them first. Existing mappings are copied (scope, TOKEN_SUBJECT, client_id)
 * with only the policy ref swapped.
 *
 * Options: --ns=ping-devops-cmuir --port=29999 --audience=idJagDemoSamlAud
 *          --oauth-mcp-entity=<entity id>   --pf-pf-entity=<entity id>
 *          --oauth-mcp-client-id=<id>       --pf-pf-client-id=<id>   (default: the client_id of the existing mapping)
 *          --env-file=demo_api_server/.env  (receives PF_SAML_CLIENT_SECRET, chmod 0600)
 *          --dry-run  reads only, prints the plan     --remove  delete in reverse order
 * Secrets: never printed. The signer key pair is generated only when SAML_SIGNING_KEY_PEM_B64 /
 * SAML_SIGNING_CERT_PEM_B64 are absent (env and deploy-local/saml/signer.env); the two base64
 * values go ONLY to deploy-local/saml/signer.env (chmod 0600, gitignored).
 * Admin password: pingfederate-admin secret in --ns, or PINGFEDERATE_ADMIN_PASSWORD.
 *
 * UNVERIFIED (not confirmed against a live PingFederate or a neighbouring script; marked inline):
 *   U1 SAML 2.0 token processor descriptor id + its Audience / trusted-CA configuration fields
 *   U2 POST /certificates/ca/import body {id, fileData} and GET/DELETE /certificates/ca/{id}
 *   U3 token processor attribute contract (SAML_SUBJECT) and the policy fulfillment source for it
 *   U4 whether GET /idp/spConnections items carry oauthTokenExchangeSettings (we re-GET each by id)
 *   U5 client body for a token-exchange-only client (modelled on provision-cross-domain-exchange.js)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CA_ID = 'aidemosamlca';
const PROCESSOR_ID = 'aiDemoSaml';
const POLICY_ID = 'aiDemoSamlPolicy';
const CLIENT_ID = 'ai-demo-pf-saml';
const SAML_TYPE = 'urn:ietf:params:oauth:token-type:saml2';
const SECRET_VAR = 'PF_SAML_CLIENT_SECRET';
const KEY_VAR = 'SAML_SIGNING_KEY_PEM_B64';
const CERT_VAR = 'SAML_SIGNING_CERT_PEM_B64';
const REPO = path.join(__dirname, '../..');
const SIGNER_ENV = path.join(REPO, 'deploy-local/saml/signer.env');

// ---------- pure helpers (unit-tested; no I/O) ----------

function parseArgs(argv) {
  return Object.fromEntries(argv.map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }));
}

/** PingFederate refuses a CA entry whose id is not lower case. */
function assertLowerCaseId(id) {
  if (id !== String(id).toLowerCase()) throw new Error(`CA id must be lower case: ${id}`);
  return id;
}

const fromPolicy = (v) => ({ source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: v });
const text = (v) => ({ source: { type: 'TEXT' }, value: v });

/** The mappings on an SP connection (never undefined). */
const mappingsOf = (sp) => sp?.oauthTokenExchangeSettings?.processorPolicyMappings || [];

const hasPolicyMapping = (sp, policyId = POLICY_ID) => mappingsOf(sp).some((m) => m.processorPolicyRef?.id === policyId);

/** SP connections that can issue ID-JAGs (have token exchange settings). */
function idJagCandidates(items) {
  return (items || []).filter((c) => c.oauthTokenExchangeSettings || c.type === 'SP')
    .map((c) => ({ id: c.id, entityId: c.entityId, name: c.name, mappings: mappingsOf(c).length }));
}

function findSpByEntity(items, entityId) {
  const hits = (items || []).filter((c) => c.entityId === entityId);
  if (hits.length > 1) throw new Error(`entity id ${entityId} matches ${hits.length} SP connections (${hits.map((h) => h.id).join(', ')})`);
  return hits[0] || null;
}

/**
 * Build our mapping from one that already exists on the connection: same shape (criteria, sources,
 * every fulfillment such as scope and TOKEN_SUBJECT), only the policy ref swapped. client_id is
 * overridden when given, else kept. Returns null when there is nothing to copy.
 */
function buildPolicyMapping(sp, { clientId, policyId = POLICY_ID } = {}) {
  const base = mappingsOf(sp).find((m) => m.processorPolicyRef?.id !== policyId);
  if (!base) return null;
  const copy = JSON.parse(JSON.stringify(base));
  copy.processorPolicyRef = { id: policyId };
  copy.attributeContractFulfillment = copy.attributeContractFulfillment || {};
  if (clientId) copy.attributeContractFulfillment.client_id = text(clientId);
  return copy;
}

/** Policy attributes a mapping reads that the policy contract does not provide. */
function unresolvedPolicyRefs(mapping, policy) {
  const have = new Set([...(policy.attributeContract.coreAttributes || []), ...(policy.attributeContract.extendedAttributes || [])].map((a) => a.name));
  return Object.values(mapping.attributeContractFulfillment || {})
    .filter((f) => f?.source?.type === 'TOKEN_EXCHANGE_PROCESSOR_POLICY' && !have.has(f.value)).map((f) => f.value);
}

/** New SP body with the mapping added; null when it is already there (skip). */
function addMapping(sp, mapping, policyId = POLICY_ID) {
  if (hasPolicyMapping(sp, policyId)) return null;
  const next = JSON.parse(JSON.stringify(sp));
  next.oauthTokenExchangeSettings.processorPolicyMappings = [...mappingsOf(sp), mapping];
  return next;
}

/** New SP body without our mapping; null when it has none. Everything else is untouched. */
function removeMapping(sp, policyId = POLICY_ID) {
  if (!hasPolicyMapping(sp, policyId)) return null;
  const next = JSON.parse(JSON.stringify(sp));
  next.oauthTokenExchangeSettings.processorPolicyMappings = mappingsOf(sp).filter((m) => m.processorPolicyRef?.id !== policyId);
  return next;
}

const acceptAll = (m) => ({ attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, ...m });

function buildPolicy() {
  const fromSaml = { source: { type: 'SUBJECT_TOKEN' }, value: 'SAML_SUBJECT' }; // UNVERIFIED (U3)
  return {
    id: POLICY_ID, name: 'AI Demo SAML assertion to ID-JAG', actorTokenRequired: false,
    attributeContract: {
      coreAttributes: [{ name: 'subject' }],
      extendedAttributes: [{ name: 'TOKEN_SUBJECT' }, { name: 'scope' }, { name: 'client_id' }],
    },
    processorMappings: [acceptAll({
      subjectTokenType: SAML_TYPE, subjectTokenProcessor: { id: PROCESSOR_ID },
      actorTokenType: '', actorTokenProcessor: {},
      attributeContractFulfillment: {
        subject: fromSaml, TOKEN_SUBJECT: fromSaml,
        scope: { source: { type: 'CONTEXT' }, value: 'OAuthScopes' },
        client_id: text(CLIENT_ID),
      },
    })],
  };
}

function buildClient(secret) { // UNVERIFIED (U5): modelled on provision-cross-domain-exchange.js
  return {
    clientId: CLIENT_ID, name: 'AI Demo SAML ID-JAG exchange', enabled: true, redirectUris: [],
    description: 'Token exchange client for the demo ID-JAG playground SAML option',
    grantTypes: ['TOKEN_EXCHANGE'], clientAuth: { type: 'SECRET', secret },
    restrictScopes: false, bypassApprovalPage: true,
    tokenExchangeProcessorPolicyRef: { id: POLICY_ID },
  };
}

function buildCaImport(certPem) { // UNVERIFIED (U2)
  return { id: assertLowerCaseId(CA_ID), fileData: Buffer.from(certPem).toString('base64') };
}

/**
 * Token processor body from the descriptor PingFederate returns, so field names are not guessed:
 * the field named like "audience" gets the audience; the trusted-CA table gets a row naming the CA.
 * UNVERIFIED (U1/U3): descriptor shape and field names; throws listing what it saw if nothing matches.
 */
function buildProcessor(descriptor, { audience, caId }) {
  const cd = descriptor?.configDescriptor || {};
  const fields = (cd.fields || []).filter((f) => f.defaultValue !== undefined && f.defaultValue !== null)
    .map((f) => ({ name: f.name, value: String(f.defaultValue) }));
  const audField = (cd.fields || []).find((f) => /audience/i.test(f.name));
  if (!audField) throw new Error(`no Audience field on the SAML 2.0 processor; fields: ${(cd.fields || []).map((f) => f.name).join(' | ')}`);
  const set = (name, value) => { const f = fields.find((x) => x.name === name); if (f) f.value = value; else fields.push({ name, value }); };
  set(audField.name, audience);
  const caTable = (cd.tables || []).find((t) => /trusted|certificate|ca\b/i.test(t.name));
  if (!caTable) throw new Error(`no trusted-CA table on the SAML 2.0 processor; tables: ${(cd.tables || []).map((t) => t.name).join(' | ')}`);
  const col = (caTable.columns || []).find((c) => /cert|ca/i.test(c.name)) || (caTable.columns || [])[0];
  return {
    id: PROCESSOR_ID, name: 'AI Demo SAML 2.0 processor', pluginDescriptorRef: { id: descriptor.id },
    configuration: { fields, tables: [{ name: caTable.name, rows: [{ defaultRow: false, fields: [{ name: col.name, value: assertLowerCaseId(caId) }] }] }] },
    attributeContract: { coreAttributes: [{ name: 'SAML_SUBJECT', masked: false }], extendedAttributes: [] },
  };
}

/** Descriptor id of the SAML 2.0 token processor among /idp/tokenProcessors/descriptors items. */
function pickSamlDescriptor(items) {
  return (items || []).find((d) => /saml.?2/i.test(`${d.id} ${d.name}`) && /processor/i.test(`${d.id} ${d.name}`)) || null;
}

/** Replace or append KEY=value in .env text, keeping every other line. */
function upsertEnvLine(content, key, value) {
  const lines = content ? content.split('\n') : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else { if (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(`${key}=${value}`, ''); }
  return lines.join('\n');
}

const envValue = (content, key) => ((content || '').split('\n').find((l) => l.startsWith(`${key}=`)) || '').slice(key.length + 1).trim();

// ---------- I/O (only reached from main) ----------

function writeSecretFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Existing signer pair (env, then deploy-local/saml/signer.env), else a new one via openssl. Never printed. */
function signerPair({ dry }) {
  const fileText = fs.existsSync(SIGNER_ENV) ? fs.readFileSync(SIGNER_ENV, 'utf8') : '';
  const key = process.env[KEY_VAR] || envValue(fileText, KEY_VAR);
  const cert = process.env[CERT_VAR] || envValue(fileText, CERT_VAR);
  if (key && cert) return { certPem: Buffer.from(cert, 'base64').toString(), generated: false };
  if (key || cert) throw new Error(`${KEY_VAR} and ${CERT_VAR} must be set together`);
  if (dry) return { certPem: null, generated: true };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-signer-'));
  try {
    fs.chmodSync(dir, 0o700);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '730',
      '-subj', '/CN=AI Demo SAML signer/O=Ping Demo', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    const k = fs.readFileSync(path.join(dir, 'k.pem'));
    const c = fs.readFileSync(path.join(dir, 'c.pem'));
    writeSecretFile(SIGNER_ENV, `${KEY_VAR}=${k.toString('base64')}\n${CERT_VAR}=${c.toString('base64')}\n`);
    return { certPem: c.toString(), generated: true };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const NS = args.ns || 'ping-devops-cmuir';
  const PORT = args.port || '29999';
  const AUDIENCE = args.audience || 'idJagDemoSamlAud';
  const DRY = !!args['dry-run'];
  const REMOVE = !!args.remove;
  const ENV_FILE = path.resolve(REPO, args['env-file'] || 'demo_api_server/.env');

  const adminPw = process.env.PINGFEDERATE_ADMIN_PASSWORD
    || Buffer.from(execFileSync('kubectl', ['-n', NS, 'get', 'secret', 'pingfederate-admin', '-o', 'jsonpath={.data.password}']).toString(), 'base64').toString();
  const agent = new https.Agent({ rejectUnauthorized: false }); // port-forwarded admin API, self-signed

  function api(method, p, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(`https://localhost:${PORT}/pf-admin-api/v1${p}`, {
        method, agent,
        headers: { Authorization: `Basic ${Buffer.from(`administrator:${adminPw}`).toString('base64')}`, 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json' },
      }, (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => { let j = null; try { j = out ? JSON.parse(out) : null; } catch { j = out; } resolve({ status: res.statusCode, body: j }); });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
  /** Writes are skipped under --dry-run; GET always goes through. */
  const write = (method, p, body) => (DRY ? Promise.resolve({ status: 200, dry: true }) : api(method, p, body));

  let failed = false;
  function report(what, r) {
    const ok = r.status >= 200 && r.status < 300;
    if (!ok) failed = true;
    console.log(`  ${DRY && ok ? 'would' : ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: HTTP ${r.status} ${JSON.stringify(r.body?.validationErrors || r.body?.message || r.body)}`}`);
  }
  async function ensure(what, getPath, postPath, body) {
    if ((await api('GET', getPath)).status === 200) { console.log(`  keep ${what}`); return; }
    report(`create ${what}`, await write('POST', postPath, typeof body === 'function' ? await body() : body));
  }
  async function drop(what, p) {
    const have = await api('GET', p);
    if (have.status === 404) { console.log(`  keep ${what} (absent)`); return; }
    report(`delete ${what}`, await write('DELETE', p));
  }

  console.log(`[saml-idjag] ${REMOVE ? 'removing' : 'configuring'} via localhost:${PORT} (ns ${NS})${DRY ? ' -- DRY RUN, reads only' : ''}`);

  const list = await api('GET', '/idp/spConnections');
  if (list.status !== 200) throw new Error(`GET /idp/spConnections -> HTTP ${list.status}`);
  const items = list.body.items || [];

  if (REMOVE) {
    for (const c of items) {
      const full = (await api('GET', `/idp/spConnections/${encodeURIComponent(c.id)}`)).body;
      const next = removeMapping(full);
      if (next) report(`remove ${POLICY_ID} mapping from SP ${c.id}`, await write('PUT', `/idp/spConnections/${encodeURIComponent(c.id)}`, next));
    }
    await drop(`client ${CLIENT_ID}`, `/oauth/clients/${CLIENT_ID}`);
    await drop(`exchange policy ${POLICY_ID}`, `/oauth/tokenExchange/processor/policies/${POLICY_ID}`);
    await drop(`token processor ${PROCESSOR_ID}`, `/idp/tokenProcessors/${PROCESSOR_ID}`);
    await drop(`CA ${CA_ID}`, `/certificates/ca/${assertLowerCaseId(CA_ID)}`);
    console.log(failed ? '[saml-idjag] finished with failures' : '[saml-idjag] removed (SP connections otherwise untouched; signer files and .env left alone)');
    process.exit(failed ? 1 : 0);
  }

  const wanted = [
    { mode: 'oauth-mcp', entity: args['oauth-mcp-entity'] || process.env.PF_ID_JAG_AUDIENCE, client: args['oauth-mcp-client-id'] },
    { mode: 'pf-pf', entity: args['pf-pf-entity'], client: args['pf-pf-client-id'] },
  ];
  const targets = wanted.map((w) => ({ ...w, sp: w.entity === undefined || w.entity === true ? null : findSpByEntity(items, w.entity) }));
  const missing = targets.filter((t) => !t.sp);
  console.log('  SP connections found (read-only):');
  for (const c of idJagCandidates(items)) console.log(`    ${c.id}\tentity ${c.entityId}\t${c.mappings} mapping(s)\t${c.name}`);
  for (const t of targets) console.log(`  ${t.mode}: ${t.sp ? `SP ${t.sp.id} (entity ${t.sp.entityId})` : `no match for entity ${t.entity || '(flag not given)'}`}`);
  if (missing.length) {
    console.log(`  Confirm the entity ids above, then rerun with ${missing.map((t) => `--${t.mode}-entity=<entity id>`).join(' ')}.`);
    console.log(`  oauth-mcp entity = pf_id_jag_audience; pf-pf entity = the local PingFederate issuer. No write was made.`);
    process.exit(2);
  }

  // 1. signer + CA
  const signer = signerPair({ dry: DRY });
  console.log(`  ${signer.generated ? (DRY ? 'would generate' : 'ok   generated') : 'keep  existing'} signer key pair${signer.generated && !DRY ? ' (deploy-local/saml/signer.env, 0600)' : ''}`);
  await ensure(`CA ${CA_ID}`, `/certificates/ca/${CA_ID}`, '/certificates/ca/import', () => (signer.certPem ? buildCaImport(signer.certPem) : { id: CA_ID }));

  // 2. token processor
  await ensure(`SAML 2.0 token processor ${PROCESSOR_ID} (Audience ${AUDIENCE})`, `/idp/tokenProcessors/${PROCESSOR_ID}`, '/idp/tokenProcessors', async () => {
    const d = await api('GET', '/idp/tokenProcessors/descriptors');
    const desc = pickSamlDescriptor(d.body?.items);
    if (!desc) throw new Error('no SAML 2.0 token processor descriptor on this PingFederate');
    console.log(`    descriptor ${desc.id}`);
    return buildProcessor(desc, { audience: AUDIENCE, caId: CA_ID });
  });

  // 3. exchange policy, 4. client
  await ensure(`exchange policy ${POLICY_ID}`, `/oauth/tokenExchange/processor/policies/${POLICY_ID}`, '/oauth/tokenExchange/processor/policies', buildPolicy());
  const envText = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const haveClient = (await api('GET', `/oauth/clients/${CLIENT_ID}`)).status === 200;
  if (haveClient) {
    console.log(`  keep client ${CLIENT_ID}${envValue(envText, SECRET_VAR) ? '' : ` (${SECRET_VAR} is not in ${path.basename(ENV_FILE)}: set it yourself, the script cannot read it back)`}`);
  } else {
    const secret = envValue(envText, SECRET_VAR) || crypto.randomBytes(32).toString('hex');
    report(`create client ${CLIENT_ID}`, await write('POST', '/oauth/clients', buildClient(secret)));
    if (!DRY && !failed) {
      writeSecretFile(ENV_FILE, upsertEnvLine(envText, SECRET_VAR, secret));
      console.log(`  ok   ${SECRET_VAR} written to ${path.relative(REPO, ENV_FILE)} (0600, not printed)`);
    }
  }

  // 5. one mapping per SP connection
  for (const t of targets) {
    const id = encodeURIComponent(t.sp.id);
    const full = (await api('GET', `/idp/spConnections/${id}`)).body;
    if (hasPolicyMapping(full)) { console.log(`  keep ${POLICY_ID} mapping on SP ${t.sp.id} (${t.mode})`); continue; }
    const mapping = buildPolicyMapping(full, { clientId: t.client });
    if (!mapping) { failed = true; console.log(`  FAIL ${t.mode}: SP ${t.sp.id} has no existing mapping to copy`); continue; }
    const bad = unresolvedPolicyRefs(mapping, buildPolicy());
    if (bad.length) { failed = true; console.log(`  FAIL ${t.mode}: copied mapping reads policy attribute(s) ${bad.join(', ')} that ${POLICY_ID} does not provide`); continue; }
    console.log(`    ${t.mode}: client_id ${mapping.attributeContractFulfillment.client_id?.value ?? '(none)'}`);
    report(`add ${POLICY_ID} mapping on SP ${t.sp.id} (${t.mode})`, await write('PUT', `/idp/spConnections/${id}`, addMapping(full, mapping)));
  }

  console.log(failed ? '[saml-idjag] finished with failures' : `[saml-idjag] ${DRY ? 'dry run complete, nothing written' : 'done'}`);
  process.exit(failed ? 1 : 0);
}

module.exports = {
  parseArgs, assertLowerCaseId, mappingsOf, hasPolicyMapping, idJagCandidates, findSpByEntity,
  buildPolicyMapping, unresolvedPolicyRefs, addMapping, removeMapping, buildPolicy, buildClient,
  buildCaImport, buildProcessor, pickSamlDescriptor, upsertEnvLine, envValue, CA_ID, POLICY_ID, CLIENT_ID, PROCESSOR_ID,
};

if (require.main === module) main().catch((err) => { console.error(`[saml-idjag] ${err.message}`); process.exit(1); });
