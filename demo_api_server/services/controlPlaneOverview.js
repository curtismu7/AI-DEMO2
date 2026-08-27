'use strict';

/**
 * controlPlaneOverview — the five zones of the Agentic Control Plane, assembled
 * from services that already hold the data.
 *
 * Composes; does not re-read. Nothing is cached, so the page cannot show a
 * stale control plane — the same property that makes the registry trustworthy.
 *
 * FOUR source states, not two. `up: false` on the registry means "we asked and
 * it broke". A stub is neither up nor broken, and collapsing the two would make
 * every not-yet-wired card look like an outage and fire source-down forever:
 *
 *   live       asked, answered          → numbers, links
 *   down       asked, failed            → grey, error named, fires source-down
 *   not-wired  never connected          → stub, no numbers, fires nothing
 *   structural will not be connected    → gap state, declared fact only
 */

const agentRegistryService = require('./agentRegistryService');
const agentLifecycleEvents = require('./agentLifecycleEvents');
const { SERVER_INVENTORY } = require('../data/serverInventory');
const findings = require('./controlPlaneFindings');

/** Enforcement services are observed, not owned — in the reference architecture
 *  they sit outside the control-plane box, so they render as their own band
 *  rather than a sixth zone. Phase 2 fills these in. */
const ENFORCEMENT = [
  {
    id: 'p1az',
    name: 'Fine-Grained Authorization',
    state: 'not-wired',
    willShow: 'P1AZ decisions per agent, deny reasons, policy version',
    today: '/pingone-authorize',
  },
  {
    id: 'aigateway',
    name: 'AI Gateway',
    state: 'not-wired',
    willShow: 'which agents route through which gate, tool-level allow and deny',
    today: '/agent-gateway-inspector',
  },
  {
    id: 'privilege',
    name: 'Privilege',
    state: 'not-wired',
    willShow: 'LLM, MCP, A2A and AI Guard sub-gateway state, injected credentials',
    today: '/privilege-mcp-client',
  },
];

/** Run one source in isolation. A throw contributes `state: 'down'` with its
 *  reason — never an exception that costs the caller every other zone. */
async function readSource(name, fn, sources) {
  try {
    const value = await fn();
    sources[name] = { state: 'live' };
    return value;
  } catch (err) {
    sources[name] = { state: 'down', error: err?.message || String(err) };
    return null;
  }
}

function catalogZone() {
  const mcp = SERVER_INVENTORY.filter((s) => s.category === 'mcp');
  return {
    services: SERVER_INVENTORY.length,
    mcpServers: mcp.length,
    items: mcp.map((s) => ({ key: s.key, name: s.name, lang: s.lang })),
    links: [
      { label: 'Agent Builder', href: '/agent-builder' },
      { label: 'MCP Inspector', href: '/pingone-mcp-inspector' },
    ],
  };
}

function registryZone(registry) {
  const rows = registry?.rows || [];
  const bySource = rows.reduce((a, r) => (a[r.source] = (a[r.source] || 0) + 1, a), {});
  return {
    total: rows.length,
    bySource,
    byType: rows.reduce((a, r) => (a[r.identityType] = (a[r.identityType] || 0) + 1, a), {}),
    revoked: rows.filter((r) => r.status === 'revoked').length,
    drift: rows.filter((r) => r.scopeStatus === 'drift').length,
    unverified: rows.filter((r) => r.scopeStatus === 'unverified').length,
    links: [{ label: 'Open registry', href: '/agent-registry' }],
  };
}

function governanceZone(events, summary) {
  return {
    totalEvents: summary?.totalEvents || 0,
    byEventType: summary?.byEventType || {},
    recent: (events || []).slice(0, 5),
    links: [{ label: 'Kill-switch roster', href: '/ai-control-plane' }],
  };
}

/** Observability backends are declared rather than probed: their health lives in
 *  Grafana, and duplicating that probe here would be a second source of truth. */
function observabilityZone() {
  return {
    backends: [
      { name: 'Grafana', detail: 'dashboards over Prometheus' },
      { name: 'Jaeger', detail: 'distributed traces' },
      { name: 'Transaction trace', detail: 'one chain per correlation id' },
    ],
    links: [
      { label: 'Grafana', href: '/grafana' },
      { label: 'Agent & token flow history', href: '/agent-flow-inspector' },
    ],
  };
}

/**
 * Build the control-plane overview. Always resolves — never throws — so the
 * caller can render a partial view with the failures named.
 * @param {object} [req] Express request; only the session-scoped roster inside
 *   the registry needs it.
 */
async function buildOverview(req) {
  const sources = {};

  const registry = await readSource('registry', () => agentRegistryService.buildRegistry(req), sources);
  // Folded together: summary() reads the same LMDB store as query(), so one
  // store outage must yield one source-down finding, not two for the same cause.
  const lifecycle = await readSource('lifecycle', async () => ({
    events: agentLifecycleEvents.query({ limit: 200 }),
    summary: agentLifecycleEvents.summary(),
  }), sources);
  const events = lifecycle?.events || [];
  const summary = lifecycle?.summary || null;
  await readSource('catalog', async () => SERVER_INVENTORY, sources);

  // Not asked, so not up and not down.
  sources.discovery = { state: 'structural' };
  for (const card of ENFORCEMENT) sources[card.id] = { state: 'not-wired' };

  const computed = findings.evaluate({
    now: new Date(),
    rows: registry?.rows || [],
    events,
    sources,
  });

  return {
    generatedAt: new Date().toISOString(),
    sources,
    zones: {
      catalog: catalogZone(),
      registry: registryZone(registry),
      discovery: { surfaces: ['Browsers', 'Endpoints', 'Workloads'], wired: 0 },
      governance: governanceZone(events, summary),
      observability: observabilityZone(),
    },
    enforcement: ENFORCEMENT,
    findings: computed,
    declared: findings.DECLARED,
  };
}

module.exports = { buildOverview, ENFORCEMENT };
