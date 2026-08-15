import React from 'react';
import './JSONViewer.css';

/**
 * Render JSON with syntax highlighting via regex-based tokenization.
 * No external libraries; pure CSS coloring.
 *
 * Tokens are rendered as React elements (never raw HTML) so response
 * content — which can contain server- or user-echoed values such as an
 * OAuth `error_description` or `state` — is always displayed as inert
 * text, never live markup.
 */

// Matches, in priority order: a quoted key (quoted string immediately
// followed by a colon), a quoted string value, a number, a boolean, null,
// braces, brackets, or a comma. Anything else (whitespace, punctuation) is
// left as plain text between matches.
const TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}])|(\[|\])|(,)/g;

const CLASS_BY_TYPE = {
  key: 'json-key',
  colon: 'json-colon',
  string: 'json-string',
  number: 'json-number',
  boolean: 'json-boolean',
  null: 'json-null',
  brace: 'json-brace',
  bracket: 'json-bracket',
  comma: 'json-comma',
};

function tokenizeLine(line) {
  const tokens = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m = TOKEN_RE.exec(line);
  while (m !== null) {
    if (m.index > last) tokens.push({ type: 'plain', text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ type: 'key', text: m[1] });
      const ws = m[2].slice(0, -1); // whitespace between key and colon
      if (ws) tokens.push({ type: 'plain', text: ws });
      tokens.push({ type: 'colon', text: ':' });
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'string', text: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'number', text: m[4] });
    } else if (m[5] !== undefined) {
      tokens.push({ type: 'boolean', text: m[5] });
    } else if (m[6] !== undefined) {
      tokens.push({ type: 'null', text: m[6] });
    } else if (m[7] !== undefined) {
      tokens.push({ type: 'brace', text: m[7] });
    } else if (m[8] !== undefined) {
      tokens.push({ type: 'bracket', text: m[8] });
    } else if (m[9] !== undefined) {
      tokens.push({ type: 'comma', text: m[9] });
    }
    last = TOKEN_RE.lastIndex;
    m = TOKEN_RE.exec(line);
  }
  if (last < line.length) tokens.push({ type: 'plain', text: line.slice(last) });
  return tokens;
}

export default function JSONViewer({ data }) {
  if (!data) return null;

  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const lines = json.split('\n').map((line, i) => (
    <div key={i}>
      {tokenizeLine(line).map((token, j) =>
        token.type === 'plain' ? (
          token.text
        ) : (
          <span key={j} className={CLASS_BY_TYPE[token.type]}>
            {token.text}
          </span>
        )
      )}
    </div>
  ));

  return <div className="json-viewer">{lines}</div>;
}
