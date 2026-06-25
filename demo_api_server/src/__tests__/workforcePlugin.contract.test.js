const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/workforce/index.js');

describe('workforce plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('workforce', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('getHeuristics actions are all declared tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) expect(names).toContain(h.action);
  });

  it('"submit an expense" → submit_expense', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('submit an expense'));
    expect(h && h.action).toBe('submit_expense');
  });

  it('"request time off" → request_time_off', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('request time off'));
    expect(h && h.action).toBe('request_time_off');
  });

  it('"pto balance" → pto_balance', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('pto balance'));
    expect(h && h.action).toBe('pto_balance');
  });

  it('getSystemPrompt non-empty + no banking terms', () => {
    const p = plugin.getSystemPrompt({ role: 'enduser' });
    expect(typeof p).toBe('string'); expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/\bbank(ing)?\b/i);
  });

  it('getAuthz gates submit_expense (stepUp+consent) and request_time_off (consent)', () => {
    expect(plugin.getAuthz().submit_expense).toEqual({ stepUp: true, consent: true });
    expect(plugin.getAuthz().request_time_off).toEqual({ consent: true });
  });

  it('executeTool runs a handler', async () => {
    const out = await plugin.executeTool('pto_balance', {}, { userId: 'u' });
    expect(out.result.balance).toBeDefined();
  });
});
