#!/usr/bin/env node
'use strict';

/*
 * Pre-demo health gate for the AI-DEMO2 stack.
 *
 *   npm run demo:health-gate
 *   NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:health-gate
 *
 * One command, run before a demo. Checks the full delegated-access (UC1)
 * dependency chain live — the exact chain whose failure modes were confirmed
 * empirically (2026-09-25 fault census):
 *
 *   1. All expected containers running and healthy
 *   2. Compose networks exist (missing-network killed the whole tier 2026-09-25)
 *   3. Feature flags hold (ff_heuristic_enabled, ff_authorize_real)
 *   4. PingOne reachable (auth + api hosts)
 *   5. P1AZ worker token + real decision endpoint returns PERMIT
 *   6. ping-gateway (Agent Gateway) reachable from the BFF network
 *   7. Exchange client can mint a token (scope-grant quirk: 'mcp:invoke'
 *      alone 400s — needs a companion scope; verified 2026-09-25)
 *   8. Stale-image check: containers WITHOUT a src mount whose image predates
 *      the newest commit touching their build context (agent-service, authz-
 *      server, mcp-server, ping-gateway rebuild only on `docker compose build`)
 *
 * Every red row prints the FIX, not just the failure. Exit 1 = do not demo.
 *
 * What it deliberately does NOT prove: a real browser session's 2-hop token
 * exchange (the token policy mints the gateway audience only for real user
 * subjects — synthetic client-credentials probes get aud=mcpserver.ping.demo
 * regardless of resource=, verified 2026-09-25). That half is the Playwright
 * smoke spec: demo_api_ui/tests/e2e/delegated-access.smoke.real.spec.js.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BFF = process.env.HEALTH_GATE_BFF_URL || 'https://localhost:3001';

// ── helpers ──────────────────────────────────────────────────────────────────

const rows = [];
function row(name, ok, detail, fix) {
  rows.push({ name, ok: !!ok, detail: detail || '', fix: fix || '' });
}

function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || e.message || '') };
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body, text: text.slice(0, 400) };
}

/** Root CA for mkcert-backed local TLS. Same rationale as check-mcp-preflight.js. */
function mkcertRoot() {
  try {
    return execSync('mkcert -CAROOT', { encoding: 'utf8' }).trim() + '/rootCA.pem';
  } catch {
    return null;
  }
}

if (process.env.NODE_EXTRA_CA_CERTS === undefined) {
  const root = mkcertRoot();
  if (root && fs.existsSync(root)) {
    process.env.NODE_EXTRA_CA_CERTS = root;
    // Node caches the CA bundle at first TLS use; spawn children instead of
    // relying on the env var mid-process for https calls.
  }
}

// ── 1. containers ────────────────────────────────────────────────────────────

const REQUIRED_CONTAINERS = [
  'ai-demo-api-server',
  'ai-demo-ui',
  'ai-demo-ping-gateway',
  'ai-demo-agent-service',
  'ai-demo-langchain-agent',
  'ai-demo-mcp-server',
  'ai-demo-mcp-gateway',
  'ai-demo-llm-proxy',
  'ai-demo-authz-server',
  'ai-demo-api-resource-server',
  'ai-demo-mcp-resource-server',
  'ai-demo-hitl-service',
  'ai-demo-mcp-discovery-agent',
];

