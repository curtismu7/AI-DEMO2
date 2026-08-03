'use strict';

/**
 * Option C — grounded answers.
 *
 * The LLM may route freely, but nothing reaches the screen without a tool call
 * behind it. This module takes the model's free text plus the tool results that
 * actually executed this turn, and returns only the claims whose every factual
 * value is present in an in-vertical tool result — each tagged with the tool
 * that produced it and the scope that authorized it.
 *
 * A claim that cannot be attributed is DROPPED, and its text is not returned in
 * any field, so a renderer cannot show it even by accident. When nothing
 * grounds, `grounded` is false and the caller degrades to the Option A
 * no-match card rather than emitting a hedged paragraph.
 *
 * Deliberate limits, stated rather than hidden:
 *  - Attribution is value-based. Qualitative prose ("your account is in good
 *    standing") carries no verifiable value and is therefore always dropped. We
 *    do not ask the model to cite its own sources: a model that invents a
 *    balance will equally happily invent a citation.
 *  - Only JSON-parseable tool results form a grounding corpus. A bare string or
 *    an HTML error page grounds nothing, so its claims drop. Conservative on
 *    purpose — the alternative lets a gateway error page ground a number.
 *  - Single-digit integers ground only against counts (array lengths and
 *    count-named fields), never against arbitrary nested values, so a stray
 *    `"id": 2` cannot ground "you have 2 accounts".
 */

const scopeTopology = require('./scopeTopology');

/**
 * Identifier-first alternation. The identifier branch is tried first so that
 * `acct-4021` is consumed whole instead of leaving a bare `4021` that would
 * never ground on its own and would sink the entire claim.
 */
const TOKEN_RE = /[A-Za-z][A-Za-z0-9]*[-_]?\d[\w-]*|\d[\d,]*(?:\.\d+)?/g;

/** Field names whose value is a legitimate source for a small-integer count. */
const COUNT_KEY_RE = /count|total|num|qty|quantity|length|size/i;

/** Shorter identifiers ("t1", "A1") are too ambiguous to attribute; ignore them. */
const MIN_IDENTIFIER_LENGTH = 4;

let knownToolsCache = null;

/** Tool names actually modelled in the scope topology. */
function knownTools() {
  if (!knownToolsCache) {
    try {
      knownToolsCache = new Set(scopeTopology.allTools());
    } catch (_) {
      knownToolsCache = new Set();
    }
  }
  return knownToolsCache;
}

/**
 * The scope that authorized a tool, or null when we cannot say.
 *
 * scopeTopology.toolScopes() answers ['read'] for ANY unknown name, so it can
 * never be used on its own to decide whether a scope is real. Membership is
 * checked first and an unmodelled tool reports no scope — the same reasoning
 * that had the no-match card omit `closestCandidate` rather than invent one.
 */
function scopeForTool(toolName) {
  if (!knownTools().has(toolName)) return null;
  try {
    const scopes = scopeTopology.toolScopes(toolName);
    return Array.isArray(scopes) && scopes.length ? scopes[0] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Canonical form for a value so both sides of the comparison agree.
 * "$1,234.50" and the JSON number 1234.5 both become "1234.5".
 * @returns {string|null} null when the input carries nothing comparable
 */
function normalizeValue(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const stripped = text.replace(/[$,\s]/g, '');
  if (stripped && /^-?\d*\.?\d+$/.test(stripped)) {
    const n = Number(stripped);
    if (Number.isFinite(n)) return String(n);
  }
  return text.toLowerCase();
}

/** Digits in a normalized numeric form; 0 when it is not numeric. */
function digitCount(normalized) {
  if (!/^-?\d*\.?\d+$/.test(normalized)) return 0;
  return normalized.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').length;
}

/**
 * Walk a parsed tool result and collect what it can legitimately ground.
 * `values` holds every primitive it returned; `counts` holds array lengths and
 * count-named fields, which are the only things allowed to ground a bare digit.
 */
function collectGroundable(node, values, counts, keyName) {
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    counts.add(String(node.length));
    for (const item of node) collectGroundable(item, values, counts, keyName);
    return;
  }

  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectGroundable(value, values, counts, key);
    }
    return;
  }

  const normalized = normalizeValue(node);
  if (!normalized) return;
  values.add(normalized);

  // A count-named field grounds a bare digit; nothing else does.
  if (keyName && COUNT_KEY_RE.test(keyName)) counts.add(normalized);

  // Expand a compound string ("2026-08-02", "acct-4021") into its parts so a
  // reply that mentions only one part still attributes to this result.
  if (typeof node === 'string') {
    for (const part of node.match(TOKEN_RE) || []) {
      const partNorm = normalizeValue(part);
      if (partNorm) values.add(partNorm);
    }
  }
}

