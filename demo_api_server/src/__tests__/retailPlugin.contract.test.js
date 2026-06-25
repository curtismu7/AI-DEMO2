'use strict';

const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/retail/index.js');

describe('retail plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('retail', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('getHeuristics actions are all declared tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) expect(names).toContain(h.action);
  });

  it('"place an order" → checkout', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('place an order'));
    expect(h && h.action).toBe('checkout');
  });

  it('"order status" → order_status', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('order status'));
    expect(h && h.action).toBe('order_status');
  });

  it('getSystemPrompt non-empty + no banking terms', () => {
    const p = plugin.getSystemPrompt({ role: 'enduser' });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/\bbank(ing)?\b/i);
  });

  it('getAuthz gates checkout with consent', () => {
    expect(plugin.getAuthz().checkout).toEqual({ consent: true });
  });

  it('executeTool runs a handler', async () => {
    const out = await plugin.executeTool('rewards_balance', {}, { userId: 'u' });
    expect(out.result.points).toBeDefined();
  });
});
