'use strict';

const { audienceScopeTable } = require('../../scripts/demo-readiness');

const hop = (overrides) => ({
  hop: 'tool scope', expectedAudiences: ['enduser.ping.demo'], expectedScopes: ['read'],
  observedAudiences: ['enduser.ping.demo'], observedScopes: ['read'], ...overrides,
});
const check = (...hops) => ({ id: 'UC1', target: 'local', userSessionProvider: 'pingone', evidence: { audienceScope: hops } });

test('prints one line per hop, expected then observed', () => {
  const out = audienceScopeTable([check(hop())]);
  expect(out).toMatch(/^Audience and scope by step/);
  expect(out).toMatch(/^ok\s+UC1 {2}local {2}pingone {2}tool scope {2}scopes read => read {2}audience enduser\.ping\.demo => enduser\.ping\.demo$/m);
});

test('marks a wrong audience, a wrong scope set, and a hop that was not observed', () => {
  const out = audienceScopeTable([check(
    hop({ hop: 'gateway token', observedAudiences: ['other.example'] }),
    hop({ hop: 'gateway token', observedScopes: ['read', 'write'] }),
    hop({ hop: 'gateway to MCP server', expectedScopes: null, observedAudiences: [], observedScopes: [] }),
  )]);
  expect(out.match(/^MISMATCH/gm)).toHaveLength(3);
  expect(out).toContain('(not asserted)');
});

test('accepts a declared mirror audience and prints nothing when no step ran', () => {
  expect(audienceScopeTable([check(hop({ expectedAudiences: ['enduser.ping.demo', 'agentgateway.ping.demo'], observedAudiences: ['agentgateway.ping.demo'] }))])).toMatch(/^ok/m);
  expect(audienceScopeTable([{ id: 'runtime:health' }])).toBe('');
});
