'use strict';

/**
 * The overview composes services that already exist and never re-reads their
 * stores, so the page cannot show a stale control plane.
 *
 * Two properties are load-bearing and both are pinned here:
 *  - four source states, where `not-wired` is NOT `down`
 *  - per-source degradation: a dead source greys one zone, never the page
 */

jest.mock('../services/agentRegistryService', () => ({ buildRegistry: jest.fn() }));
jest.mock('../services/agentLifecycleEvents', () => ({ query: jest.fn(), summary: jest.fn() }));

const agentRegistryService = require('../services/agentRegistryService');
const agentLifecycleEvents = require('../services/agentLifecycleEvents');
const overview = require('../services/controlPlaneOverview');

beforeEach(() => {
  jest.clearAllMocks();
  agentRegistryService.buildRegistry.mockResolvedValue({
    generatedAt: '2026-08-27T12:00:00.000Z',
    sources: { pingone: { up: true, rows: 13 }, a2a: { up: true, rows: 12 } },
    rows: [
      { id: 'app-1', source: 'pingone', identityType: 'agent', status: 'active', scopeStatus: 'match' },
      { id: 'a2a:banking', source: 'a2a', identityType: 'agent', status: 'active', scopeStatus: 'unverified' },
    ],
  });
  agentLifecycleEvents.query.mockReturnValue([]);
  agentLifecycleEvents.summary.mockReturnValue({ totalEvents: 0, byEventType: {} });
});

test('returns all five zones plus the enforcement band', async () => {
  const out = await overview.buildOverview({ session: {} });

  expect(Object.keys(out.zones).sort())
    .toEqual(['catalog', 'discovery', 'governance', 'observability', 'registry']);
  expect(out.enforcement.map((e) => e.id).sort()).toEqual(['aigateway', 'p1az', 'privilege']);
});

test('enforcement cards are not-wired and carry no counts', async () => {
  const out = await overview.buildOverview({ session: {} });

  for (const card of out.enforcement) {
    expect(card.state).toBe('not-wired');
    // A stub showing numbers is the thing this design exists to avoid.
    expect(card.count).toBeUndefined();
    expect(card.willShow).toEqual(expect.any(String));
    expect(card.today).toMatch(/^\//);
  }
});

test('a not-wired source does not produce a source-down finding', async () => {
  const out = await overview.buildOverview({ session: {} });
  expect(out.findings.some((f) => f.rule === 'source-down')).toBe(false);
});

test('degrades per source: registry down still returns the other zones', async () => {
  agentRegistryService.buildRegistry.mockRejectedValue(new Error('registry exploded'));

  const out = await overview.buildOverview({ session: {} });

  expect(out.sources.registry.state).toBe('down');
  expect(out.sources.registry.error).toMatch(/exploded/);
  expect(out.zones.catalog).toBeDefined();
  // and the failure becomes a finding rather than vanishing
  expect(out.findings.some((f) => f.rule === 'source-down')).toBe(true);
});

test('discovery is structural, never down', async () => {
  const out = await overview.buildOverview({ session: {} });
  expect(out.sources.discovery.state).toBe('structural');
});

test('declared facts ship separately from computed findings', async () => {
  const out = await overview.buildOverview({ session: {} });

  expect(out.declared).toHaveLength(2);
  expect(out.findings.every((f) => f.severity !== 'structural')).toBe(true);
});

test('never throws — the caller always gets a payload', async () => {
  agentRegistryService.buildRegistry.mockRejectedValue(new Error('boom'));
  agentLifecycleEvents.query.mockImplementation(() => { throw new Error('lmdb down'); });

  const out = await overview.buildOverview({ session: {} });
  expect(out.generatedAt).toEqual(expect.any(String));
});

// Finding 7 — the Task 1 -> Task 3 seam: nothing previously asserted the
// registry zone's aggregation, so reverting registryZone to the removed
// scopeDrift field would stay green while the page silently reports 0
// unverified. Pinned against the beforeEach fixture: 1 pingone row
// (scopeStatus: 'match'), 1 a2a row (scopeStatus: 'unverified').
test('registry zone aggregates bySource/unverified/drift/revoked from the rows', async () => {
  const out = await overview.buildOverview({ session: {} });

  expect(out.zones.registry).toMatchObject({
    total: 2,
    bySource: { pingone: 1, a2a: 1 },
    byType: { agent: 2 },
    revoked: 0,
    drift: 0,
    unverified: 1,
  });
});

// Finding 7 — F-1 ruling: query() and summary() are folded into ONE
// readSource call because they hit the same LMDB store, so one store outage
// must produce exactly one source-down finding, not two for the same cause.
test('a broken lifecycle store yields exactly one source-down finding', async () => {
  agentLifecycleEvents.query.mockImplementation(() => { throw new Error('lmdb down'); });

  const out = await overview.buildOverview({ session: {} });

  const lifecycleFindings = out.findings.filter(
    (f) => f.rule === 'source-down' && f.evidence.source === 'lifecycle',
  );
  expect(lifecycleFindings).toHaveLength(1);
  expect(out.sources.registry.state).toBe('live');
});

// Finding 7 — governanceZone had no test at all.
test('governance zone summarizes events and links to the kill-switch roster', async () => {
  agentLifecycleEvents.query.mockReturnValue([
    { eventType: 'leaver', timestamp: '2026-08-20T00:00:00.000Z', agentId: 'x' },
  ]);
  agentLifecycleEvents.summary.mockReturnValue({ totalEvents: 5, byEventType: { leaver: 3, mover: 2 } });

  const out = await overview.buildOverview({ session: {} });

  expect(out.zones.governance.totalEvents).toBe(5);
  expect(out.zones.governance.byEventType).toEqual({ leaver: 3, mover: 2 });
  expect(out.zones.governance.recent).toHaveLength(1);
  expect(out.zones.governance.links).toEqual([{ label: 'Kill-switch roster', href: '/ai-control-plane' }]);
});
