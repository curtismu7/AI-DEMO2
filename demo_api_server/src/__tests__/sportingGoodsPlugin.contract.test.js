'use strict';

const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/sporting-goods/index.js');

describe('sporting-goods plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('sporting-goods', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('getHeuristics actions are all declared tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) {
      expect(names).toContain(h.action);
    }
  });

  it('"my rentals" → list_rentals', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('my rentals'));
    expect(h && h.action).toBe('list_rentals');
  });

  it('"extend my rental" → extend_rental', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('extend my rental'));
    expect(h && h.action).toBe('extend_rental');
  });

  it('getSystemPrompt non-empty + no banking terms', () => {
    const p = plugin.getSystemPrompt({ role: 'enduser' });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/\bbank(ing)?\b/i);
  });

  it('getAuthz gates extend_rental with consent', () => {
    expect(plugin.getAuthz().extend_rental).toEqual({ consent: true });
  });

  it('executeTool runs a handler', async () => {
    const out = await plugin.executeTool('loyalty_balance', {}, { userId: 'u' });
    expect(out.result.points).toBeDefined();
  });
});