function checkContainers() {
  const ps = sh("docker ps --format '{{.Names}}\\t{{.Status}}'");
  if (!ps.ok) {
    row('containers', false, 'docker ps failed', 'Is Docker running?');
    return new Set();
  }
  const running = new Map();
  for (const line of ps.out.split('\n')) {
    const [name, ...rest] = line.split('\t');
    if (name) running.set(name, rest.join('\t'));
  }
  const missing = [];
  for (const c of REQUIRED_CONTAINERS) {
    const status = running.get(c);
    if (!status) { missing.push(`${c} (not running)`); continue; }
    if (/unhealthy/i.test(status)) missing.push(`${c} (unhealthy)`);
  }
  row(
    'containers',
    missing.length === 0,
    missing.length ? missing.join('; ') : `${REQUIRED_CONTAINERS.length} required, all up`,
    missing.length ? `docker compose up -d   # then wait for healthchecks` : '',
  );
  // PingFederate is NOT in this compose project — it runs from
  // scripts/pingfederate/docker-compose.local.yml with operator-supplied env
  // (PINGFEDERATE_ADMIN_PASSWORD, PINGFEDERATE_PROFILE_PATH set outside Git),
  // so a missing container needs a different instruction than `compose up`.
  const pf = running.get('ai-demo-pingfederate');
  row(
    'pingfederate',
    !!pf,
    pf ? (pf.match(/healthy/i) ? 'healthy' : pf.trim()) : 'not running',
    pf ? '' : `Start it: cd scripts/pingfederate && docker compose -f docker-compose.local.yml up -d  (requires PINGFEDERATE_ADMIN_PASSWORD + PINGFEDERATE_PROFILE_PATH in the shell env — operator-supplied, outside Git). PF demos will fail without it.`,
  );
  return running;
}

// ── 2. compose networks (the 2026-09-25 outage) ─────────────────────────────

function checkNetworks() {
  const nets = sh("docker network ls --format '{{.Name}}'");
  const names = nets.ok ? nets.out.split('\n').filter(Boolean) : [];
  const want = ['ai-demo_ai-demo'];
  const missing = want.filter((n) => !names.includes(n));
  row(
    'compose networks',
    nets.ok && missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : names.filter((n) => n.startsWith('ai-demo')).join(', '),
    missing.length ? `docker compose up -d   # recreates missing networks — do NOT create them manually (label mismatch breaks compose)` : '',
  );
}

// ── 3. stale images (no-src-mount containers) ───────────────────────────────

// Containers without a src bind-mount never pick up code edits — rebuilds are
// manual. Compare image build time against the newest commit under the service's
// build context.
const NO_SRC_MOUNT_SERVICES = [
  { container: 'ai-demo-agent-service', paths: ['demo_agent_service'], service: 'agent-service' },
  { container: 'ai-demo-authz-server', paths: ['demo_authz_server'], service: 'authz-server' },
  { container: 'ai-demo-mcp-server', paths: ['demo_mcp_gateway'], service: 'mcp-server' },
  // ping-gateway rides a published IG image with config/ + groovy scripts
  // bind-mounted live — code changes do NOT need a rebuild, so it is excluded
  // from the stale-image check on purpose.
];

function checkStaleImages(running) {
  for (const { container, paths, service } of NO_SRC_MOUNT_SERVICES) {
    if (!running.has(container)) continue; // container check already flagged it
    // Resolve by compose image name — the container's .Image sha can dangle
    // after an untagged rebuild.
    const created = sh(
      `docker images --filter reference=${container}:latest --format '{{.CreatedAt}}'`,
    ).out.split('\n')[0].trim();
    const createdMs = created ? Date.parse(created) : NaN;
    const newest = sh(
      `git log -1 --format=%cI -- ${paths.join(' ')}`,
    ).out.trim();
    const newestMs = newest ? Date.parse(newest) : NaN;
    if (Number.isNaN(createdMs) || Number.isNaN(newestMs)) {
      row(`image:${container}`, false, `could not compare image age vs git (created=${created || 'none'}, newest=${newest || 'none'})`, '');
      continue;
    }
    const stale = newestMs > createdMs + 60_000; // 1min skew allowance
    row(
      `image:${container}`,
      !stale,
      stale ? `image ${created} OLDER than code ${newest}` : `current (built ${created.slice(0, 16)})`,
      stale ? `docker compose build ${service} && docker compose up -d ${service}` : '',
    );
  }
}

// ── 4. BFF health + flags ────────────────────────────────────────────────────

