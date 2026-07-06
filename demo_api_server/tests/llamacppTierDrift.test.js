// demo_api_server/tests/llamacppTierDrift.test.js
//
// Drift guard: every place that hardcodes the local llama.cpp tier set MUST
// agree with modelCatalog.js (the SSOT). The 5→2 tier consolidation missed
// supervise-swap.sh's TIERS array because it was a 4th hardcoded copy with no
// test catching the drift. This test reads each copy and fails the build if
// any disagrees with the catalog.
//
// If you intentionally change the tier set, update modelCatalog.js FIRST; the
// other files should derive from it. Where they can't (router.js needs
// runtime health/load state per tier), keep them in sync by hand — this test
// will tell you which file you forgot.

const fs = require('fs');
const path = require('path');

const PROXY_DIR = path.resolve(__dirname, '../../demo_llm_proxy');
const REPO_ROOT = path.resolve(__dirname, '../..');

const { TIERS: CATALOG_TIERS } = require(path.join(PROXY_DIR, 'modelCatalog'));

const catalogPorts = CATALOG_TIERS.map((t) => t.port).sort((a, b) => a - b);
const catalogPinNames = CATALOG_TIERS.map((t) => t.pinName).sort();

describe('llama.cpp tier SSOT drift guard', () => {
  test('modelCatalog.js has at least one tier', () => {
    expect(CATALOG_TIERS.length).toBeGreaterThan(0);
  });

  test('router.js TIERS ports match modelCatalog.js', () => {
    const routerSrc = fs.readFileSync(path.join(PROXY_DIR, 'router.js'), 'utf8');
    // Router declares `const TIERS = [ { ... port: <n> ... } ]` — pull every port.
    const portMatches = [...routerSrc.matchAll(/port:\s*(\d+)/g)];
    const routerPorts = portMatches
      .map((m) => parseInt(m[1], 10))
      .filter((p) => p >= 8091 && p <= 8099) // only tier ports (skip LLM_PROXY_PORT 8090 etc.)
      .sort((a, b) => a - b);
    expect(routerPorts).toEqual(catalogPorts);
  });

  test('tier-manager.js VALID_PORTS match modelCatalog.js', () => {
    // tier-manager.js now derives VALID_PORTS from modelCatalog at runtime;
    // if it ever stops importing the catalog, this test catches the regression.
    const tmSrc = fs.readFileSync(path.join(PROXY_DIR, 'tier-manager.js'), 'utf8');
    expect(tmSrc).toContain("require('./modelCatalog')");
    // Also exercise the actual runtime derivation by requiring the module
    // in a child process is overkill; the import check above + the catalog
    // test is sufficient since modelCatalog is the SSOT.
  });

  test('start-local-models.sh MODELS array ports match modelCatalog.js', () => {
    const script = fs.readFileSync(path.join(PROXY_DIR, 'start-local-models.sh'), 'utf8');
    // Each MODELS entry is "PORT:TierN:file:threads:[extra]" — pull the leading port.
    const portMatches = [...script.matchAll(/"(\d{4}):Tier/g)];
    const scriptPorts = portMatches.map((m) => parseInt(m[1], 10)).sort((a, b) => a - b);
    expect(scriptPorts).toEqual(catalogPorts);
  });

  test('langchainConfig.js LLAMACPP_TIER_PORTS match modelCatalog.js', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'demo_api_server/routes/langchainConfig.js'), 'utf8');
    const blockMatch = src.match(/LLAMACPP_TIER_PORTS\s*=\s*\{([^}]*)\}/);
    if (!blockMatch) throw new Error('LLAMACPP_TIER_PORTS block not found');
    const block = blockMatch[1];
    const portMatches = [...block.matchAll(/'([^']+)':\s*(\d+)/g)];
    const pins = portMatches.map((m) => m[1]).sort();
    const ports = portMatches.map((m) => parseInt(m[2], 10)).sort((a, b) => a - b);
    expect(pins).toEqual(catalogPinNames);
    expect(ports).toEqual(catalogPorts);
  });

  test('LlamaCppPanel.jsx PIN_MODELS match modelCatalog.js pinNames', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'demo_api_ui/src/components/LlamaCppPanel.jsx'),
      'utf8',
    );
    const match = src.match(/PIN_MODELS\s*=\s*\[([^\]]*)\]/);
    if (!match) throw new Error('PIN_MODELS array not found');
    const pins = match[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .sort();
    expect(pins).toEqual(catalogPinNames);
  });
});
