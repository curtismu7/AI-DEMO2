'use strict';

/**
 * agentRegistryService — one view over the identity stores that already hold
 * real data, so "what non-human identities exist here, and are they drifting?"
 * has a single answer instead of nine disconnected ones.
 *
 * Deliberately NOT a new store. Every row is read live from an existing source;
 * nothing is duplicated or cached, so the registry cannot go stale.
 *
 * Shape copied from data/serverInventory.js + GET /api/health/inventory: a
 * source list, read independently, merged into an always-200 payload carrying
 * per-source { up, error }. PingOne is a live HTTP call and WILL be down
 * sometimes; the page must degrade to the other sources rather than 500.
 */

const agentBuilderService = require('./agentBuilderService');
const oauthClientRegistry = require('./oauthClientRegistry');
const a2aAgentCardService = require('./a2aAgentCardService');
const agentLifecycleEvents = require('./agentLifecycleEvents');
const demoAgentRoster = require('./controlPlane/demoAgentRoster');
const scopeTopology = require('./scopeTopology');

/**
 * Run one source in isolation. A source that throws contributes `up: false`
 * and zero rows — never an exception that costs the caller every other source.
 */
async function readSource(name, fn, out) {
  try {
    const rows = await fn();
    out.sources[name] = { up: true, rows: rows.length };
    out.rows.push(...rows);
  } catch (err) {
    out.sources[name] = { up: false, rows: 0, error: err?.message || String(err) };
  }
}