async function checkFlags() {
  try {
    const { status, body } = await fetchJson(`${BFF}/api/healthz`);
    row('bff:healthz', status === 200, `HTTP ${status}`, status !== 200 ? 'docker compose up -d api-server; check docker logs ai-demo-api-server' : '');
    if (status !== 200) return;
  } catch (e) {
    row('bff:healthz', false, e.cause?.code || e.message, `Is the stack up? docker compose up -d`);
    return;
  }
  // Feature flags via the admin API is auth-gated; read the LMDB-backed
  // values the same way the BFF does by exec'ing into the container. The
  // nested sh -c / node -e quoting uses single-outer + escaped-inner quotes;
  // output is piped through `tail -1` because the BFF's boot logs (otel,
  // lmdb) also go to stdout.
  const probe = sh(
    `docker exec ai-demo-api-server sh -c 'cd /app && node -e "const configStore=require(\\"./services/configStore\\");configStore.ensureInitialized().then(()=>{console.log(\\"FLAGS\\",configStore.getEffective(\\"ff_heuristic_enabled\\"),configStore.getEffective(\\"ff_authorize_real\\"));process.exit(0)})" 2>&1 | tail -1'`,
  );
  const m = probe.ok ? probe.out.match(/FLAGS (\S+) (\S+)/) : null;
  if (!m) {
    row('flags', false, 'could not read flags from BFF container', 'docker logs ai-demo-api-server');
    return;
  }
  const heuristic = m[1] === 'true';
  const authorizeReal = m[2] === 'true';
  row(
    'flags:ff_heuristic_enabled',
    heuristic,
    m[1],
    heuristic ? '' : `docker exec ai-demo-api-server node -e "..." # or PATCH /api/admin/feature-flags {"updates":{"ff_heuristic_enabled":true}}`,
  );
  row(
    'flags:ff_authorize_real',
    authorizeReal,
    m[2],
    authorizeReal ? '' : `Real PingOne Authorize is the default. Only fall back to simulated (false) if the real backend is broken — see .claude/skills/agent-demo-triage`,
  );
}

// ── 5. PingOne reachability + P1AZ decision ─────────────────────────────────

async function checkPingOne() {
  const probe = sh(
    `docker exec ai-demo-api-server sh -c 'cd /app && node -e "const configStore=require(\\"./services/configStore\\");configStore.ensureInitialized().then(async ()=>{try{const svc=require(\\"./services/pingOneAuthorizeService\\");const t=await svc.getWorkerToken();console.log(\\"WORKER_TOKEN\\",(typeof t===\\"string\\"&&t.length>20)?\\"ok\\":\\"bad\\");const ep=configStore.getEffective(\\"authorize_decision_endpoint_id\\");const d=await svc.evaluateDecisionEndpoint(ep,{UserId:\\"health-gate-probe\\",Amount:100,TransactionType:\\"read\\"});console.log(\\"P1AZ_DECISION\\",d.decision);}catch(e){console.log(\\"P1AZ_FAIL\\",(e.message||\\"\\".slice(0,200)));}process.exit(0)})" 2>&1'`,
  );
  const worker = probe.out.match(/WORKER_TOKEN (\w+)/);
  const decision = probe.out.match(/P1AZ_DECISION (\w+)/);
  const fail = probe.out.match(/P1AZ_FAIL (.*)/);
  row(
    'pingone:worker-token',
    worker && worker[1] === 'ok',
    worker ? worker[1] : 'no output',
    !worker || worker[1] !== 'ok' ? 'Check PINGONE_WORKER_CLIENT_ID/SECRET in demo_api_server/.env; is PingOne reachable from this host?' : '',
  );
  row(
    'pingone:authorize-decision',
    decision && decision[1] === 'PERMIT',
    decision ? decision[1] : (fail ? fail[1].slice(0, 120) : 'no output'),
    !decision || decision[1] !== 'PERMIT'
      ? `Real P1AZ denied/unreachable. Verified-good setup: ff_authorize_real=true + decision endpoint configured (see .claude/skills/agent-demo-triage 503 row). Not a mock fallback: fix the backend.`
      : '',
  );
}

// ── 6. gateway reachability from the BFF's network ──────────────────────────

