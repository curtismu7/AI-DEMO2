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
 * them by how the chip is dispatched:
 *   - 'both' | unset → heuristic-resolvable: the NL parser must map the message
 *                      to an action (no LLM provider needed)
 *   - 'direct'       → dispatched straight to the chip's own `tool` / `denyTool`;
 *                      the NL parser is not in the path, so the message is NOT
 *                      required to parse (e.g. bk-deny's "show my health record"
 *                      deliberately names a HEALTHCARE tool from banking to
 *                      trigger an Authorize DENY — no banking action exists for it)
 *   - 'llm'          → requires an LLM provider
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

  // 'llm' needs an LLM provider. 'direct' is dispatched to the chip's own
  // tool/denyTool and never reaches the NL parser, so it is not heuristic-
  // resolvable — only 'both'/unset must map to an action via parseHeuristic.
  const heuristicChips = chips10.filter((c) => c.mode !== 'llm' && c.mode !== 'direct').map(norm);
  const directChips = chips10.filter((c) => c.mode === 'direct').map(norm);
  const llmChips = chips10.filter((c) => c.mode === 'llm').map(norm);

  const allChips = [
    ...heuristicChips.map((c) => ({ ...c, kind: 'heuristic-builtin' })),
    ...directChips.map((c) => ({ ...c, kind: 'direct-builtin' })),
    ...llmChips.map((c) => ({ ...c, kind: 'llm-builtin' })),
  ];
  return { heuristicChips, directChips, llmChips, allChips };
}

module.exports = extract();
module.exports.extract = extract;
