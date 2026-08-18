// demo_api_server/src/__tests__/verticalRenderReachability.test.js
/**
 * Render-descriptor REACHABILITY, as opposed to render-descriptor SHAPE.
 *
 * `verticalRenderSchema.test.js` checks that a `render` block parses. Nothing
 * checked that its keys can ever be reached, so a vertical that borrows another
 * vertical's tool set and filters it (abercrombie-fitch borrows retail's and
 * runs it through `ALLOWED_TOOL_NAMES`) silently kept descriptors for tools it
 * no longer exposes. Four of them. They are inert, which is the problem: by
 * reading the manifest, a descriptor pointing at an uncallable tool is
 * indistinguishable from a load-bearing one, so the 2026-08-17 audit that found
 * the real descriptor bugs (#1898, #1901, #1903) had to check each by hand.
 *
 * A descriptor key is NOT simply a tool name — that assumption is wrong in this
 * repo and this test exists to encode the three ways a key is actually reached:
 *
 *   1. it names a tool the vertical exposes (the common case);
 *   2. a tool handler returns it explicitly — `return { result, render: 'x' }`
 *      — which is how `investment` reaches `portfolio_value`, `trades`,
 *      `dividend_summary`, and how `oauth-teaching` reaches `token_pair`;
 *   3. a service-level map names it for a tool that is not in any vertical's
 *      list — today `A2A_TOOL_RENDER` in `demoAgentLangGraphService.js`, which
 *      is the only reason `investment`'s `portfolio_summary` is live.
 *
 * Source (2) is scanned per-vertical ON PURPOSE, not through borrowed modules:
 * `retail/tools.js` does contain `render: 'pause_subscription'`, but that branch
 * belongs to a tool abercrombie-fitch's allowlist removes, so counting it would
 * mark the exact orphans this test exists to catch as reachable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERTICALS_DIR = path.join(__dirname, '../../config/verticals');
const AGENT_SERVICE = path.join(__dirname, '../../services/demoAgentLangGraphService.js');

/** Descriptor keys named by a service-level tool→render map rather than by a vertical. */
function serviceLevelRenderTargets() {
  const src = fs.readFileSync(AGENT_SERVICE, 'utf8');
  const block = src.match(/A2A_TOOL_RENDER\s*=\s*\{([^}]*)\}/);
  if (!block) return new Set();
  return new Set([...block[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));
}

/** Descriptor keys a vertical's own handlers return explicitly. */
function explicitRenderLiterals(verticalDir) {
  const out = new Set();
  for (const file of fs.readdirSync(verticalDir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(verticalDir, file), 'utf8');
    for (const m of src.matchAll(/render:\s*'([a-z_0-9]+)'/g)) out.add(m[1]);
  }
  return out;
}

function loadVerticalsWithRenderBlocks() {
  const found = [];
  for (const id of fs.readdirSync(VERTICALS_DIR)) {
    const dir = path.join(VERTICALS_DIR, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.render) continue;

    let toolNames = [];
    try {
      const mod = require(dir);
      const tools = typeof mod.getTools === 'function' ? mod.getTools() : (mod.tools || []);
      toolNames = tools.map((t) => t.name);
    } catch (err) {
      // A vertical that cannot be required is a different failure; the shape
      // suite owns it. Skipping here keeps this test's failure meaning one thing.
      continue;
    }
    found.push({ id, dir, manifest, toolNames });
  }
  return found;
}

describe('vertical render descriptors are reachable', () => {
  const verticals = loadVerticalsWithRenderBlocks();
  const serviceTargets = serviceLevelRenderTargets();

  it('finds the vertical manifests to check', () => {
    // Guards the guard: a broken glob would make every case below vacuously pass.
    expect(verticals.length).toBeGreaterThanOrEqual(10);
  });

  it.each(verticals.map((v) => [v.id, v]))(
    '%s has no descriptor for a tool it does not expose',
    (_id, vertical) => {
      const reachable = new Set([
        ...vertical.toolNames,
        ...explicitRenderLiterals(vertical.dir),
        ...serviceTargets,
      ]);
      const orphans = Object.keys(vertical.manifest.render).filter((k) => !reachable.has(k));
      expect(orphans).toEqual([]);
    },
  );
});