async function checkGateway() {
  const probe = sh(
    `docker exec ai-demo-api-server sh -c 'cd /app && node -e "const configStore=require(\\"./services/configStore\\");configStore.ensureInitialized().then(async ()=>{const {getMcpGatewayHttpUrl}=require(\\"./services/mcpGatewayClient\\");const url=getMcpGatewayHttpUrl();try{const r=await fetch(url,{method:\\"POST\\",signal:AbortSignal.timeout(8000)});console.log(\\"GW_REACHABLE ok\\",url);}catch(e){console.log(\\"GW_FAIL\\",(e.cause&&e.cause.code)||e.message||\\"err\\");}process.exit(0)})" 2>&1 | tail -1'`,
  );
  const m = probe.out.match(/GW_REACHABLE (\w+) (\S+)/);
  const f = probe.out.match(/GW_FAIL (\S+)/);
  row(
    'gateway:reachable',
    !!m && m[1] === 'ok',
    m ? m[2] : (f ? f[1] : 'no output'),
    m || f ? '' : 'docker logs ai-demo-api-server',
    f && f[1] === 'ENOTFOUND' ? `ping-gateway container is down or DNS is broken: docker compose up -d ping-gateway` : '',
  );
}

// ── 7. exchange client (scope-grant quirk) ──────────────────────────────────

async function checkExchangeClient() {
  const probe = sh(
    `docker exec ai-demo-api-server sh -c 'cd /app && node -e "const configStore=require(\\"./services/configStore\\");configStore.ensureInitialized().then(async ()=>{const {exchangeForAgentGateway,isAgentGatewayConfigured}=require(\\"./services/facadeUpstreamExchange\\");if(!isAgentGatewayConfigured()){console.log(\\"EX_NOT_CONFIGURED\\");process.exit(0);}try{const svc=require(\\"./services/pingOneAuthorizeService\\");const t=await svc.getWorkerToken();const h=await exchangeForAgentGateway(t,[\\"mcp:invoke\\",\\"read\\"]);console.log(\\"EX_OK\\",!!h.accessToken);}catch(e){console.log(\\"EX_FAIL\\",(e.message||\\"\\".slice(0,150)));}process.exit(0)})" 2>&1 | tail -1'`,
  );
  const m = probe.out.match(/EX_OK (\w+)/);
  const f = probe.out.match(/EX_FAIL (.*)/) || probe.out.match(/EX_NOT_CONFIGURED/);
  row(
    'exchange:rfc8693-hop1',
    !!m && m[1] === 'true',
    m ? 'ok' : (probe.out.trim().split('\n').pop() || '').slice(0, 140),
    m && m[1] === 'true' ? '' : `Exchange client misconfigured or scopes not granted in PingOne. 'At least one scope must be granted' = the exchange app's scope grant is missing. See docs/ENV.md for app→env mapping.`,
  );
}

// ── 8. gateway-side hardening (Agent Gateway / ping-gateway) ────────────────

/** MCP initialize round-trip: a 401 with an RFC 9728 resource_metadata pointer
 *  proves the route is mounted and the protection filter is active. Any other
 *  shape (connection refused, no WWW-Authenticate) is a broken gateway path. */
async function checkGatewayMcpRoute() {
  const probe = sh(
    `docker exec ai-demo-api-server sh -c 'cd /app && node -e "fetch(\\"http://ping-gateway:8080/mcp\\",{method:\\"POST\\",headers:{\\"Content-Type\\":\\"application/json\\",\\"Accept\\":\\"application/json, text/event-stream\\"},body:JSON.stringify({jsonrpc:\\"2.0\\",id:1,method:\\"initialize\\",params:{protocolVersion:\\"2025-06-18\\",capabilities:{},clientInfo:{name:\\"health-gate\\",version:\\"0\\"}}}),signal:AbortSignal.timeout(8000)}).then(async r=>{console.log(\\"MCP_INIT\\",r.status,(r.headers.get(\\"www-authenticate\\")||\\"\\").includes(\\"resource_metadata\\")?\\"rfc9728\\":\\"no-pointer\\")}).catch(e=>console.log(\\"MCP_INIT_FAIL\\",(e.cause&&e.cause.code)||e.message||\\"err\\"))" 2>&1 | tail -1'`,
  );
  const m = probe.out.match(/MCP_INIT (401|200) (rfc9728|no-pointer)/);
  const f = probe.out.match(/MCP_INIT_FAIL (\S+)/);
  row(
    'gateway:mcp-initialize',
    !!m,
    m ? `HTTP ${m[1]} + ${m[2] === 'rfc9728' ? 'RFC 9728 pointer' : 'no pointer'}` : (f ? f[1] : 'no output'),
    !m ? `Gateway /mcp route not answering. If ENOTFOUND: docker compose up -d ping-gateway. If 500/502: docker logs ai-demo-ping-gateway — check route config load errors at startup.` : '',
  );
}

