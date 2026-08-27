'use strict';

/**
 * Agent registry: one view over the identity stores that already hold real data.
 *
 * Two properties make this a registry rather than a list, and both are tested
 * here because both are easy to lose later:
 *
 *  - It DEGRADES per source. PingOne is a live HTTP call; if it is down the
 *    page must still render every other source rather than 500. Copied from the
 *    serverInventory / GET /api/health/inventory pattern.
 *  - It reports SCOPE DRIFT. Expected scopes (scope-topology, the SSOT) versus
 *    actually-granted scopes is real governance signal from data that already
 *    exists, and is the column worth building the page for.
 */

jest.mock('../services/agentBuilderService', () => ({
  listEnvironmentAgents: jest.fn(),
  getAgentGrants: jest.fn(),
}));
jest.mock('../services/oauthClientRegistry', () => ({ listClients: jest.fn() }));
jest.mock('../services/controlPlane/demoAgentRoster', () => ({ getRoster: jest.fn() }));
jest.mock('../services/a2aAgentCardService', () => ({ buildAllSpecialistAgentCards: jest.fn() }));
jest.mock('../services/agentLifecycleEvents', () => ({ query: jest.fn(), emit: jest.fn() }));
jest.mock('../services/scopeTopology', () => ({
  allApps: jest.fn(),
  appGrantedScopes: jest.fn(),
}));

const agentBuilderService = require('../services/agentBuilderService');
const oauthClientRegistry = require('../services/oauthClientRegistry');
const demoAgentRoster = require('../services/controlPlane/demoAgentRoster');
const a2aAgentCardService = require('../services/a2aAgentCardService');
const agentLifecycleEvents = require('../services/agentLifecycleEvents');
const scopeTopology = require('../services/scopeTopology');
const registry = require('../services/agentRegistryService');

function happyPath() {
  agentBuilderService.listEnvironmentAgents.mockResolvedValue([
    { id: 'app-1', name: 'Super Banking AI Agent', type: 'AI_AGENT', enabled: true,
      grantTypes: ['AUTHORIZATION_CODE'], builderCreated: true },
  ]);
  agentBuilderService.getAgentGrants.mockResolvedValue({ res1: ['agent:invoke'] });
  oauthClientRegistry.listClients.mockReturnValue([
    { client_id: 'mcp-client-abc', client_name: 'Batch job', grant_types: ['client_credentials'],
      scope: 'read', status: 'active', last_used: null, usage_count: 0 },
  ]);
  // The REAL shape: an object keyed by vertical, not an array. The first
  // version of this mock returned an array — matching a wrong assumption — so
  // the suite agreed with the bug and `cards.map is not a function` only showed
  // up in the browser. A mock that does not match the real signature cannot
  // fail.
  //
  // 'retail' and 'abercrombie-fitch' genuinely share the card NAME "Purchase
  // History Specialist", so rows must be keyed by vertical or they collide.
  a2aAgentCardService.buildAllSpecialistAgentCards.mockReturnValue({
    banking: { name: 'Investment Advisor', skills: [{ id: 'holdings' }] },
    retail: { name: 'Purchase History Specialist', skills: [{ id: 'orders' }] },
    'abercrombie-fitch': { name: 'Purchase History Specialist', skills: [{ id: 'orders' }] },
  });
  agentLifecycleEvents.query.mockReturnValue([]);
  demoAgentRoster.getRoster.mockReturnValue([
    { id: 'chatgpt', label: 'ChatGPT', source: 'azure', sourceLabel: 'Azure', status: 'active' },
  ]);
  scopeTopology.allApps.mockReturnValue(['Super Banking AI Agent']);
  scopeTopology.appGrantedScopes.mockReturnValue(['agent:invoke', 'admin:read']);
}

