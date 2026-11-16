import React, { useCallback, useState } from "react";
import JsonPane, { deepParse, parseJsonText } from "./JsonPane";
import "./JsonHighlight.css";
import { LEGACY_ALERT, LEGACY_HOT } from "./jsonEmphasis";

// Shared JSON viewer: a thin wrapper around the one JSON pane (JsonPane.jsx, the Form | JSON / full-view standard).
//
// Call sites keep working unchanged:
//   <pre className="my-json"><JsonHighlight value={obj} /></pre>
//   <JsonHighlight value={obj} deep />       // also unwrap nested stringified JSON
//   <JsonHighlight value={obj} copyable />   // copy button beside the Form | JSON switch
// The pane paints its own ground and takes its colours from --th-* tokens, so the old `jh-dark` wrapper class no
// longer changes the palette. The jh-* token classes below survive only for tokenize() (TraceStepCard's
// HighlightedText colours plain text with them); this component no longer renders them.

export { deepParse };

export function formatJson(value, deep) {
  if (value === null || value === undefined) return null;
  try {
    const normalized = deep ? deepParse(value) : (parseJsonText(value) ?? value);
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(value);
  }
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)|([{}[\],:])/g;

const CRITICAL_FIELDS = new Set(['decision', 'outcome', 'error', 'status', 'errorCode', 'error_code', 'result']);
const FOCUS_FIELDS = new Set(['aud', 'scope', 'payload', 'rarauthorizationdetails', 'authorization_details']);

function extractFieldName(keyText) {
  const m = keyText.match(/"([^"]+)"\s*:/);
  return m ? m[1] : null;
}

export function tokenize(text) {
  if (text == null) return [];
  const tokens = [];
  let last = 0;
  let lastKeyWasCritical = false;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    if (m.index > last) tokens.push({ type: "plain", text: text.slice(last, m.index) });
    if (m[1]) {
      const fieldName = extractFieldName(m[1]);
      const isCritical = fieldName && CRITICAL_FIELDS.has(fieldName);
      const isFocused = fieldName && FOCUS_FIELDS.has(fieldName.toLowerCase());
      tokens.push({ type: "key", text: m[1], critical: isCritical, focused: isFocused });
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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);
  return (
    <button type="button" className="jh-copy" onClick={copy}>
      {copied ? "✅" : "Copy"}
    </button>
  );
}

export default function JsonHighlight({ value, deep = false, copyable = false }) {
  const text = formatJson(value, deep);
  if (text === null) return <span className="jh-empty">—</span>;
  return (
    <span className="jh-root">
      <JsonPane value={value} deep={deep} hot={LEGACY_HOT} alert={LEGACY_ALERT} actions={copyable ? <CopyButton text={text} /> : undefined} />
    </span>
  );
}