/** Scope-backstop parity: p1az-decision.groovy reads the gateway's OWN
 *  scope-topology.json copy (mounted live). A tool in the ROOT topology marked
 *  surface=gateway but missing from the gateway copy silently SKIPS the scope
 *  backstop — fail-open on that layer. Tools with no scopes in root are
 *  exempt (the backstop is a no-op for them) — those surface as a warning
 *  detail, not a failure. */
function checkGatewayScopeParity() {
  let rootTools, gwTools;
  try {
    rootTools = JSON.parse(fs.readFileSync(path.join(REPO, 'scope-topology.json'), 'utf8')).tools || {};
    gwTools = JSON.parse(fs.readFileSync(path.join(REPO, 'ping-gateway', 'config', 'scope-topology.json'), 'utf8')).tools || {};
  } catch (e) {
    row('gateway:scope-parity', false, `could not read topology files: ${e.message}`, '');
    return;
  }
  // The Groovy backstop reads toolEntry.requiredScopes (NOT 'scopes') — a tool
  // missing from the copy with requiredScopes silently SKIPS the backstop.
  const gwSurface = Object.entries(rootTools)
    .filter(([, v]) => v && v.surface === 'gateway')
    .map(([name, v]) => ({ name, scopes: v.requiredScopes || null }));
  const missingScoped = gwSurface.filter((t) => !(t.name in gwTools) && t.scopes);
  const missingUnscoped = gwSurface.filter((t) => !(t.name in gwTools) && !t.scopes);
  row(
    'gateway:scope-parity',
    missingScoped.length === 0,
    missingScoped.length
      ? `fail-open drift: ${missingScoped.map((t) => t.name).join(', ')}`
      : (missingUnscoped.length ? `ok (${missingUnscoped.length} scope-less tools absent — backstop no-op for them)` : `ok (${gwSurface.length} gateway tools covered)`),
    missingScoped.length ? `Copy the missing tool entries into ping-gateway/config/scope-topology.json (it is a hand-maintained copy, NOT regenerated) and restart ping-gateway. Missing tools silently skip the Groovy scope backstop.` : '',
  );
}

// ── 9. oauth-mcp (mcp-server) hardening — Step 9 exchange app ───────────────

/** Step-9 exchanger credential probe. The app is exchange-ONLY: client_credentials
 *  returns 400 unauthorized_client (normal — proves nothing). The discriminating
 *  probe is a token-exchange with a DUMMY subject:
 *    400 "Cannot parse token claims" → creds VALID, grant allowed (subject parse fails, which is fine)
 *    401 invalid_client             → creds STALE (the 2026-09-25 live failure)
 *  Fix: npm run pingone:refresh-envs && docker compose up -d mcp-server */