describe('agentRegistryService.buildRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    happyPath();
  });

  test('reads the a2a card map without blowing that source up', async () => {
    const out = await registry.buildRegistry();

    // Regression: shipped calling .map() on an object, so this source failed
    // with "cards.map is not a function" and the page showed
    // "1 source unavailable" in the browser while every suite stayed green.
    expect(out.sources.a2a.up).toBe(true);
    expect(out.rows.filter((r) => r.source === 'a2a')).toHaveLength(3);
  });

  test('keys a2a rows by vertical, so two specialists sharing a name do not collide', async () => {
    const out = await registry.buildRegistry();
    const ids = out.rows.filter((r) => r.source === 'a2a').map((r) => r.id);

    // retail and abercrombie-fitch are both "Purchase History Specialist".
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The Lifecycle tab rendered blank for every row, and it was blank by
   * construction: the event store keys on RUNTIME agent handles
   * ('default-agent', 'demo-agent', 'user:<uuid>') while the registry keyed on
   * PingOne application UUIDs. Zero overlap, so the join could never hit — the
   * registry was joined to the one source it shares no keys with.
   *
   * The fix is two-sided, and both sides are pinned here and in
   * agentBuilderLifecycle.test.js:
   *   A. the identities that HAVE history become rows (this block)
   *   B. PingOne apps start accruing their own history (the other file)
   */
  describe('runtime source — the identities that actually have lifecycle history', () => {
    test('promotes an agent seen only in the event store into a row', async () => {
      agentLifecycleEvents.query.mockImplementation(({ agentId } = {}) => {
        const all = [
          { eventId: 'e1', agentId: 'default-agent', agentLabel: 'default-agent',
            eventType: 'leaver', timestamp: '2026-08-10T20:49:40.788Z', reason: 'Misbehaving' },
        ];
        return agentId ? all.filter((e) => e.agentId === agentId) : all;
      });

      const out = await registry.buildRegistry({ session: {} });

      const row = out.rows.find((r) => r.id === 'default-agent');
      expect(row).toBeDefined();
      expect(row.source).toBe('runtime');
      // The whole point: this row's Lifecycle tab is NOT empty.
      expect(row.lifecycle).toHaveLength(1);
      expect(row.lifecycle[0].eventType).toBe('leaver');
    });

    test('derives status from the last event, so a killed agent reads as revoked', async () => {
      agentLifecycleEvents.query.mockImplementation(({ agentId } = {}) => {
        const all = [
          { eventId: 'e2', agentId: 'demo-agent', eventType: 'leaver',
            timestamp: '2026-08-10T21:18:36.056Z' },
        ];
        return agentId ? all.filter((e) => e.agentId === agentId) : all;
      });

      const out = await registry.buildRegistry({ session: {} });

      expect(out.rows.find((r) => r.id === 'demo-agent').status).toBe('revoked');
    });

    test('includes the seeded control-plane roster the registry used to omit', async () => {
      const out = await registry.buildRegistry({ session: {} });

      const row = out.rows.find((r) => r.id === 'chatgpt');
      expect(row).toBeDefined();
      expect(row.identityType).toBe('external');
      expect(row.name).toBe('ChatGPT');
    });

    test('does not double-count an agent that is both rostered and in the event log', async () => {
      agentLifecycleEvents.query.mockImplementation(({ agentId } = {}) => {
        const all = [{ eventId: 'e3', agentId: 'chatgpt', eventType: 'joiner', timestamp: 'x' }];
        return agentId ? all.filter((e) => e.agentId === agentId) : all;
      });

      const out = await registry.buildRegistry({ session: {} });

      expect(out.rows.filter((r) => r.id === 'chatgpt')).toHaveLength(1);
    });

    test('works without a request — the roster is session-scoped, the event log is not', async () => {
      agentLifecycleEvents.query.mockImplementation(({ agentId } = {}) => {
        const all = [{ eventId: 'e4', agentId: 'default-agent', eventType: 'joiner', timestamp: 'x' }];
        return agentId ? all.filter((e) => e.agentId === agentId) : all;
      });

      // No req: a cron/CLI caller must still get the event-derived identities
      // rather than an exception.
      const out = await registry.buildRegistry();

      expect(out.sources.runtime.up).toBe(true);
      expect(out.rows.some((r) => r.id === 'default-agent')).toBe(true);
      expect(out.rows.some((r) => r.id === 'chatgpt')).toBe(false);
    });
  });

  test('unions the identity stores into one row set', async () => {
    const out = await registry.buildRegistry();

    const sources = out.rows.map((r) => r.source);
    expect(sources).toEqual(expect.arrayContaining(['pingone', 'demo-registry', 'a2a']));
    expect(out.rows.length).toBeGreaterThanOrEqual(3);
  });

  test('marks client_credentials clients as workload identities', async () => {
    const out = await registry.buildRegistry();

    // This is the NHI fold-in: workload identities are a filter over the same
    // registry, not a separate inventory to build.
    const wl = out.rows.find((r) => r.id === 'mcp-client-abc');
    expect(wl.identityType).toBe('workload');
    expect(out.rows.find((r) => r.id === 'app-1').identityType).toBe('agent');
  });

  test('flags scope drift when granted does not match the topology SSOT', async () => {
    // Topology expects agent:invoke + admin:read; PingOne granted only the first.
    const out = await registry.buildRegistry();

    const row = out.rows.find((r) => r.id === 'app-1');
    expect(row.scopeStatus).toBe('drift');
    expect(row.missingScopes).toEqual(['admin:read']);
  });

  test('reports match when granted covers everything expected', async () => {
    scopeTopology.appGrantedScopes.mockReturnValue(['agent:invoke']);

    const out = await registry.buildRegistry();
    const row = out.rows.find((r) => r.id === 'app-1');
    expect(row.scopeStatus).toBe('match');
    expect(row.missingScopes).toEqual([]);
  });

  test('reports unverified when there was no expectation to compare against', async () => {
    // The bug this replaces: an empty expectation produced scopeDrift:false,
    // which is indistinguishable from a real match. All 12 a2a rows are this
    // case, and every one of them read as verified-clean.
    scopeTopology.appGrantedScopes.mockReturnValue([]);

    const out = await registry.buildRegistry();

    expect(out.rows.find((r) => r.id === 'app-1').scopeStatus).toBe('unverified');
    // Sources that never had an expectation report the same, not 'match'.
    expect(out.rows.find((r) => r.source === 'a2a').scopeStatus).toBe('unverified');
    expect(out.rows.every((r) => r.scopeDrift === undefined)).toBe(true);
  });

  test('degrades per source: PingOne down still returns the other rows', async () => {
    agentBuilderService.listEnvironmentAgents.mockRejectedValue(new Error('PingOne unreachable'));

    const out = await registry.buildRegistry();

    expect(out.sources.pingone.up).toBe(false);
    expect(out.sources.pingone.error).toMatch(/unreachable/i);
    // The whole point of degrading: everything else is still there.
    expect(out.sources.demoRegistry.up).toBe(true);
    expect(out.rows.some((r) => r.source === 'demo-registry')).toBe(true);
  });

  test('a source failure never throws — the caller always gets a payload', async () => {
    agentBuilderService.listEnvironmentAgents.mockRejectedValue(new Error('boom'));
    oauthClientRegistry.listClients.mockImplementation(() => { throw new Error('lmdb down'); });
    a2aAgentCardService.buildAllSpecialistAgentCards.mockImplementation(() => { throw new Error('nope'); });

    const out = await registry.buildRegistry();

    expect(out.rows).toEqual([]);
    expect(Object.values(out.sources).every((s) => s.up === false || s.rows === 0)).toBe(true);
  });
});
