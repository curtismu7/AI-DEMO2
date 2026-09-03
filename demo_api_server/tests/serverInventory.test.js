'use strict';

const { SERVER_INVENTORY } = require('../data/serverInventory');

// 20 compose services + 2 host llama tiers — see docs/server-inventory-sot.md
const EXPECTED_INVENTORY_COUNT = 23;

describe('serverInventory', () => {
  test('has 23 entries with unique keys', () => {
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

  test('ui probe includes k8s frontend Service hostname (not only compose ui)', () => {
    const ui = SERVER_INVENTORY.find((s) => s.key === 'ui');
    expect(ui.candidates).toEqual(expect.arrayContaining([
      'https://ui:4000',
      'https://frontend:4000',
      'https://localhost:4000',
    ]));
  });
});
