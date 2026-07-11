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

/**
 * Shape check for parsed intent-router output. The three renderable kinds are
 * validated for the fields their dispatchers require; kind:"none" and unknown
 * kinds are invalid (callers fall through to the existing retry/floor ladder).
 */
function validateIntent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.kind === 'education') {
    return (!!obj.education && typeof obj.education === 'object') || obj.ciba === true;
  }
  if (obj.kind === 'banking') {
    return !!obj.banking && typeof obj.banking === 'object'
      && typeof obj.banking.action === 'string' && obj.banking.action.trim() !== '';
  }
  if (obj.kind === 'vertical') {
    return typeof obj.vertical === 'string' && obj.vertical.trim() !== ''
      && typeof obj.action === 'string' && obj.action.trim() !== '';
  }
  return false;
}

/**
 * Strict JSON parse for machine tool output (not LLM prose): direct parse,
 * then in-place textual repairs only (smart quotes, trailing commas,
 * truncated-closer completion). Deliberately does NOT fence-strip or
 * brace-slice extract — tool output is not wrapped in markdown or
 * conversational text, so an embedded `{...}` found inside a prose/error
 * string (e.g. a gateway error message) must not be mistaken for the result.
 */
function strictParseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) { /* try repaired */ }
  try {
    return JSON.parse(repairJsonText(trimmed));
  } catch (_) { /* unparseable */ }
  return null;
}

/**
 * Normalize a tool result (executeBffTool output: object or JSON string) into
 * an object. Unparseable/empty input becomes an error-shaped object that
 * classifyMcpToolResult routes to kind:'error' — never an unparsed raw
 * string (parsed JSON scalars pass through), never null (classify(null) is
 * 'ok', which turned parse failures into false successes on the write paths).
 */
function parseToolResult(raw, opts = {}) {
  const site = opts.site || 'tool';
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { result: raw, parseFailed: false };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = strictParseJson(raw);
    if (parsed !== null) return { result: parsed, parseFailed: false };
    logMendEvent('tool_result_unparseable', { site, snippet: snippet(raw) });
    return {
      result: {
        error: 'tool_result_unparseable',
        error_description: `The tool returned data the agent could not read: ${snippet(raw)}`,
      },
      parseFailed: true,
    };
  }
  logMendEvent('tool_result_empty', { site });
  return {
    result: { error: 'tool_result_empty', error_description: 'The tool returned no data.' },
    parseFailed: true,
  };
}

module.exports = { repairAndParseJson, validateIntent, parseToolResult, snippet, logMendEvent };
