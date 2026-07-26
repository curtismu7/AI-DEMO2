'use strict';

/**
 * Drift gate: the UI's requiredDemoFlags.js must agree with the server's
 * demoStepPrerequisites.js for every catalog entry in every vertical.
 *
 * Why this test exists: the two files are hand-maintained mirrors (the UI is
 * ESM/vitest, the server is CJS/jest — there is no shared-package boundary to
 * import across, so the repo's usual two-files-plus-one-gate pattern applies,
 * same as gen-scope-topology.js check and toolSchemaDrift).
 *
 * The mirror silently lost MCP_GATEWAY_RUNTIME_FLAGS. The UI is the only path
 * that arms flags before a chip Run, so ff_mcp_gateway_pinggateway and
 * ff_gateway_brokered_exchange were never auto-armed by any code path, and
 * 22 of 50 banking use cases failed with the opaque
 * "That step couldn't be completed" (PingOne invalid_scope, Exchange #2 across
 * multiple resources). Nothing caught it because the step-verification suites
 * stub every ff_* flag ON.
 *
 * If this test fails, fix the mirror — do not relax the assertion.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const server = require('../../services/demoStepPrerequisites');
const { USE_CASES, listUseCases, VERTICALS } = require('../../config/useCases');

const CLIENT_PATH = path.resolve(
  __dirname,
  '../../../demo_api_ui/src/utils/requiredDemoFlags.js',
);

/**
 * Load the UI's ESM module in-process. It has no imports, so stripping the
 * `export` keyword and evaluating in a sandbox is exact — no bundler needed.
 * @returns {{ requiredFlagsForUseCase: Function, requiredFlagsForUseCaseId: Function }}
 */
function loadClientModule() {
  const src = fs.readFileSync(CLIENT_PATH, 'utf8');

  // Guard the assumption above: an import would make the strip-and-eval wrong.
  expect(src).not.toMatch(/^\s*import\s/m);

  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${src.replace(/^export\s+/gm, '')}
     module.exports = { requiredFlagsForUseCase, requiredFlagsForUseCaseId };`,
    sandbox,
    { filename: CLIENT_PATH },
  );
  return sandbox.module.exports;
}

const client = loadClientModule();

/** Order-insensitive: both sides build from a Set, so insertion order is incidental. */
const norm = (flags) => [...flags].sort();

describe('requiredDemoFlags parity (UI mirror vs server SoT)', () => {
  test('the UI module exports both functions', () => {
    expect(typeof client.requiredFlagsForUseCase).toBe('function');
    expect(typeof client.requiredFlagsForUseCaseId).toBe('function');
  });

  test('MCP_GATEWAY_RUNTIME_FLAGS is present in the UI mirror', () => {
    // The specific regression this file was written for. A chip that dispatches
    // a tool needs both gateway flags on BOTH sides, or the UI arms an
    // incomplete set and the run dies at Exchange #2.
    const toolChip = { id: 'UC1', useCaseId: 'x', maturity: 'works', primaryTool: 'get_balance' };
    expect(norm(client.requiredFlagsForUseCase(toolChip)))
      .toEqual(expect.arrayContaining(server.MCP_GATEWAY_RUNTIME_FLAGS));
  });

  describe.each(VERTICALS)('vertical: %s', (vertical) => {
    const cases = listUseCases(vertical);

    test('vertical resolves a non-empty catalog', () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    test('every entry yields identical flags on both sides', () => {
      const mismatches = [];
      for (const uc of cases) {
        const a = norm(server.requiredFlagsForUseCase(uc));
        const b = norm(client.requiredFlagsForUseCase(uc));
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          mismatches.push({ id: uc.id, vertical, server: a, client: b });
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  test('requiredFlagsForUseCaseId agrees for every slug when the catalog is loaded', () => {
    const mismatches = [];
    for (const uc of USE_CASES) {
      const a = norm(server.requiredFlagsForUseCaseId(uc.useCaseId, USE_CASES));
      const b = norm(client.requiredFlagsForUseCaseId(uc.useCaseId, USE_CASES));
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        mismatches.push({ useCaseId: uc.useCaseId, server: a, client: b });
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('A2A_USE_CASE_IDS is identical on both sides', () => {
    // Duplicated verbatim in both files with nothing else asserting equality.
    const src = fs.readFileSync(CLIENT_PATH, 'utf8');
    for (const slug of server.A2A_USE_CASE_IDS) {
      expect(src).toContain(`'${slug}'`);
    }
    const clientSlugs = (src.match(/'[a-z0-9-]+'/g) || [])
      .map((s) => s.slice(1, -1))
      .filter((s) => s.startsWith('a2a-'));
    for (const slug of clientSlugs) {
      expect(server.A2A_USE_CASE_IDS.has(slug)).toBe(true);
    }
  });

  test('catalog-less A2A fallback still includes the gateway flags', () => {
    // The UI fallback fires when a chip is clicked before the catalog loads.
    // An A2A case dispatches delegate_to_specialist, so it needs them too.
    const fallback = norm(client.requiredFlagsForUseCaseId('a2a-delegation'));
    expect(fallback).toEqual(expect.arrayContaining(server.MCP_GATEWAY_RUNTIME_FLAGS));
    expect(fallback).toContain('ff_a2a_delegation');
  });
});
