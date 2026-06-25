// banking_api_server/scripts/extractChips.js
'use strict';
/**
 * Source-of-truth chip extractor (banking baseline).
 *
 * Chips used to live as HEURISTIC_CHIPS / LLM_CHIPS const literals inside
 * BankingChips.jsx (regex-parsed from the JSX). They are now data-driven from
 * the vertical manifest's `dashboard.chips10` array, so this module reads the
 * BANKING manifest — the deterministic baseline the CI chip-pipeline suite
 * asserts against. Cross-vertical chip coverage lives in the opt-in real test
 * (tests/real/shared/all-chips-pipeline.test.js), which reads every vertical's
 * manifest itself and does not use this extractor.
 *
 * Each chips10 entry is { id, label, message, mode, tool? }. `mode` partitions
 * them into the same two buckets the old constants did:
 *   - 'both' | 'direct' → heuristic-resolvable (no LLM provider needed)
 *   - 'llm'             → requires an LLM provider
 */
const path = require('path');

const MANIFEST_FILE = path.resolve(
  __dirname,
  '../config/verticals/banking/manifest.json',
);

function extract() {
  const manifest = require(MANIFEST_FILE);
  const chips10 = (manifest.dashboard && manifest.dashboard.chips10) || [];

  const norm = (c) => ({ id: c.id, label: c.label, message: c.message });

  // `mode` partitions the chips: 'llm' needs an LLM provider; everything else
  // ('both' / 'direct' / unset) is heuristic-resolvable.
  const heuristicChips = chips10.filter((c) => c.mode !== 'llm').map(norm);
  const llmChips = chips10.filter((c) => c.mode === 'llm').map(norm);

  const allChips = [
    ...heuristicChips.map((c) => ({ ...c, kind: 'heuristic-builtin' })),
    ...llmChips.map((c) => ({ ...c, kind: 'llm-builtin' })),
  ];
  return { heuristicChips, llmChips, allChips };
}

module.exports = extract();
module.exports.extract = extract;
