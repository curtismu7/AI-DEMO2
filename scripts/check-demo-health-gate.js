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
  'ai-demo-pingfederate',
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

  let failed = 0;
  for (const r of rows) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok && r.fix) console.log(`      fix: ${r.fix}`);
  }
  console.log(`\n${rows.length - failed}/${rows.length} checks passed${failed ? ` — ${failed} FAILED. Do not start the demo.` : ' — clear to demo.'}\n`);
  process.exit(failed ? 1 : 0);
})();
