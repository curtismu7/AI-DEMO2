/**
 * LLM response contract — shared repair/validation for every place the BFF
 * consumes LLM or tool output. Demo-hardening Phase 1
 * (docs/superpowers/specs/2026-07-11-demo-hardening-design.md).
 *
 * Invariant: callers never render raw unparseable text; they get a parsed
 * value, a validation verdict, or an error-shaped object the existing
 * classifier (mcpToolOutcome.js) already understands.
 */
'use strict';

/** Collapse control chars and cap length so raw output is loggable/renderable. */
function snippet(raw, max = 200) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** One structured warn line per mend action — greppable as [llmContract]. */
function logMendEvent(event, detail = {}) {
  try {
    console.warn('[llmContract]', JSON.stringify({ event, ...detail }));
  } catch (_) {
    console.warn('[llmContract]', JSON.stringify({ event }));
  }
}

/**
 * Append missing closing braces/brackets to truncated model output.
 * Tracks string state so braces inside string values are not counted.
 */
function completeTruncated(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!stack.length) return text;
  return text + stack.reverse().join('');
}

/** Conservative textual repairs for the failure shapes small local models emit. */
function repairJsonText(text) {
  let t = text
    .replace(/[“”]/g, '"')      // smart double quotes
    .replace(/,\s*([}\]])/g, '$1');       // trailing commas
  t = completeTruncated(t);
  return t;
}

/**
 * Parse JSON out of LLM text: direct parse, fence/think-strip, first-{...}
 * extraction, then repaired variants of each candidate. Returns the parsed
 * value or null. Generic — callers apply their own shape checks.
 */
function repairAndParseJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/m, '')
    .trim();
  if (!cleaned) return null;
  const candidates = [cleaned];
  const brace = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (brace >= 0 && end > brace) candidates.push(cleaned.slice(brace, end + 1));
  if (brace >= 0 && end < brace) candidates.push(cleaned.slice(brace)); // truncated: `{` but no `}`
  for (const candidate of [...candidates, ...candidates.map(repairJsonText)]) {
    try {
      return JSON.parse(candidate);
    } catch (_) { /* try next */ }
  }
  return null;
}

module.exports = { repairAndParseJson, snippet, logMendEvent };