/** Lifecycle is per-row and best-effort: a missing trail must not drop the row. */
function lifecycleFor(agentId) {
  try {
    return (agentLifecycleEvents.query({ agentId, limit: 5 }) || []).slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Expected scopes come from scope-topology.json (the SSOT); granted scopes come
 * from the live PingOne grants. The gap between them is the governance signal.
 */
function scopeDriftFor(appName, grantedScopes) {
  let expected = [];
  try {
    expected = scopeTopology.appGrantedScopes(appName) || [];
  } catch {
    expected = [];
  }
  const granted = new Set(grantedScopes);
  const missing = expected.filter((s) => !granted.has(s));
  return { expectedScopes: expected, missingScopes: missing, scopeDrift: missing.length > 0 };
}

/** PingOne applications — the authoritative agent inventory. */
async function pingOneAgents() {
  const apps = await agentBuilderService.listEnvironmentAgents();
  return Promise.all(apps.map(async (app) => {
    let granted = [];
    try {
      const grants = await agentBuilderService.getAgentGrants(app.id);
      granted = Object.values(grants || {}).flat();
    } catch {
      granted = [];
    }
    return {
      id: app.id,
      name: app.name,
      identityType: 'agent',
      source: 'pingone',
      credentialType: (app.grantTypes || []).join(', ') || null,
      status: app.enabled ? 'active' : 'disabled',
      builderCreated: !!app.builderCreated,
      grantedScopes: granted,
      ...scopeDriftFor(app.name, granted),
      lifecycle: lifecycleFor(app.id),
    };
  }));
}

/**
 * Demo-issued OAuth clients. These are `client_credentials` only by
 * construction, which makes them workload identities — the NHI half of the
 * diagram's Workload IDP box, as a filter over this registry rather than a
 * separate inventory.
 */
function demoRegistryClients() {
  const clients = oauthClientRegistry.listClients() || [];
  return clients.map((c) => ({
    id: c.client_id,
    name: c.client_name,
    identityType: (c.grant_types || []).includes('client_credentials') ? 'workload' : 'agent',
    source: 'demo-registry',
    credentialType: (c.grant_types || []).join(', ') || null,
    status: c.status || 'active',
    grantedScopes: typeof c.scope === 'string' ? c.scope.split(/\s+/).filter(Boolean) : [],
    expectedScopes: [],
    missingScopes: [],
    // Not in scope-topology — these are issued at runtime, so there is no
    // declared expectation to drift from.
    scopeDrift: false,
    lastUsed: c.last_used || null,
    usageCount: c.usage_count || 0,
    lifecycle: lifecycleFor(c.client_id),
  }));
}

/**
 * A2A specialists — real computed Agent Cards.
 *
 * buildAllSpecialistAgentCards returns an OBJECT KEYED BY VERTICAL, not an
 * array. Treating it as an array shipped `cards.map is not a function`, which
 * surfaced only as "1 source unavailable" in the browser.
 *
 * Rows are keyed by vertical rather than card name because names are NOT
 * unique — retail and abercrombie-fitch are both "Purchase History Specialist".
 */
function a2aSpecialists() {
  const byVertical = a2aAgentCardService.buildAllSpecialistAgentCards() || {};
  return Object.entries(byVertical)
    .filter(([, card]) => card)
    .map(([vertical, card]) => ({
      id: `a2a:${vertical}`,
      name: card.name,
      vertical,
      identityType: 'agent',
      source: 'a2a',
      credentialType: 'pingone-bearer',
      status: 'active',
      skills: (card.skills || []).map((s) => s.id).filter(Boolean),
      grantedScopes: [],
      expectedScopes: [],
      missingScopes: [],
      scopeDrift: false,
      lifecycle: [],
    }));
}

/**
 * Runtime agents — the identities the control plane actually governs, and the
 * only ones the lifecycle store has ever held history for.
 *
 * Every lifecycle emitter (killSwitchService, controlPlane) keys on a runtime
 * agent handle — 'default-agent', 'demo-agent', 'user:<uuid>' — while the
 * other sources here key on PingOne application UUIDs and vertical names.
 * Those namespaces do not overlap, so before this source existed the registry
 * was joined to the one store it shared no keys with and every Lifecycle tab
 * rendered empty.
 *
 * Two inputs, unioned and deduped by id:
 *  - the seeded control-plane roster (ChatGPT, Copilot Studio, …), which needs
 *    the request because it is session-scoped;
 *  - every distinct agentId in the event log, so an identity the demo has
 *    governance history for is listed even when it is on no roster.
 */
function runtimeAgents(req) {
  const rows = new Map();

  // Roster first, so its richer metadata wins over the event-derived stub.
  if (req) {
    for (const a of demoAgentRoster.getRoster(req) || []) {
      rows.set(a.id, {
        id: a.id,
        name: a.label || a.id,
        identityType: 'external',
        source: 'runtime',
        credentialType: a.sourceLabel ? `platform: ${a.sourceLabel}` : null,
        status: a.status || 'active',
        grantedScopes: [],
        expectedScopes: [],
        missingScopes: [],
        scopeDrift: false,
        lifecycle: lifecycleFor(a.id),
      });
    }
  }

  for (const ev of agentLifecycleEvents.query({ limit: 500 }) || []) {
    if (!ev.agentId || rows.has(ev.agentId)) continue;
    const history = lifecycleFor(ev.agentId);
    rows.set(ev.agentId, {
      id: ev.agentId,
      name: ev.agentLabel || ev.agentId,
      identityType: 'agent',
      source: 'runtime',
      credentialType: null,
      // query() returns newest-first, so the head of the history is current.
      status: history[0]?.eventType === 'leaver' ? 'revoked' : 'active',
      grantedScopes: [],
      expectedScopes: [],
      missingScopes: [],
      scopeDrift: false,
      lifecycle: history,
    });
  }

  return [...rows.values()];
}

/**
 * Build the registry. Always resolves — never throws — so a caller can render
 * a partial view with the failures named.
 * @param {object} [req] Express request; only the session-scoped roster needs
 *   it, so a cron or CLI caller still gets every other source.
 * @returns {Promise<{ generatedAt: string, sources: object, rows: object[] }>}
 */
async function buildRegistry(req) {
  const out = { generatedAt: new Date().toISOString(), sources: {}, rows: [] };

  await readSource('pingone', pingOneAgents, out);
  await readSource('demoRegistry', async () => demoRegistryClients(), out);
  await readSource('a2a', async () => a2aSpecialists(), out);
  await readSource('runtime', async () => runtimeAgents(req), out);

  return out;
}

module.exports = { buildRegistry };
