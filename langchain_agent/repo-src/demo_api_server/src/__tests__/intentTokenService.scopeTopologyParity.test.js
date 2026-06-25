'use strict';
/**
 * Drift-guard: every tool named in the intent→tool permission map
 * (INTENT_TO_PERMITTED_TOOLS) and READ_ONLY_TOOLS must exist in
 * scope-topology.json. The permission map is curated (it isn't derivable from
 * scope-topology), so this guards against a tool being renamed/removed in the
 * SoT while a stale entry lingers in the permission map — which would let the
 * gateway authorize, or read-list, a tool the SoT no longer knows about.
 *
 * Neither module pulls heavy deps (intentTokenService → node:crypto;
 * scopeTopology → fs/path), so this is a fast pure-unit check.
 */

const scopeTopology = require('../../services/scopeTopology');
const {
  INTENT_TO_PERMITTED_TOOLS,
  READ_ONLY_TOOLS,
} = require('../../services/intentTokenService');

describe('intent permission map ↔ scope-topology.json parity', () => {
  const known = new Set(scopeTopology.allTools());
  const referenced = [
    ...new Set([
      ...Object.values(INTENT_TO_PERMITTED_TOOLS).flat(),
      ...READ_ONLY_TOOLS,
    ]),
  ].sort();

  test.each(referenced)('tool "%s" is declared in scope-topology.json', (tool) => {
    expect(known.has(tool)).toBe(true);
  });
});