async function checkStep9Exchanger() {
  // Write the probe JS to a temp file and docker cp it in — nested sh/node
  // quoting through execSync mangled the inline version into a silent
  // S9_NOT_CONFIGURED false negative (found 2026-09-26).
  const probeJs = [
    'const cid = process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID;',
    'const cs = process.env.PINGONE_MCP_EXCHANGER_CLIENT_SECRET;',
    'if (!cid || !cs) { console.log("S9_NOT_CONFIGURED"); process.exit(0); }',
    'const b = new URLSearchParams({',
    '  grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",',
    '  subject_token: "health-gate-dummy",',
    '  subject_token_type: "urn:ietf:params:oauth:token-type:access_token",',
    '  client_id: cid, client_secret: cs,',
    '  resource: process.env.BANKING_API_RESOURCE_URI || "enduser.ping.demo",',
    '  scope: "read",',
    '});',
    'fetch(process.env.PINGONE_TOKEN_ENDPOINT, {',
    '  method: "POST",',
    '  headers: { "Content-Type": "application/x-www-form-urlencoded" },',
    '  body: b,',
    '}).then(async (r) => {',
    '  const j = await r.json().catch(() => ({}));',
    '  console.log("S9", r.status, j.error, String(j.error_description || "").slice(0, 160));',
    '}).catch((e) => console.log("S9_NET", e.message || "err"));',
  ].join('\n');
  const tmp = `/tmp/health-gate-step9-${process.pid}.js`;
  fs.writeFileSync(tmp, probeJs);
  try {
    sh(`docker cp ${tmp} ai-demo-mcp-server:/tmp/health-gate-step9.js`);
    fs.unlinkSync(tmp);
    var probe = sh(
      `docker exec ai-demo-mcp-server sh -c 'node /tmp/health-gate-step9.js 2>&1 | tail -1; rm -f /tmp/health-gate-step9.js'`,
    );
  } catch (e) {
    var probe = { ok: false, out: `probe setup failed: ${e.message}` };
  }
  const m = probe.out.match(/S9 (\d+) (\S+) (.*)/);
  const net = probe.out.match(/S9_NET (\S+)/);
  const notConfigured = /S9_NOT_CONFIGURED/.test(probe.out);
  const ok = m && m[1] === '400' && /Cannot parse token/i.test(m[3] || '');
  const stale = m && m[1] === '401';
  row(
    'oauth-mcp:step9-exchanger',
    !!ok || notConfigured,
    notConfigured ? 'not configured (Step 9 disabled — agent-passthrough fallback)' : (m ? `HTTP ${m[1]} ${m[2]}` : (net ? net[1] : 'no output')),
    stale ? `Step-9 exchanger secret is STALE (invalid_client — the 2026-09-25 live failure). Fix: npm run pingone:refresh-envs && docker compose up -d mcp-server` : (!ok && !notConfigured ? `Unexpected Step-9 probe response (${probe.out.trim().slice(0, 120)}). Check PINGONE_MCP_EXCHANGER_* in oauth-mcp/.env and the app's grant config in PingOne.` : ''),
  );
}

/** BANKING_API_RESOURCE_URI gate: when set, Step 9 is ACTIVE and a stale
 *  exchanger breaks every banking data read. When unset the server falls back
  *  to agent-passthrough silently — worth knowing, not a failure. */
async function checkStep9Gate() {
  const probe = sh(
    `docker exec ai-demo-mcp-server sh -c 'node -e "console.log(\\"S9_GATE\\",process.env.BANKING_API_RESOURCE_URI||\\"UNSET\\")" 2>&1 | tail -1'`,
  );
  const m = probe.out.match(/S9_GATE (\S+)/);
  row(
    'oauth-mcp:step9-gate',
    !!m && !!m[1] && m[1] !== 'UNSET',
    m ? m[1] : 'no output',
    m && m[1] === 'UNSET' ? `BANKING_API_RESOURCE_URI unset — Step 9 is OFF, banking tools get the un-narrowed gateway token (fine for local dev, misconfig under STRICT_AUTH). Set it in oauth-mcp/.env to enable the RFC 8693 narrowing hop.` : '',
  );
}

// ── 10. mcp-gateway (Node, demo_mcp_gateway — demo-auth profile) ────────────

/** Runtime health + P1AZ decision-endpoint reachability for the Node gateway.
 *  Only meaningful when the container is running (demo-auth profile); skipped
 *  with an explicit note otherwise. Tool-schema parity is NOT re-checked here —
 *  demo_mcp_gateway's own toolSchemaDrift.test.ts already gates the committed
 *  artifact against a fresh build. */
