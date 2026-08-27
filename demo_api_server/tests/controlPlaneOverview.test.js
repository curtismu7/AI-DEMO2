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
