import React from "react";
import "./JsonHighlight.css";

// Shared colour-coded JSON viewer.
//
// Renders pretty-printed JSON as semantic <span>s (no dangerouslySetInnerHTML),
// so it is safe and lint-clean. Colours come from CSS classes in
// JsonHighlight.css: the default palette is tuned for light backgrounds; wrap
// the surrounding <pre> in the `jh-dark` class for dark code blocks.
//
// Usage:
//   <pre className="my-json"><JsonHighlight value={obj} /></pre>          // light
//   <pre className="my-json jh-dark"><JsonHighlight value={obj} /></pre>  // dark
//   <JsonHighlight value={obj} deep />  // also unwrap nested stringified JSON

// If `value` is a string that is itself a stringified JSON object/array, parse
// it once and return the object; otherwise return `value` unchanged. Only
// objects/arrays are unwrapped — primitive-looking strings ("123", "true") are
// left as-is.
function parseJsonString(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* not JSON — keep the original string */
    }
  }
  return value;
}

// Recursively unwrap nested stringified JSON. MCP tool results are commonly
// shaped { text: "<escaped JSON string>" }, which renders as one long unwrapped
// line; this expands them. Opt-in via the `deep` prop — most viewers want to
// show the payload as-is, so the default leaves nested strings untouched.
function deepParse(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    return parsed === value ? value : deepParse(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((v) => deepParse(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepParse(v, depth + 1);
    return out;
  }
  return value;
}

function formatJson(value, deep) {
  if (value === null || value === undefined) return null;
  try {
    const normalized = deep ? deepParse(value) : parseJsonString(value);
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(value);
  }
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)|([{}[\],:])/g;

const CRITICAL_FIELDS = new Set(['decision', 'outcome', 'error', 'status', 'errorCode', 'error_code', 'result']);

function extractFieldName(keyText) {
  const m = keyText.match(/"([^"]+)"\s*:/);
  return m ? m[1] : null;
}

function tokenize(text) {
  const tokens = [];
  let last = 0;
  let lastKeyWasCritical = false;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    if (m.index > last) tokens.push({ type: "plain", text: text.slice(last, m.index) });
    if (m[1]) {
      const fieldName = extractFieldName(m[1]);
      const isCritical = fieldName && CRITICAL_FIELDS.has(fieldName);
      tokens.push({ type: "key", text: m[1], critical: isCritical });
      lastKeyWasCritical = isCritical;
    } else if (m[2]) {
      tokens.push({ type: "string", text: m[2], critical: lastKeyWasCritical });
      lastKeyWasCritical = false;
    } else if (m[3]) {
      tokens.push({ type: "number", text: m[3], critical: lastKeyWasCritical });
      lastKeyWasCritical = false;
    } else if (m[4]) {
      tokens.push({ type: "keyword", text: m[4], critical: lastKeyWasCritical });
      lastKeyWasCritical = false;
    } else if (m[5]) {
      tokens.push({ type: "punct", text: m[5] });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < text.length) tokens.push({ type: "plain", text: text.slice(last) });
  return tokens;
}

export default function JsonHighlight({ value, deep = false }) {
  const text = formatJson(value, deep);
  if (text === null) return <span className="jh-empty">—</span>;
  return (
    <>
      {tokenize(text).map((t, i) => {
        const className = t.critical ? `jh-${t.type} jh-critical` : `jh-${t.type}`;
        return <span key={i} className={className}>{t.text}</span>;
      })}
    </>
  );
}