async function checkMcpGateway() {
  // /health is unauthenticated and reports authz posture.
  let health = null;
  try {
    const r = await fetchJson('http://localhost:3005/health');
    health = r.body;
  } catch (e) {
    const running = sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-mcp-gateway && echo yes").out.trim() === 'yes';
    row(
      'mcp-gateway:health',
      false,
      running ? `container up but :3005 unreachable (${e.cause?.code || e.message})` : 'container not running (demo-auth profile off — by design)',
      running ? `docker logs ai-demo-mcp-gateway — /health should answer 200 on :3005` : `Start with: docker compose --profile demo-auth up -d mcp-gateway`,
    );
    return;
  }
  row(
    'mcp-gateway:health',
    health?.status === 'ok',
    `status=${health?.status} policySource=${health?.authz?.policySource || '?'}`,
    health?.status === 'ok' ? '' : `docker logs ai-demo-mcp-gateway`,
  );

  // P1AZ endpoint reachability — only when the gateway's P1AZ enforcement is on.
  const p1azEnabled = String(process.env.MCP_GW_P1AZ_ENABLED || '') === 'true'
    || health?.authz?.policySource?.startsWith('p1az');
  if (!p1azEnabled) return;
  const probeJs = [
    'fetch(process.env.PINGAUTHORIZE_ENDPOINT + "/health", { signal: AbortSignal.timeout(5000) })',
    '  .then((r) => console.log("PG_P1AZ", r.status))',
    '  .catch((e) => console.log("PG_P1AZ_FAIL", (e.cause && e.cause.code) || e.message || "err"));',
  ].join('\n');
  const tmp = `/tmp/health-gate-mcpgw-${process.pid}.js`;
  fs.writeFileSync(tmp, probeJs);
  try {
    sh(`docker cp ${tmp} ai-demo-mcp-gateway:/tmp/health-gate-mcpgw.js`);
    fs.unlinkSync(tmp);
    var probe = sh(
      `docker exec ai-demo-mcp-gateway sh -c 'node /tmp/health-gate-mcpgw.js 2>&1 | tail -1; rm -f /tmp/health-gate-mcpgw.js'`,
    );
  } catch (e) {
    var probe = { ok: false, out: `probe setup failed: ${e.message}` };
  }
  const m = probe.out.match(/PG_P1AZ (\d+)/);
  const f = probe.out.match(/PG_P1AZ_FAIL (\S+)/);
  row(
    'mcp-gateway:authorize-endpoint',
    !!m && m[1] === '200',
    m ? `PINGAUTHORIZE_ENDPOINT HTTP ${m[1]}` : (f ? f[1] : 'no output'),
    m && m[1] === '200' ? '' : `PINGAUTHORIZE_ENDPOINT (${probe.out.match(/PG_P1AZ/) ? 'unreachable' : 'no probe output'}) — the Node gateway's policy engine cannot answer. Check authz-server is up (docker compose --profile demo-auth up -d authz-server) or the endpoint value in demo_mcp_gateway/.env.`,
  );
}

// ── 11. Data-plane servers: api-resource-server + mcp-resource-server ───────

/** The Demo API (:8082) is Step 9's final destination — mortgage/invest/gear
 *  reads terminate here behind X-API-Key. The census's "backend rejected the
 *  service API key" failure is a key-parity break between the BFF's vault key
 *  (DEMO_API_RESOURCE_SERVER_KEY) and the container's baked
 *  API_RESOURCE_SERVER_API_KEY. Probing a data route with a key fetched on the
 *  HOST is shell-truncation-prone (a vault warning line prepends to output);
 *  the parity check runs INSIDE each container instead. */