/**
 * Build one grounding corpus per in-vertical tool result.
 * Results from tools outside the active vertical are excluded here — that
 * single filter is what enforces "grounded in the ACTIVE vertical".
 */
function buildCorpora(toolResults, verticalToolNames) {
  const allowed = new Set(Array.isArray(verticalToolNames) ? verticalToolNames : []);
  const corpora = [];

  for (const entry of Array.isArray(toolResults) ? toolResults : []) {
    if (!entry || !entry.name || !allowed.has(entry.name)) continue;

    let parsed;
    if (entry.result && typeof entry.result === 'object') {
      parsed = entry.result;
    } else {
      try {
        parsed = JSON.parse(String(entry.result));
      } catch (_) {
        // Not JSON — an error page or opaque blob. Grounds nothing.
        continue;
      }
    }
    if (parsed === null || typeof parsed !== 'object') continue;

    const values = new Set();
    const counts = new Set();
    collectGroundable(parsed, values, counts, null);
    corpora.push({ tool: entry.name, values, counts });
  }

  return corpora;
}

/** Split a reply into candidate claims: one per line, then per sentence. */
function splitClaims(reply) {
  return String(reply || '')
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Factual tokens in a claim, with sub-minimum identifiers discarded as noise. */
function claimTokens(text) {
  const raw = text.match(TOKEN_RE) || [];
  return raw.filter((tok) => {
    if (/^\d/.test(tok)) return true; // numeric token
    return tok.length >= MIN_IDENTIFIER_LENGTH;
  });
}

/**
 * Attribute one claim.
 * @returns {{ ok: true, sources: Array }|{ ok: false, reason: string }}
 */
function attributeClaim(text, corpora) {
  const tokens = claimTokens(text);
  if (tokens.length === 0) return { ok: false, reason: 'no_verifiable_value' };

  const sources = [];
  for (const token of tokens) {
    const normalized = normalizeValue(token);
    if (!normalized) return { ok: false, reason: 'unattributable_value' };

    // A bare digit is only ever a count. Anything wider may match any value.
    const digits = digitCount(normalized);
    const numeric = digits > 0;
    const countOnly = numeric && digits < 2;

    const hit = corpora.find((c) =>
      countOnly ? c.counts.has(normalized) : c.values.has(normalized) || c.counts.has(normalized),
    );

    // Every value must ground. Partial credit would let a fabricated number
    // ride along inside an otherwise-true sentence.
    if (!hit) return { ok: false, reason: 'unattributable_value' };
    if (!sources.includes(hit.tool)) sources.push(hit.tool);
  }

  return { ok: true, sources: sources.map((tool) => ({ tool, scope: scopeForTool(tool) })) };
}

/**
 * Reduce a model reply to only its attributable claims.
 *
 * @param {string} reply model's free text
 * @param {Array<{name: string, result: string|object}>} toolResults tools that ran this turn
 * @param {{ verticalToolNames?: string[] }} opts tools belonging to the ACTIVE vertical
 * @returns {{ claims: Array<{text: string, sources: Array<{tool: string, scope: string|null}>}>,
 *            droppedCount: number,
 *            droppedReasons: { no_verifiable_value: number, unattributable_value: number },
 *            grounded: boolean }}
 *   Dropped claim text is deliberately absent from the return value.
 */
function buildGroundedAnswer(reply, toolResults, opts = {}) {
  const corpora = buildCorpora(toolResults, opts.verticalToolNames);
  const claims = [];
  const droppedReasons = { no_verifiable_value: 0, unattributable_value: 0 };
  let droppedCount = 0;

  for (const text of splitClaims(reply)) {
    const verdict = attributeClaim(text, corpora);
    if (verdict.ok) {
      claims.push({ text, sources: verdict.sources });
    } else {
      droppedCount += 1;
      droppedReasons[verdict.reason] += 1;
    }
  }

  return { claims, droppedCount, droppedReasons, grounded: claims.length > 0 };
}

module.exports = { buildGroundedAnswer };
