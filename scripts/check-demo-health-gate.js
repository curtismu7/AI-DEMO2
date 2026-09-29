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

function sh(cmd, { timeoutMs = 15000 } = {}) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || e.message || '') };
  }
}

async function fetchJson(url, opts = {}) {
  const timeoutSignal = AbortSignal.timeout(10000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(url, { ...opts, signal });
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

function ensureMkcertRoot() {
  if (process.env.NODE_EXTRA_CA_CERTS !== undefined) return;
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

// ── 9b. A2A delegation chain (UC2) ───────────────────────────────────────────

/** UC2 pre-demo checks. Each of these failed SILENTLY during the 2026-09-26
 *  incident (a2a_unauthorized), invisible to every other gate row:
 *   1. a2a_gateway_audience unset in the BFF → exchange2 mints to a fallback
 *      audience the gateways reject (wrong-aud 401).
 *   2. The demo user's PingOne attribute a2aTenantId missing → the bearer gate
 *      (a2aPingOneBearer tenant check) rejects with a generic `unauthorized`.
 *   3. The A2A gateway resource's PingOne audience drifted to its NAME
 *      ("Super Banking A2A MCP Gateway"), so exchange2 tokens carry that aud.
 *      We probe the node gateway's accepted list for a match. */
async function checkA2aChain() {
  const running = sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim() === 'yes';
  if (!running) {
    row('a2a:config', false, 'BFF container not running', 'docker compose up -d demo-api-server');
    return;
  }

  // 1. BFF a2a_gateway_audience resolves.
  const cfg = inContainerProbe('ai-demo-api-server', [
    `const cs = require('/app/services/configStore');`,
    `(async () => { await cs.ensureInitialized();`,
    `  console.log('A2A_AUD', cs.getEffective('a2a_gateway_audience') || 'UNSET');`,
    `  process.exit(0); })().catch((e) => { console.log('A2A_AUD_ERR', e.message); process.exit(0); });`,
  ]);
  const aud = (cfg.find((l) => l.indexOf('A2A_AUD ') === 0) || '').split(' ')[1];
  row(
    'a2a:gateway-audience',
    !!aud && aud !== 'UNSET' && !cfg.some((l) => l.indexOf('A2A_AUD_ERR') === 0),
    aud === 'UNSET' ? 'a2a_gateway_audience unset in BFF config' : (aud || 'no output'),
    aud === 'UNSET' || !aud ? `Set A2A_GATEWAY_AUDIENCE=mcpgateway-a2a.ping.demo in demo_api_server/.env, then bash scripts/deploy-live.sh` : '',
  );

  // 2. Demo user's a2aTenantId attribute (bearer-gate tenant check).
  const tenant = inContainerProbe('ai-demo-api-server', [
    `process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';`,
    `const cs = require('/app/services/configStore');`,
    `(async () => { await cs.ensureInitialized();`,
    `  const envId = cs.getEffective('pingone_environment_id');`,
    `  const cid = cs.getEffective('pingone_worker_client_id');`,
    `  const sec = cs.getEffective('pingone_worker_client_secret');`,
    `  const auth = Buffer.from(cid + ':' + sec).toString('base64');`,
    `  const t = await (await fetch('https://auth.pingone.com/' + envId + '/as/token', { method: 'POST',`,
    `    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },`,
    `    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('p1:read:users') })).json();`,
    `  if (!t.access_token) { console.log('A2A_TENANT_ERR token: ' + JSON.stringify(t).slice(0, 120)); process.exit(0); }`,
    `  const un = cs.getEffective('demo_user_username') || cs.getEffective('pingone_test_user') || '';`,
    `  const filter = encodeURIComponent('username eq "' + un + '"');`,
    `  const users = await (await fetch('https://api.pingone.com/v1/environments/' + envId + '/users?filter=' + filter,`,
    `    { headers: { Authorization: 'Bearer ' + t.access_token } })).json();`,
    `  const u = users._embedded && users._embedded.users && users._embedded.users[0];`,
    `  const attr = u && u.a2aTenantId;`,
    `  if (!u) { console.log('A2A_TENANT_ERR user not found: ' + un); }`,
    `  else if (attr === envId) { console.log('A2A_TENANT_OK ' + attr); }`,
    `  else { console.log('A2A_TENANT_MISMATCH ' + (attr || '(missing)') + ' expected ' + envId); }`,
    `  process.exit(0); })().catch((e) => { console.log('A2A_TENANT_ERR ' + e.message); process.exit(0); });`,
  ]);
  // indexOf, not regex — the regex form misbehaved here (returned a non-matching
  // line); indexOf against the exact marker prefix is unambiguous.
  const tLine = tenant.find((l) => String(l).indexOf('A2A_TENANT_') === 0) || 'A2A_TENANT_ERR no output';
  if (tLine.indexOf('A2A_TENANT_OK') === 0) {
    row('a2a:tenant-attribute', true, 'demo user a2aTenantId matches env id');
  } else if (tLine.indexOf('A2A_TENANT_MISMATCH') === 0) {
    row('a2a:tenant-attribute', false, tLine.replace('A2A_TENANT_MISMATCH ', ''),
      `PATCH the demo user's a2aTenantId attribute to the environment id (see a2aTenantService.js)`);
  } else {
    row('a2a:tenant-attribute', false, tLine.replace('A2A_TENANT_ERR ', ''),
      `Verify worker client scopes (p1:read:users) and the demo user exists in the PingOne env`);
  }

  // 3. Node gateway accepts the A2A audience (PingOne drift tolerates the NAME).
  if (aud && aud !== 'UNSET') {
    const gwAudList = sh(`docker exec ai-demo-mcp-gateway printenv MCP_GW_RESOURCE_URI 2>/dev/null || true`).out.trim();
    const accepts = gwAudList.split(',').map((s) => s.trim()).filter(Boolean);
    const gwRunning = !!gwAudList;
    row(
      'a2a:gateway-accepts-audience',
      gwRunning && accepts.includes(aud),
      gwRunning
        ? (accepts.includes(aud) ? `node gateway accepts ${aud}` : `node gateway list lacks ${aud}`)
        : 'ai-demo-mcp-gateway not running (demo-auth profile off — by design)',
      gwRunning && !accepts.includes(aud)
        ? `Add ${aud} to MCP_GW_RESOURCE_URI for mcp-gateway in docker-compose.yml (comma list), then docker compose up -d mcp-gateway`
        : '',
    );
  }
}

// ── 9c. Cross-cutting config/process checks (all bit us on 2026-09-26) ──────

/** (A) The BFF's persisted oauth_provider. It silently flipped to
 *  'pingfederate' during the 2026-09-26 debugging session — TWICE via the
 *  /config admin page and ONCE via OAUTH_PROVIDER=pingfederate inside
 *  demo_api_server/.env. The .env case is the worst: getEffective() ranks
 *  env above LMDB, so configStore.setRaw fixes were silently shadowed on
 *  every restart. This row reports BOTH the effective provider and whether
 *  the .env/env layer is the source, so the flip can never hide again. */
async function checkBffOAuthProvider() {
  if (!sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim()) return;
  const probe = inContainerProbe('ai-demo-api-server', [
    `const cs = require('/app/services/configStore');`,
    `(async () => { await cs.ensureInitialized();`,
    `  console.log('OAUPROV ' + cs.getOAuthProvider());`,
    `  console.log('OAUENV ' + (process.env.OAUTH_PROVIDER || '(unset)'));`,
    `  process.exit(0); })().catch((e) => { console.log('OAUPROV_ERR ' + e.message); process.exit(0); });`,
  ]);
  const line = probe.find((l) => String(l).indexOf('OAUPROV') === 0) || 'OAUPROV_ERR no output';
  const envLine = (probe.find((l) => String(l).indexOf('OAUENV') === 0) || 'OAUENV (unset)').replace(/^OAUENV\s*/, '');
  const provider = line.replace(/^OAUPROV\s*/, '').trim();
  if (provider === 'pingone' && envLine !== 'pingfederate') {
    row('bff:oauth-provider', true, 'pingone' + (envLine !== '(unset)' ? ` (env=${envLine})` : ''));
    return;
  }
  const envNote = envLine === 'pingfederate'
    ? ` — CAUSE FOUND: OAUTH_PROVIDER=pingfederate is set in the container env (demo_api_server/.env line: OAUTH_PROVIDER=...). env OVERRIDES the LMDB configStore, so config-page/setRaw fixes are silently undone on every restart. Edit demo_api_server/.env to OAUTH_PROVIDER=pingone and recreate the BFF.`
    : '';
  row('bff:oauth-provider', false, `provider=${provider}` + (envLine !== '(unset)' ? ` env=${envLine}` : '') + ` — logins will hit ${provider === 'pingfederate' ? 'local PingFederate instead of PingOne' : 'an unsupported provider'}`,
    envNote || (provider === 'pingfederate'
      ? `Either switch back on the /config admin page, or surgically: docker exec ai-demo-api-server node -e "require('./services/configStore').setRaw({ oauth_provider: 'pingone' })" (ensureInitialized first), then docker restart ai-demo-api-server. Check PingFederate still has its OAuth clients if PF mode is intentional.`
      : `Set oauth_provider=pingone via the /config admin page, then restart the BFF.`));
}

/** (A2) Provider INTENT lock — the committed .demo-provider-intent.json is
 *  the SSOT for which provider the local stack should run. Drift between the
 *  intent and .env / docker-compose env is how the 2026-09-26 flip-flop war
 *  stayed invisible: each session's fix was silently undone by the other's
 *  restart. This row names the loser layer explicitly. */
function checkProviderLock() {
  const fs = require('fs');
  const path = require('path');
  const repo = path.resolve(__dirname, '..');
  let intent = null;
  try { intent = JSON.parse(fs.readFileSync(path.join(repo, '.demo-provider-intent.json'), 'utf8')); } catch (e) { /* fallthrough */ }
  if (!intent || !intent.provider) {
    row('provider-lock', false, 'no .demo-provider-intent.json — run: node scripts/pingone/demo-provider-lock.js set <provider> "<reason>"');
    return;
  }
  const readEnv = () => {
    try {
      const m = fs.readFileSync(path.join(repo, 'demo_api_server', '.env'), 'utf8').match(/^OAUTH_PROVIDER=(.*)$/m);
      return m ? m[1].trim() : '(unset)';
    } catch (e) { return '(no .env)'; }
  };
  const readCompose = () => {
    try {
      const m = fs.readFileSync(path.join(repo, 'docker-compose.yml'), 'utf8').match(/^\s*OAUTH_PROVIDER:\s*(\S+)/m);
      return m ? m[1].trim() : '(unset)';
    } catch (e) { return '(no compose)'; }
  };
  const envP = readEnv();
  const composeP = readCompose();
  const drift = [];
  if (envP !== intent.provider && envP !== '(unset)') drift.push(`.env=${envP}`);
  if (composeP !== intent.provider && composeP !== '(unset)') drift.push(`compose=${composeP}`);
  row('provider-lock', drift.length === 0,
    drift.length === 0
      ? `intent=${intent.provider} honored (.env=${envP}, compose=${composeP})`
      : `intent=${intent.provider} but ${drift.join(', ')} — deliberate? node scripts/pingone/demo-provider-lock.js set ${intent.provider === 'pingone' ? 'pingone' : 'pingfederate'} "<reason>" then recreate the BFF`,
    drift.length === 0 ? '' : `env values outrank the LMDB configStore; A2A breaks under pingfederate (no act claim). Align the layers or update the intent file.`);
}

/** (B) The PingOne A2A gateway resource's audience attribute — the ROOT CAUSE
 *  of today's wrong-aud outage. When PingOne's resource has audience=NAME,
 *  every exchange2 token mints with that aud and no gateway accepts it. The
 *  other a2a rows only see the downstream symptoms; this reads the resource
 *  itself so the drift is named at the source. */
async function checkPingOneA2aResourceAudience() {
  if (!sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim()) return;
  const probe = inContainerProbe('ai-demo-api-server', [
    `process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';`,
    `const cs = require('/app/services/configStore');`,
    `(async () => { await cs.ensureInitialized();`,
    `  const envId = cs.getEffective('pingone_environment_id');`,
    `  const cid = cs.getEffective('pingone_worker_client_id');`,
    `  const sec = cs.getEffective('pingone_worker_client_secret');`,
    `  const auth = Buffer.from(cid + ':' + sec).toString('base64');`,
    `  const want = cs.getEffective('a2a_gateway_audience') || 'mcpgateway-a2a.ping.demo';`,
    `  const t = await (await fetch('https://auth.pingone.com/' + envId + '/as/token', { method: 'POST',`,
    `    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },`,
    `    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('p1:read:resource') })).json();`,
    `  if (!t.access_token) { console.log('A2ARES_ERR token: ' + JSON.stringify(t).slice(0, 120)); process.exit(0); }`,
    `  const list = await (await fetch('https://api.pingone.com/v1/environments/' + envId + '/resources?limit=100',`,
    `    { headers: { Authorization: 'Bearer ' + t.access_token } })).json();`,
    `  const all = (list._embedded && list._embedded.resources) || [];`,
    `  const rs = all.find((r) => r.audience === want || (r.name || '').indexOf('A2A MCP Gateway') >= 0);`,
    `  if (!rs) { console.log('A2ARES_ERR resource not found for audience ' + want); process.exit(0); }`,
    `  console.log('A2ARES ' + JSON.stringify({ name: rs.name, audience: rs.audience, want }));`,
    `  process.exit(0); })().catch((e) => { console.log('A2ARES_ERR ' + e.message); process.exit(0); });`,
  ]);
  const line = probe.find((l) => String(l).indexOf('A2ARES') === 0) || 'A2ARES_ERR no output';
  if (line.indexOf('A2ARES_ERR') === 0) {
    row('a2a:resource-audience', false, line.replace('A2ARES_ERR ', ''),
      `Verify the worker client has p1:read:resource and the A2A MCP Gateway resource exists in the PingOne env`);
    return;
  }
  let parsed = null;
  try { parsed = JSON.parse(line.replace(/^A2ARES\s*/, '')); } catch (e) { /* fallthrough */ }
  const drifted = !!(parsed && parsed.audience !== parsed.want);
  // AUTO-REPAIR (2026-09-26): the drift class is fixed one PUT away — the
  // worker principal CAN write /resources (PATCH is what lies with a 403).
  // When drifted, attempt the repair in-line and re-read. Sets
  // DEMO_HEALTH_GATE_NO_AUTOREPAIR=1 to opt out (e.g. auditing the drift).
  if (drifted && !process.env.DEMO_HEALTH_GATE_NO_AUTOREPAIR) {
    const repair = sh(`node scripts/pingone/fix-a2a-resource-audience.js 2>&1 || true`);
    const repaired = /PATCHED — audience is now|OK — resource .* Nothing to do/.test(repair.out);
    if (repaired) {
      // Re-probe so this run's verdict reflects the repaired state.
      const reprobe = inContainerProbe('ai-demo-api-server', [
        `process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';`,
        `const cs = require('/app/services/configStore');`,
        `(async () => { await cs.ensureInitialized();`,
        `  const envId = cs.getEffective('pingone_environment_id');`,
        `  const cid = cs.getEffective('pingone_worker_client_id');`,
        `  const sec = cs.getEffective('pingone_worker_client_secret');`,
        `  const auth = Buffer.from(cid + ':' + sec).toString('base64');`,
        `  const want = cs.getEffective('a2a_gateway_audience') || 'mcpgateway-a2a.ping.demo';`,
        `  const t = await (await fetch('https://auth.pingone.com/' + envId + '/as/token', { method: 'POST',`,
        `    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },`,
        `    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('p1:read:resource') })).json();`,
        `  const list = await (await fetch('https://api.pingone.com/v1/environments/' + envId + '/resources?limit=100',`,
        `    { headers: { Authorization: 'Bearer ' + t.access_token } })).json();`,
        `  const rs = ((list._embedded && list._embedded.resources) || []).find((r) => r.audience === want || (r.name || '').indexOf('A2A MCP Gateway') >= 0);`,
        `  console.log('A2ARES ' + JSON.stringify({ name: rs && rs.name, audience: rs && rs.audience, want }));`,
        `  process.exit(0); })().catch((e) => { console.log('A2ARES_ERR ' + e.message); process.exit(0); });`,
      ]);
      const reline = reprobe.find((l) => String(l).indexOf('A2ARES') === 0) || line;
      try { parsed = JSON.parse(reline.replace(/^A2ARES\s*/, '')); } catch (e) { /* keep old */ }
      const stillDrifted = !!(parsed && parsed.audience !== parsed.want);
      row('a2a:resource-audience', !stillDrifted,
        stillDrifted
          ? `AUTO-REPAIR attempted but drift persists: audience=${JSON.stringify(parsed && parsed.audience)}`
          : `AUTO-REPAIRED: audience restored to ${parsed.want}`,
        stillDrifted ? `Manual: node scripts/pingone/fix-a2a-resource-audience.js` : '');
      return;
    }
  }
  // The drift is TOLERATED client-side (mcpGatewayClient/mcpToolPipeline pin
  // the NAME-form aud to the node gateway, whose MCP_GW_RESOURCE_URI accepts
  // it), so it does not block the demo — but it must stay visible: it is the
  // root cause, and a gateway env change can silently revoke the tolerance.
  const detail = drifted
    ? `DRIFT (tolerated): PingOne resource "${parsed && parsed.name}" audience=${JSON.stringify(parsed && parsed.audience)} — tokens mint with this aud; client-side pins route them to the node gateway`
    : `resource audience matches ${parsed.want}`;
  row(
    'a2a:resource-audience',
    !!(parsed && (parsed.audience === parsed.want || drifted)),
    detail,
    drifted
      ? `Fix at the source when convenient: PATCH the resource's audience to ${parsed && parsed.want} in the PingOne console (Admin → Resources). Do NOT remove the NAME from MCP_GW_RESOURCE_URI until this is fixed.`
      : '',
  );
}

/** (B4) A2A/authorize SOT integrity — the vault must carry a current
 *  A2A_AUTHORIZE_SOT entry describing audiences, act-chain depths, exchanger
 *  client IDs, and auth methods. Refresh it with
 *  scripts/pingone/write-a2a-sot.js when the contract changes. */
async function checkA2aSot() {
  if (!sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim()) return;
  const probe = inContainerProbe('ai-demo-api-server', [
    `const { openVault } = require('/app/lib/vault');`,
    `(async () => {`,
    `  const vp = process.env.VAULT_PATH || '/repo/secrets.vault';`,
    `  const vault = await openVault(vp, process.env.VAULT_PASSWORD, { caller: 'health-gate-sot' });`,
    `  let raw;`,
    `  try { raw = vault.read('A2A_AUTHORIZE_SOT'); } catch (e) { console.log('SOT_ERR ' + e.message); process.exit(0); }`,
    `  const sot = JSON.parse(raw);`,
    `  const ok = sot.version >= 1 && sot.audiences && sot.audiences.a2aGateway && sot.generalist && sot.generalist.clientId`,
    `    && sot.bearerGate && sot.bearerGate.requiredActDepth === 1 && Object.keys(sot.audiences.intermediates || {}).length >= 10;`,
    `  console.log('SOT ' + JSON.stringify({`,
    `    ver: sot.version, updated: sot.updatedAt,`,
    `    a2aGateway: sot.audiences && sot.audiences.a2aGateway,`,
    `    generalist: sot.generalist && sot.generalist.clientId,`,
    `    intermediates: sot.audiences && sot.audiences.intermediates ? Object.keys(sot.audiences.intermediates).length : 0,`,
    `    actDepth: sot.bearerGate && sot.bearerGate.requiredActDepth,`,
    `    ok`,
    `  }));`,
    `  vault.close(); process.exit(0);`,
    `})().catch((e) => { console.log('SOT_ERR ' + e.message); process.exit(0); });`,
  ]);
  const line = (probe.find((l) => { const t = String(l); return t.indexOf('SOT ') === 0 || t.indexOf('SOT_ERR') === 0; }) || 'SOT_ERR no output');
  if (line.indexOf('SOT_ERR') === 0) {
    row('a2a:sot', false, line.replace('SOT_ERR ', ''),
      'Refresh the SOT: node scripts/pingone/write-a2a-sot.js (host-side; the container cannot save — / is not writable by appuser)');
    return;
  }
  let parsed = null;
  try { parsed = JSON.parse(line.replace(/^SOT\s*/, '')); } catch (e) { /* fallthrough */ }
  row('a2a:sot', !!(parsed && parsed.ok),
    parsed && parsed.ok
      ? `SOT v${parsed.ver} in vault — a2aGateway=${parsed.a2aGateway}, generalist=${String(parsed.generalist).slice(0, 8)}…, ${parsed.intermediates} intermediates, actDepth=${parsed.actDepth}`
      : `SOT invalid: ${line.replace(/^SOT\s*/, '').slice(0, 140)}`,
    parsed && parsed.ok ? '' : 'Regenerate: node scripts/pingone/write-a2a-sot.js');
}

/** (B2) Live exchange aud-form assertion — mints a REAL RFC 8693 exchange
 *  against the A2A resources and asserts the returned aud is URI-form, i.e.
 *  NO aud value is a resource display NAME. The static row above reads the
 *  resource's configured audience attr; this proves what PingOne ACTUALLY
 *  mints (the two can diverge via resource policies/scope bindings).
 *  Locks in detection for the whole drift class. */
async function checkPingOneA2aAudForm() {
  if (!sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim()) return;
  const probe = inContainerProbe('ai-demo-api-server', [
    `process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';`,
    `const cs = require('/app/services/configStore');`,
    `(async () => { await cs.ensureInitialized();`,
    `  const envId = cs.getEffective('pingone_environment_id');`,
    `  const want = cs.getEffective('a2a_gateway_audience') || 'mcpgateway-a2a.ping.demo';`,
    `  const wcid = cs.getEffective('pingone_worker_client_id');`,
    `  const wsec = cs.getEffective('pingone_worker_client_secret');`,
    `  const wauth = Buffer.from(wcid + ':' + wsec).toString('base64');`,
    `  const wt = await (await fetch('https://auth.pingone.com/' + envId + '/as/token', { method: 'POST',`,
    `    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + wauth },`,
    `    body: 'grant_type=client_credentials' })).json();`,
    `  if (!wt.access_token) { console.log('AUDFORM_ERR subject token: ' + JSON.stringify(wt).slice(0, 150)); process.exit(0); }`,
    `  const cid = cs.getEffective('pingone_records_agent_client_id');`,
    `  const sec = cs.getEffective('pingone_records_agent_client_secret');`,
    `  if (!cid || !sec) { console.log('AUDFORM_SOFT missing records agent creds'); process.exit(0); }`,
    `  const body = new URLSearchParams({`,
    `    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',`,
    `    subject_token: wt.access_token,`,
    `    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',`,
    `    audience: want,`,
    `    scope: 'agent:invoke:records',`,
    `    client_id: cid, client_secret: sec });`,
    `  const ex = await (await fetch('https://auth.pingone.com/' + envId + '/as/token', { method: 'POST',`,
    `    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })).json();`,
    `  if (!ex.access_token) { console.log('AUDFORM_SOFT exchange failed: ' + JSON.stringify(ex).slice(0, 200)); process.exit(0); }`,
    `  const claims = JSON.parse(Buffer.from(ex.access_token.split('.')[1], 'base64url').toString());`,
    `  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];`,
    `  console.log('AUDFORM ' + JSON.stringify({ aud, want }));`,
    `  process.exit(0); })().catch((e) => { console.log('AUDFORM_ERR ' + e.message); process.exit(0); });`,
  ]);
  const line = probe.find((l) => String(l).indexOf('AUDFORM') === 0) || 'AUDFORM_ERR no output';
  if (line.indexOf('AUDFORM_SOFT') === 0) {
    // Exchange refused (creds/scope drift) — not itself a demo blocker (the
    // deep probe catches real chain failures) but must stay visible.
    row('a2a:aud-form', false, line.replace('AUDFORM_SOFT ', ''),
      `Check pingone_records_agent_client_* creds and the agent:invoke:records scope grant on the records specialist app`);
    return;
  }
  if (line.indexOf('AUDFORM_ERR') === 0) {
    row('a2a:aud-form', false, line.replace('AUDFORM_ERR ', ''),
      `Verify worker + records agent client credentials in the BFF config`);
    return;
  }
  let parsed = null;
  try { parsed = JSON.parse(line.replace(/^AUDFORM\s*/, '')); } catch (e) { /* fallthrough */ }
  const aud = (parsed && parsed.aud) || [];
  const nameForm = aud.some((a) => !/^https?:\/\//.test(a) && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(a));
  const uriForm = !nameForm && aud.length > 0;
  row(
    'a2a:aud-form',
    uriForm,
    uriForm
      ? `exchange minted URI-form aud: ${aud.join(', ')}`
      : `NAME-form aud minted: ${JSON.stringify(aud)} — the PingOne drift class is live; tokens will be rejected by URI-only aud validators`,
    uriForm
      ? ''
      : `Fix the PingOne resource audience (see a2a:resource-audience row). Client-side NAME-form pins tolerate this, but fix the source.`,
  );
}

/** (C) Stale BFF process — today a correctly-patched file sat inert in a
 *  running node process for ~40 minutes while every debug signal said "fixed".
 *  The BFF's /app is now BIND-MOUNTED (PR #295), so the container always sees
 *  the working tree — but node does not hot-reload, so the PROCESS can still
 *  be older than the code. Compare the node process's start time against the
 *  newest mtime among the A2A-critical files. */
function checkBffCodeDrift() {
  if (!sh("docker ps --format '{{.Names}}' | grep -qx ai-demo-api-server && echo yes").out.trim()) return;
  const procEtimeRaw = sh(`docker exec ai-demo-api-server sh -c 'ps -o pid,etime | awk "NR==2{print \\$2}"' 2>/dev/null`).out.trim();
  if (!procEtimeRaw) {
    row('bff:code-drift', true, 'could not read BFF process uptime (skipped)');
    return;
  }
  // etime = [[dd-]hh:]mm:ss → seconds
  const parts = procEtimeRaw.split(':').map((n) => parseInt(n, 10) || 0);
  const procAgeSec = parts.length === 3
    ? parts[0] * 86400 + parts[1] * 3600 + parts[2]
    : parts[0] * 60 + parts[1];
  const nowSec = Math.floor(Date.now() / 1000);
  const files = [
    'services/mcpToolPipeline.js',
    'services/mcpGatewayClient.js',
    'services/a2aProtocolClient.js',
    'services/a2aDelegationService.js',
    'middleware/a2aPingOneBearer.js',
  ];
  let newestMtime = 0;
  let newestFile = '';
  for (const f of files) {
    const p = path.join(REPO, 'demo_api_server', f);
    if (!fs.existsSync(p)) continue;
    const m = Math.floor(fs.statSync(p).mtimeMs / 1000);
    if (m > newestMtime) { newestMtime = m; newestFile = f; }
  }
  const procStartedAt = nowSec - procAgeSec;
  const stale = newestMtime > procStartedAt + 5; // 5s grace for docker-start ordering
  row(
    'bff:code-drift',
    !stale,
    stale
      ? `STALE PROCESS: ${newestFile} modified ${Math.floor((procStartedAt === 0 ? 0 : (newestMtime - procStartedAt) / 60))} min after the BFF started — the running node does NOT have this code`
      : `BFF process started after the newest watched file (${newestFile || 'n/a'})`,
    stale ? `docker restart ai-demo-api-server — node does not hot-reload; the bind-mounted file changed after process start` : '',
  );
}

/** (D) Deep probe — the only check that proves the WHOLE chain executes: real
 *  headless login → invoke → evidence chain scored. Static rows above can all
 *  be green while a rotated secret, a stripped token-policy claim, or a
 *  missing scope grant still kills UC2 at runtime. Opt-in because it costs
 *  20-60s and mints real tokens. */
function checkUc2DeepProbe() {
  if (String(process.env.DEMO_HEALTH_GATE_FULL || '') !== '1') {
    row('a2a:deep-probe', true, 'skipped (set DEMO_HEALTH_GATE_FULL=1 to run the real UC2 invoke)');
    return;
  }
  // Note: this runs the spec WITHOUT the pipe-to-tail (a pipe would swallow the
  // exit status) and with a generous timeout — login + invoke takes 20-60s.
  const probe = sh(
    `cd demo_api_ui && npx playwright test tests/e2e/uc2-a2a-delegation.real.spec.js --config=playwright.real.config.js --reporter=line`,
    { timeoutMs: 300000 },
  );
  const passed = /passed/.test(probe.out) && !/failed|did not run/.test(probe.out);
  row(
    'a2a:deep-probe',
    passed,
    passed ? 'real UC2 invoke completed with the full evidence chain' : probe.out.trim().slice(0, 200) || 'no output',
    passed ? '' : `Run cd demo_api_ui && npx playwright test tests/e2e/uc2-a2a-delegation.real.spec.js --config=playwright.real.config.js and read the failure; then check docker logs ai-demo-api-server for the failing hop.`,
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

// ── 12. LLM/agent tier: llm-proxy, agent-service, hitl, langchain-agent ─────

/** In-container HTTP probe helper. langchain-agent's :8890 listener binds
 *  loopback inside its own container, and api-resource-server is HTTP on the
 *  compose network — so tier probes exec INSIDE their target container.
 *  interpreter: 'node' (default) or 'python' (langchain-agent is a python
 *  container with no node and a read-only /tmp). Code ships base64-encoded
 *  through `interpreter -c` — no temp file, no quoting hazards at any layer. */
function inContainerProbe(container, lines, { interpreter = 'node' } = {}) {
  const b64 = Buffer.from(lines.join('\n')).toString('base64');
  const runner = interpreter === 'python'
    ? `python3 -c "import base64;exec(base64.b64decode('${b64}').decode())"`
    : `node -e "eval(Buffer.from('${b64}','base64').toString())"`;
  const out = sh(`docker exec ${container} ${runner} 2>&1`);
  return out.out.trim().split('\n').filter(Boolean);
}

async function checkLlmTier() {
  // 1. llm-proxy (host llama.cpp front) — /health reports per-model health.
  //    A model with healthy:false or a swapped/pending mode kills LLM-mode demos.
  try {
    const { status, body } = await fetchJson('http://localhost:8090/health');
    const models = Array.isArray(body?.models) ? body.models : [];
    // pinOnly tiers (e.g. llama-3-groq-8b-tool-use, experimental) are never
    // substitution targets and only reachable via an explicit pin — an
    // unhealthy pinOnly model is a note, not a demo blocker (router.js ~L122).
    const PIN_ONLY = new Set(['llama-3-groq-8b-tool-use']);
    const unhealthy = models.filter((m) => m.healthy === false && !PIN_ONLY.has(m.name)).map((m) => m.name);
    const unhealthyPinned = models.filter((m) => m.healthy === false && PIN_ONLY.has(m.name)).map((m) => m.name);
    row(
      'llm:proxy',
      status === 200 && body?.status === 'healthy' && unhealthy.length === 0,
      unhealthy.length
        ? `unhealthy models: ${unhealthy.join(', ')}`
        : `mode=${body?.mode || '?'} models=${models.length} all healthy${unhealthyPinned.length ? ` (pinOnly ${unhealthyPinned.join(', ')} down — note only)` : ''}`,
      unhealthy.length ? `Restart host llama.cpp: ./run-docker.sh llamacpp restart — LLM-mode demos fail or fall back to heuristics with an unhealthy model.` : '',
    );
  } catch (e) {
    row('llm:proxy', false, e.cause?.code || e.message, `Host llama.cpp down: ./run-docker.sh llamacpp restart`);
  }

  // 2. agent-service /health (has its own checks subobject).
  try {
    const { status, body } = await fetchJson('http://localhost:3016/health');
    const checks = body?.checks || {};
    // checks.prompts is a PromptSource enum — 'primary' is the BEST state
    // (SOURCE_RANK 0: primary > src_fallback > inline_fallback), not 'ok'.
    const bad = Object.entries(checks).filter(([k, v]) =>
      k === 'prompts' ? v !== 'primary' : v !== 'ok',
    ).map(([k, v]) => `${k}=${v}`);
    row(
      'llm:agent-service',
      status === 200 && body?.status === 'ok' && bad.length === 0,
      bad.length ? bad.join(', ') : `status=ok (${Object.keys(checks).length} checks, prompts=primary)`,
      bad.length ? `docker logs ai-demo-agent-service — 'prompts' below primary (src_fallback/inline_fallback) means the image is stale or its prompt mount broke (see image: rows above).` : '',
    );
  } catch (e) {
    row('llm:agent-service', false, e.cause?.code || e.message, `docker logs ai-demo-agent-server; docker compose up -d agent-service`);
  }

  // 3. hitl-service /health.
  try {
    const { status, body } = await fetchJson('http://localhost:3009/health');
    const bad = Object.entries(body?.checks || {}).filter(([, v]) => v !== 'ok');
    row(
      'llm:hitl-service',
      status === 200 && body?.status === 'ok' && bad.length === 0,
      bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(', ') : 'status=ok',
      bad.length || status !== 200 ? `docker logs ai-demo-hitl-service — HITL consent/approval demos fail without it.` : '',
    );
  } catch (e) {
    row('llm:hitl-service', false, e.cause?.code || e.message, `docker compose up -d hitl-service — HITL consent demos fail without it.`);
  }

  // 4. langchain-agent :8890 — listener binds loopback inside the container AND
  //    it is a PYTHON container (no node), so probe with python urllib in-exec.
  const lc = inContainerProbe('ai-demo-langchain-agent', [
    'import urllib.request, json',
    'try:',
    '    r = urllib.request.urlopen("http://localhost:8890/health", timeout=5)',
    '    print("LC", json.loads(r.read()).get("status", "?"))',
    'except Exception as e:',
    '    print("LC FAIL", getattr(e, "reason", e))',
  ], { interpreter: 'python' });
  const lcLine = (lc.find((l) => l.startsWith('LC')) || 'LC no output').replace(/^LC /, '');
  row(
    'llm:langchain-agent',
    lcLine === 'healthy',
    lcLine,
    lcLine !== 'healthy' ? `docker logs ai-demo-langchain-agent — the LLM agent brain (8888 SSE) is backed by this process. Start: docker compose up -d langchain-agent` : '',
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureMkcertRoot();
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
  await checkA2aChain();
  await checkBffOAuthProvider();
  checkProviderLock();
  await checkPingOneA2aResourceAudience();
  await checkA2aSot();
  await checkPingOneA2aAudForm();
  checkBffCodeDrift();
  checkUc2DeepProbe();
  await checkMcpGateway();
  await checkDataPlaneServers();
  await checkLlmTier();

  let failed = 0;
  for (const r of rows) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok && r.fix) console.log(`      fix: ${r.fix}`);
  }
  console.log(`\n${rows.length - failed}/${rows.length} checks passed${failed ? ` — ${failed} FAILED. Do not start the demo.` : ' — clear to demo.'}\n`);
  process.exit(failed ? 1 : 0);
}

module.exports = { fetchJson, checkContainers, checkNetworks, ensureMkcertRoot };

if (require.main === module) {
  main().catch((err) => {
    console.error(`health gate failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
