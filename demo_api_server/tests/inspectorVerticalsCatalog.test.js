// demo_api_server/tests/inspectorVerticalsCatalog.test.js
//
// Truthfulness guard for the inspector Vertical dropdown catalog
// (demo_api_ui/src/config/inspectorVerticals.js). Every tool must be a real
// topology tool owned by that vertical's plugin, and every sample id must work
// against the vertical's own seed: each scenario runs in-process through the
// plugin's executeTool with a fresh user, and each chain feeds the id captured
// from step 1 into step 2. Airlines runs in demo_mcp_resource_server, so its
// sample args are checked against that server's seed file instead.

const path = require('path');
const { allTools } = require('../services/scopeTopology');
const { INSPECTOR_VERTICALS } = require('../../demo_api_ui/src/config/inspectorVerticals');

const plugin = (id) => require(path.join(__dirname, '../config/verticals', id));
const entries = Object.entries(INSPECTOR_VERTICALS);
const inProcess = entries.filter(([id]) => id !== 'banking' && id !== 'airlines');

// Same family rule as the UI capture helper (AgentGatewayTester scanArrayFamilies).
const singular = (k) => (/ies$/i.test(k) ? `${k.slice(0, -3)}y` : /s$/i.test(k) && !/ss$/i.test(k) ? k.slice(0, -1) : k);
const firstIdOf = (result, family) => {
  for (const [k, v] of Object.entries(result || {})) {
    if (Array.isArray(v) && singular(k).toLowerCase() === family && v[0] && v[0].id) return v[0].id;
  }
  return '';
};

describe('inspector vertical catalog', () => {
  it('every catalog tool is in scopeTopology.allTools()', () => {
    const known = new Set(allTools());
    for (const [id, v] of entries) {
      for (const t of v.tools) expect(known.has(t) ? t : `${id}: ${t} missing`).toBe(t);
    }
  });

  it("every catalog tool is one of that vertical plugin's own tools", () => {
    for (const [id, v] of entries) {
      const own = new Set(plugin(id).getTools().map((t) => t.name));
      for (const t of v.tools) expect(own.has(t) ? t : `${id}: ${t} not owned`).toBe(t);
    }
  });

  it.each(inProcess)('%s scenarios run against the seed with no error', async (id, v) => {
    const p = plugin(id);
    for (const s of v.scenarios.filter((x) => !x.steps)) {
      const out = await p.executeTool(s.tool, s.args, { userId: `catalog-${id}-${s.id}` });
      expect({ scenario: s.id, error: out && out.result && out.result.error }).toEqual({ scenario: s.id, error: undefined });
    }
  });

  it.each(inProcess)('%s chain feeds the id captured from step 1 into step 2', async (id, v) => {
    const p = plugin(id);
    const ctx = { userId: `catalog-${id}-chain` };
    const [first, ...rest] = v.scenarios.find((s) => s.steps).steps;
    const head = await p.executeTool(first.tool, first.args, ctx);
    const captured = firstIdOf(head.result, v.capture.family);
    expect(captured).toBeTruthy();
    for (const step of rest) {
      const args = step.args[v.capture.arg] === '' ? { ...step.args, [v.capture.arg]: captured } : step.args;
      const out = await p.executeTool(step.tool, args, ctx);
      expect({ tool: step.tool, error: out.result && out.result.error }).toEqual({ tool: step.tool, error: undefined });
    }
  });

  it("airlines sample args exist in demo_mcp_resource_server's seed", () => {
    const seed = require('../../demo_mcp_resource_server/seed/airlines.seed.json');
    const fallback = seed.passengers.find((x) => x.is_demo_fallback).passenger_ref;
    const confirmations = seed.bookings.filter((b) => b.passenger_ref === fallback).map((b) => b.confirmation_number);
    const flights = seed.flights.map((f) => f.flight_number);
    const calls = INSPECTOR_VERTICALS.airlines.scenarios.flatMap((s) => s.steps || [s]);
    const used = calls.flatMap((c) => Object.entries(c.args));
    expect(used.length).toBeGreaterThan(0);
    for (const [k, val] of used) {
      if (k === 'confirmation_number') expect(confirmations).toContain(val);
      if (k === 'flight_number') expect(flights).toContain(val);
    }
  });
});
