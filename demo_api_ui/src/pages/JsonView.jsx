// Colored JSON for the Poppy inspector. Same regex-tokenizing approach as the
// ProtocolPlayground JSONViewer, but self-contained: theme-token classes of its
// own (poppy-inspect-*), usable on any page. Tokens render as React elements —
// never raw HTML — so Company/agent-echoed content is inert text.
import React from 'react';

const TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}])|(\[|\])|(,)/g;

const CLASS_BY_TYPE = {
  key: 'poppy-json-key',
  string: 'poppy-json-string',
  number: 'poppy-json-number',
  boolean: 'poppy-json-boolean',
  null: 'poppy-json-null',
  brace: 'poppy-json-brace',
  bracket: 'poppy-json-bracket',
  comma: 'poppy-json-comma',
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
      const ws = m[2].slice(0, -1);
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

function ColoredJson({ text }) {
  const lines = text.split('\n').map((line, i) => (
    <div key={i}>
      {tokenizeLine(line).map((token, j) =>
        token.type === 'plain' ? (
          token.text
        ) : (
          <span key={j} className={CLASS_BY_TYPE[token.type]}>
            {token.text}
          </span>
        ),
      )}
    </div>
  ));
  return <div className="poppy-inspect-json">{lines}</div>;
}

/** JSON in a chosen view: "pretty" (colored, indented) or "raw" (exactly as it traveled). */
export default function JsonView({ data, raw, view, onChangeView, label }) {
  if (data == null) return null;
  const pretty = typeof data === 'string' ? safePretty(data) : JSON.stringify(data, null, 2);
  const rawText = typeof data === 'string' ? data : JSON.stringify(data);
  const text = view === 'raw' ? rawText : pretty;
  return (
    <div className="poppy-inspect-jsonwrap">
      {onChangeView && (
        <div className="poppy-inspect-viewtoggle" role="group" aria-label={`${label || 'JSON'} view`}>
          <button
            type="button"
            aria-pressed={view !== 'raw'}
            onClick={() => onChangeView('pretty')}
            data-testid="poppy-json-pretty"
          >
            Pretty
          </button>
          <button
            type="button"
            aria-pressed={view === 'raw'}
            onClick={() => onChangeView('raw')}
            data-testid="poppy-json-raw"
          >
            Raw
          </button>
        </div>
      )}
      <ColoredJson text={text} />
    </div>
  );
}

function safePretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text; // not JSON: show it as it is, still colored by the tokenizer
  }
}
