'use strict';

const { SERVER_INVENTORY } = require('../data/serverInventory');

// 20 compose services + 2 host llama tiers — see docs/server-inventory-sot.md
const EXPECTED_INVENTORY_COUNT = 22;

describe('serverInventory', () => {
  test('has 22 entries with unique keys', () => {
    expect(SERVER_INVENTORY).toHaveLength(EXPECTED_INVENTORY_COUNT);
    const keys = SERVER_INVENTORY.map((s) => s.key);
    expect(new Set(keys).size).toBe(EXPECTED_INVENTORY_COUNT);
  });

  test('every entry has the required fields', () => {
    for (const s of SERVER_INVENTORY) {
      expect(typeof s.key).toBe('string');
      expect(typeof s.name).toBe('string');
      expect(typeof s.purpose).toBe('string');
      expect(['core', 'mcp', 'agents', 'ai-infra', 'authz', 'demo-prop']).toContain(s.category);
      expect([true, false, 'self']).toContain(s.probe);
      if (s.probe === true) {
        expect(Array.isArray(s.candidates)).toBe(true);
        expect(s.candidates.length).toBeGreaterThan(0);
      }
    }
  });

  test('ungoverned-agent is not probed; bff is self', () => {
    expect(SERVER_INVENTORY.find((s) => s.key === 'ungoverned-agent').probe).toBe(false);
    expect(SERVER_INVENTORY.find((s) => s.key === 'api-server').probe).toBe('self');
  });

  // K8s serves these over a different scheme/port than compose. The candidate
  // list must include the K8s target so the probe stops false-reporting a
  // running service as down (see /servers false-"down" regression).
  describe('K8s topology candidates', () => {
    test('ui probes HTTP frontend as well as HTTPS', () => {
      const ui = SERVER_INVENTORY.find((s) => s.key === 'ui');
      // HTTPS first (compose/native), then HTTP (K8s frontend is plaintext).
      expect(ui.candidates).toContain('https://frontend:4000');
      expect(ui.candidates).toContain('http://frontend:4000');
      expect(ui.candidates.indexOf('https://frontend:4000'))
        .toBeLessThan(ui.candidates.indexOf('http://frontend:4000'));
    });

    test('langchain-agent probes port 8888 and accepts any HTTP status', () => {
      const lc = SERVER_INVENTORY.find((s) => s.key === 'langchain-agent');
      expect(lc.candidates.some((c) => c.includes('langchain-agent:8888'))).toBe(true);
      // K8s answers 401 (auth-gated) on 8888 — reachable means up.
      expect(lc.acceptAnyStatus).toBe(true);
    });
  });
});
