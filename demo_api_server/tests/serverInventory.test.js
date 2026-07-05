'use strict';

const { SERVER_INVENTORY } = require('../data/serverInventory');

describe('serverInventory', () => {
  test('has 24 entries with unique keys', () => {
    expect(SERVER_INVENTORY).toHaveLength(24);
    const keys = SERVER_INVENTORY.map((s) => s.key);
    expect(new Set(keys).size).toBe(24);
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
});
