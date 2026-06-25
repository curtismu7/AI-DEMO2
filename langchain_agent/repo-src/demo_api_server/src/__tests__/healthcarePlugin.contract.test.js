const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/healthcare/index.js');

describe('healthcare plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('healthcare', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('getHeuristics actions are all declared tools', () => {
    const toolNames = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) expect(toolNames).toContain(h.action);
  });

  it('book appointment phrase routes to book_appointment', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('book an appointment'));
    expect(h && h.action).toBe('book_appointment');
  });

  it('getSystemPrompt returns a non-empty healthcare directive (no banking terms)', () => {
    const p = plugin.getSystemPrompt({ role: 'enduser' });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/\bbank(ing)?\b/i);
  });

  it('getAuthz gates release_records with stepUp + consent', () => {
    expect(plugin.getAuthz().release_records).toEqual({ stepUp: true, consent: true });
  });

  it('executeTool runs a real handler over the data store', async () => {
    const out = await plugin.executeTool('view_coverage', {}, { userId: 'u' });
    expect(out.result.plan).toBeDefined();
  });
});
