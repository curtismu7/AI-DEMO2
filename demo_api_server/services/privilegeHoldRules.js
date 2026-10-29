'use strict';

// Pure parsing of the console's AI policies into HITL hold rules. No storage, so it is safe to call from a route whose door
// store is doubled in tests.

/**
 * The tools a live policy holds for a human, from the console's AI policies.
 *
 * An Active Cedar `forbid` that lifts only `unless { ... approval_count >= 1 }` is a HITL hold; it names its door in
 * `context.app == "<door>"` and its tool in `resource == Tool::"<tool>"`. A rule missing either (a candidate, a hold on every
 * tool, a hold on every door) is left out: the page only badges a tool it can name.
 */
function holdRulesFrom(aiPolicies) {
  const rules = [];
  for (const p of Array.isArray(aiPolicies) ? aiPolicies : []) {
    const cedar = String(p?.spec?.Cedar || p?.Spec?.Cedar || '');
    const state = p?.state ?? p?.State;
    if (state !== 'Active' || !/\bforbid\b/.test(cedar) || !cedar.includes('approval_count')) continue;
    const door = cedar.match(/context\.app\s*==\s*"([^"]+)"/)?.[1];
    const tool = cedar.match(/resource\s*==\s*Tool::"([^"]+)"/)?.[1];
    if (door && tool) rules.push({ door, tool, policy: p?.name || p?.ObjectMeta?.Name || '' });
  }
  return rules;
}

/** { door: { tool: policyName } } for the page, or null when this snapshot predates hold rules (so the caller can fall back). */
function holdToolsByDoor(record) {
  if (!record || !Array.isArray(record.holdRules)) return null;
  const out = {};
  for (const r of record.holdRules) (out[r.door] ||= {})[r.tool] = r.policy;
  return out;
}

module.exports = { holdRulesFrom, holdToolsByDoor };
