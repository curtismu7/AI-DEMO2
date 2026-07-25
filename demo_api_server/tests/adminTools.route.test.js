'use strict';

const { ADMIN_TOOLS } = require('../config/adminTools');

describe('ADMIN_TOOLS data shape', () => {
  test('has 14 entries: 8 banking CRUD + 6 PingOne platform ops', () => {
    expect(ADMIN_TOOLS).toHaveLength(14);
    const adminAgentCount = ADMIN_TOOLS.filter((t) => t.adminAgent === true).length;
    expect(adminAgentCount).toBe(6);
  });

  test('every entry has a unique id, a title, and a chip trigger with text', () => {
    const ids = new Set();
    for (const tool of ADMIN_TOOLS) {
      expect(typeof tool.id).toBe('string');
      expect(ids.has(tool.id)).toBe(false);
      ids.add(tool.id);
      expect(typeof tool.title).toBe('string');
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.trigger).toEqual({ type: 'chip', text: expect.any(String) });
      expect(tool.trigger.text.length).toBeGreaterThan(0);
    }
  });
});