async function checkDataPlaneServers() {
  // 1. Demo API health (published :8082)
  try {
    const { status, body } = await fetchJson('http://localhost:8082/health');
    row(
      'data-plane:api-resource-server',
      status === 200 && body?.status === 'ok',
      `HTTP ${status} ${body?.status || ''}`,
      status === 200 ? '' : `docker logs ai-demo-api-resource-server; docker compose up -d api-resource-server`,
    );
  } catch (e) {
    row('data-plane:api-resource-server', false, e.cause?.code || e.message, `docker compose up -d api-resource-server`);
  }

  // 2. Key parity from the BFF's side: the BFF dispatches with its own env key;
  //    verify that EXACT key authenticates against :8082 from inside the BFF
  //    container (same network path apikey-dispatch uses). Probe JS is docker
  //    cp'd in — nested sh/node -e quoting through execSync has broken twice.
  const probeJs = [
    'const k = process.env.DEMO_API_RESOURCE_SERVER_KEY;',
    'if (!k) { console.log("DP_KEY missing"); process.exit(0); }',
    'fetch("http://api-resource-server:8082/mortgage", {',
    '  headers: { "X-API-Key": k }, signal: AbortSignal.timeout(8000),',
    '}).then((r) => console.log("DP_KEY", r.status))',
    '  .catch((e) => console.log("DP_KEY_NET", (e.cause && e.cause.code) || e.message || "err"));',
  ].join('\n');
  const tmp = `/tmp/health-gate-dataplane-${process.pid}.js`;
  fs.writeFileSync(tmp, probeJs);
  try {
    sh(`docker cp ${tmp} ai-demo-api-server:/tmp/health-gate-dataplane.js`);
    fs.unlinkSync(tmp);
    var probe = sh(
      `docker exec ai-demo-api-server sh -c 'node /tmp/health-gate-dataplane.js 2>&1 | grep DP_KEY; rm -f /tmp/health-gate-dataplane.js'`,
    );
  } catch (e) {
    var probe = { ok: false, out: `probe setup failed: ${e.message}` };
  }
  const okRow = probe.out.includes('DP_KEY 200') || probe.out.includes('DP_KEY 404');
  row(
    'data-plane:service-key-parity',
    okRow,
    (probe.out.match(/DP_KEY (\d+)/) || [])[1] ? `BFF key → Demo API HTTP ${(probe.out.match(/DP_KEY (\d+)/) || [])[1]}` : (probe.out.trim().split('\n')[0] || 'no output').slice(0, 120),
    probe.out.includes('DP_KEY 401')
      ? `Service-key MISMATCH: the BFF's DEMO_API_RESOURCE_SERVER_KEY is rejected by api-resource-server — the 'apikey-dispatch: backend rejected the service API key' failure. Fix: node demo_api_server/scripts/ensure-service-keys.js then docker compose up -d api-resource-server api-server (recreate bakes the key).`
      : (!okRow ? `Unexpected data-plane probe response (${probe.out.trim().slice(0, 140)}). Check DEMO_API_RESOURCE_SERVER_KEY (BFF .env + vault) vs API_RESOURCE_SERVER_API_KEY (root .env → container).` : ''),
  );

  // 3. mcp-resource-server (airlines/invest data) — internal-only, probe via compose DNS from the BFF. Temp-file pattern again.
  const probe2Js = [
    'fetch("http://mcp-resource-server:8081/health", { signal: AbortSignal.timeout(8000) })',
    '  .then((r) => r.json())',
    '  .then((j) => console.log("MRS", j.status || "?"))',
    '  .catch((e) => console.log("MRS", "FAIL", (e.cause && e.cause.code) || e.message || "err"));',
  ].join('\n');
  const tmp2 = `/tmp/health-gate-mrs-${process.pid}.js`;
  fs.writeFileSync(tmp2, probe2Js);
  try {
    sh(`docker cp ${tmp2} ai-demo-api-server:/tmp/health-gate-mrs.js`);
    fs.unlinkSync(tmp2);
    var probe2 = sh(
      `docker exec ai-demo-api-server sh -c 'node /tmp/health-gate-mrs.js 2>&1 | grep MRS; rm -f /tmp/health-gate-mrs.js'`,
    );
  } catch (e) {
    var probe2 = { ok: false, out: `probe setup failed: ${e.message}` };
  }
  const m2 = probe2.out.match(/MRS (\S+)/);
  const f2 = probe2.out.match(/MRS (\S+) (\S+)/);
  row(
    'data-plane:mcp-resource-server',
    !!m2 && m2[1] === 'ok',
    m2 ? m2[1] : (f2 ? f2[1] : 'no output'),
    m2 && m2[1] === 'ok' ? '' : `docker logs ai-demo-mcp-resource-server; docker compose up -d mcp-resource-server — airlines/invest chips fail without it.`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n=== AI-DEMO2 pre-demo health gate ===\n');
  const running = checkContainers();
  checkNetworks();
  checkStaleImages(running);
  await checkFlags();
  await checkPingOne();
  await checkGateway();
  await checkExchangeClient();
  await checkGatewayMcpRoute();
  checkGatewayScopeParity();
  await checkStep9Exchanger();
  await checkStep9Gate();
  await checkMcpGateway();
  await checkDataPlaneServers();

  let failed = 0;
  for (const r of rows) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok && r.fix) console.log(`      fix: ${r.fix}`);
  }
  console.log(`\n${rows.length - failed}/${rows.length} checks passed${failed ? ` — ${failed} FAILED. Do not start the demo.` : ' — clear to demo.'}\n`);
  process.exit(failed ? 1 : 0);
})();
