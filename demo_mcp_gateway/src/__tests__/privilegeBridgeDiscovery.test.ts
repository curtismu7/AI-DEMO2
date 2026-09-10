// A Privilege discovery probe arrives with NO user, because there is genuinely
// no user in "what tools do you have?". The console needs that answer before it
// can offer per-tool policy at all, so refusing it outright — which is what the
// first cut of this bridge did — leaves the door permanently at an empty tool
// list and no policy can ever be authored.
//
// The rule this pins: read-only discovery may proceed as the gateway's OWN
// machine identity; anything that ACTS still requires a delegated user. Running
// a tool as the gateway because nobody was attached is exactly the substitution
// this bridge must never make.

import { PRIVILEGE_BRIDGE_DISCOVERY_METHODS } from '../server/GatewayServer';

describe('Privilege bridge discovery surface', () => {
  test('admits exactly the read-only catalogue methods', () => {
    expect([...PRIVILEGE_BRIDGE_DISCOVERY_METHODS].sort()).toEqual([
      'initialize',
      'prompts/list',
      'resources/list',
      'server/discover',
      'tools/list',
    ]);
  });

  test('tools/call is NOT admitted — acting needs a delegated user', () => {
    expect(PRIVILEGE_BRIDGE_DISCOVERY_METHODS.has('tools/call')).toBe(false);
  });

  test('nothing that mutates sneaks in', () => {
    for (const m of ['tools/call', 'completion/complete', 'resources/read', 'logging/setLevel']) {
      expect(PRIVILEGE_BRIDGE_DISCOVERY_METHODS.has(m)).toBe(false);
    }
  });
});
