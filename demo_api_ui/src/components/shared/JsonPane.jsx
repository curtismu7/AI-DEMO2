// The one JSON pane (owner standard, 2026-11-14). Every place the UI shows JSON uses this, directly or through
// the JsonHighlight / FormJsonToggle wrappers. Four properties:
//   1. one colour standard   JSON view tokens by role; colours are --th-* tokens only (JsonPane.css, README table in UI-DESIGN-SYSTEM.md)
//   2. a Form | JSON toggle  one choice for the whole page, kept in localStorage; Form is the default, a saved choice always wins
//   3. important keys stand out  HOT (who, for whom, what) + the caller's `hot`, and error / decision keys (ALERT) + the caller's `alert`.
//      Alert is VALUE-AWARE: a key in the alert set is painted alert only when its value is a failure or unknown signal
//      (isBenignAlertValue below). "decision": "allow", "error": null, "outcome": "success" read as normal rows, never red.
//      `alert={false}` turns alert emphasis off for the whole pane (neutral data whose note / reason is free text).
//   4. FULL VIEW             the pane never scrolls: no max-height, no overflow auto|scroll, long lines wrap (JsonPane.css)
// Everything is React text, never markup, and passes visible(): control and bidi characters show as escapes.
// Ported from the standalone labs' JsonPane (shared/json/JsonPane.jsx); the colour tokens are AI-DEMO2's --th-* family.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { visible } from '../../utils/safeText';
import './JsonPane.css';

// ---- View choice: one per page, shared by every pane and FormJsonToggle ---------------------------------------
export const JSON_VIEW_KEY = 'ai-demo.json.view';
const isView = (v) => v === 'form' || v === 'json';
let memoryChoice = null; // set only when localStorage refuses the write (private mode): the choice then lives for the session
const subs = new Set();
const notify = () => subs.forEach((f) => f());

// The visitor's explicit choice ('form' | 'json'), or null when they have not made one.
function readChoice() {
  try {
    const v = window.localStorage.getItem(JSON_VIEW_KEY);
    if (isView(v)) return v;
  } catch {
    /* no storage: fall back to the in-memory choice */
  }
  return memoryChoice;
}

export function setJsonView(v) {
  if (!isView(v)) return;
  try {
    window.localStorage.setItem(JSON_VIEW_KEY, v);
    memoryChoice = null; // storage holds it
  } catch {
    memoryChoice = v; // private mode: the choice lives for the session
  }
  notify();
}

/** [view, setView]. `fallback` applies only while the visitor has made no choice; a saved choice always wins. */
export function useJsonView(fallback = 'form') {
  const choice = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    readChoice,
    () => null,
  );
  return [choice ?? fallback, setJsonView];
}

// A pane rendered inside a FormJsonToggle's JSON view is already the JSON view: no second toggle.
const JsonOnlyContext = createContext(false);
export function JsonViewOnly({ children }) {
  return <JsonOnlyContext.Provider value>{children}</JsonOnlyContext.Provider>;
}

/** The Form | JSON switch. Labels are exactly "Form" and "JSON". */
export function JsonViewToggle({ view, onChange = setJsonView, label = 'JSON' }) {
  const asForm = view === 'form';
  return (
    <span className="jp-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={asForm} onClick={() => onChange('form')}>Form</button>
      <button type="button" aria-pressed={!asForm} onClick={() => onChange('json')}>JSON</button>
    </span>
  );
}

// ---- Kinds ------------------------------------------------------------------------------------------------------
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/;
const BEARER = /^(Bearer|DPoP) (eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*)$/;
const URLISH = /^https?:\/\/\S+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
const TIME_KEYS = new Set(['iat', 'exp', 'nbf', 'auth_time']);
// The parts of a token exchange a reader looks for first: who (sub, act), for whom (aud), what (scope), and which app.
export const HOT_KEYS = ['sub', 'act', 'may_act', 'aud', 'scope', 'client_id', 'azp', 'iss', 'cnf', 'grant_type', 'subject_token', 'actor_token', 'access_token', 'authorization'];
export const ALERT_KEYS = ['error', 'error_description', 'detail_code', 'outcome', 'decision', 'verdict', 'reason', 'note'];
const HOT = new Set(HOT_KEYS);
const ALERT = new Set(ALERT_KEYS);
const NO_ALERT = new Set(); // alert={false}: no key is ever alert

// A key in the alert set is NOT alert when its value says "nothing wrong", and what that means depends on the key:
//   any key          null / undefined, text that is empty after trim, an empty array or object
//   error-type key   (a key containing "error", or detail_code) also false, 0 and the word "none". Success words and `true` do NOT
//                    clear it: `error: "ok"`, `error: "true"` and `error: true` are failure signals and stay alert.
//   any other key    also `true`, a 2xx number, and one of the success words below (case-insensitive, trimmed, exact match).
//                    "none" clears only note and reason (no note, no reason), never decision / outcome / verdict ("no decision").
// Everything else (deny, blocked, error text, free text, unknown words, non-empty objects, any other number) stays alert.
export const BENIGN_ALERT_WORDS = ['allow', 'allowed', 'permit', 'permitted', 'approve', 'approved', 'grant', 'granted', 'ok', 'success', 'succeeded', 'successful', 'pass', 'passed', 'valid', 'active', 'true'];
const BENIGN = new Set(BENIGN_ALERT_WORDS);
const ERRORISH = /error|^detail_code$/i;
const NONE_CLEARS = /error|^(detail_code|note|reason)$/i;
const isEmptyContainer = (v) => (Array.isArray(v) ? v.length === 0 : v !== null && typeof v === 'object' && Object.keys(v).length === 0);
export function isBenignAlertValue(key, value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (isEmptyContainer(value)) return true;
  if (ERRORISH.test(key)) {
    if (value === false || value === 0) return true;
    return typeof value === 'string' && value.trim().toLowerCase() === 'none';
  }
  if (value === true) return true;
  if (typeof value === 'number') return value >= 200 && value < 300;
  if (typeof value !== 'string') return false;
  const word = value.trim().toLowerCase();
  return BENIGN.has(word) || (word === 'none' && NONE_CLEARS.test(key));
}
const SPLIT = new Set(['scope', 'aud', 'scp']);

export function kindOf(v, key = '') {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return TIME_KEYS.has(key) ? 'time' : 'number';
  if (typeof v !== 'string') return 'string';
  if (JWT.test(v) || BEARER.test(v)) return 'token';
  if (URLISH.test(v)) return 'url';
  if (UUID.test(v)) return 'id';
  if (ISO.test(v)) return 'time';
  return 'string';
}

// JSON that arrives as TEXT (a log line, an HTTP body, tool output): an object or array in a string gets the same Form | JSON panes.
// Anything else (a token, plain text, a bare number or string) stays text.
export function parseJsonText(s) {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return undefined;
  try {
    const v = JSON.parse(t);
    return v !== null && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

// An HTTP transcript with a JSON body (request / status line, headers, blank line, body): the head stays text,
// the body gets its own Form | JSON pane. Anything that is not clearly that shape is left alone (a string stays text).
const WIRE_START = /^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+(?: HTTP\/\d(?:\.\d)?)?\s*$|HTTP\/\d(?:\.\d)?\s+\d{3}|HTTP\s+\d{3})/m;
export function splitWire(s) {
  if (typeof s !== 'string') return undefined;
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return undefined;
  const head = s.slice(0, m.index);
  const body = s.slice(m.index + m[0].length);
  if (!WIRE_START.test(head.split(/\r?\n/)[0])) return undefined;
  return parseJsonText(body) !== undefined ? { head, body } : undefined;
}

// Opt-in (`deep`): unwrap nested stringified JSON, e.g. MCP tool results shaped { text: "<escaped JSON string>" }.
export function deepParse(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    const parsed = parseJsonText(value);
    return parsed === undefined ? value : deepParse(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((v) => deepParse(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepParse(v, depth + 1);
    return out;
  }
  return value;
}

export const MAX_PANE_CHARS = 150000; // above this a pane is plain text
export const MAX_FORM_DEPTH = 60; // deeper than this the Form view shows the rest as text
const prim = (v) => v === null || typeof v !== 'object';
// An object, or a list of objects, goes UNDER its label at full width (a deep payload must not spend a label column per level); scalars and chip lists stay beside it.
const nestedValue = (v) => !prim(v) && !(Array.isArray(v) && v.every(prim));
const date = (n) => (Number.isFinite(n) && n > 1e9 && n < 1e11 ? `${new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC` : null);

// A token in three colours: header . payload . signature (a Bearer / DPoP prefix stays plain).
export function Jwt({ text }) {
  const m = BEARER.exec(text);
  const raw = m ? m[2] : text;
  const parts = raw.split('.');
  return (
    <span className="jp-jwt">
      {m && <span className="jp-tok jp-tok--plain">{m[1]} </span>}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="jp-tok jp-tok--punct">.</span>}
          <span className={`jp-tok jp-tok--jwt${Math.min(i, 2) + 1}`}>{visible(p)}</span>
        </span>
      ))}
    </span>
  );
}

// ---- JSON view: the exact text, coloured ---------------------------------------------------------------------
// A tiny scanner (no eval, no HTML): strings, numbers, literals and punctuation. Total: anything unparsable becomes one plain token.
function scan(text) {
  const out = [];
  let i = 0;
  const nextMeaning = (from) => {
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    return text[j];
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      let esc = false;
      while (j < text.length) {
        if (esc) esc = false;
        else if (text[j] === '\\') esc = true;
        else if (text[j] === '"') break;
        j += 1;
      }
      out.push({ kind: nextMeaning(j + 1) === ':' ? 'key' : 'string', text: text.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      // whitespace is its own token, so the value after `"key": ` is seen as a value (a number, true, false, null), not swallowed as plain text
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      out.push({ kind: 'plain', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (/[-0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[-0-9.eE+]/.test(text[j])) j += 1;
      out.push({ kind: 'number', text: text.slice(i, j) });
      i = j;
      continue;
    }
    const word = text.slice(i, i + 5).match(/^(true|false|null)/);
    if (word) {
      out.push({ kind: word[1] === 'null' ? 'null' : 'bool', text: word[1] });
      i += word[1].length;
      continue;
    }
    if (/[{}[\],:]/.test(ch)) {
      out.push({ kind: 'punct', text: ch });
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/["{}[\],:]/.test(text[j])) j += 1;
    out.push({ kind: 'plain', text: text.slice(i, j) });
    i = j;
  }
  return out;
}

// The value after the key at tokens[i], as a JS value (a non-empty object or array reads as a non-benign sentinel).
function valueAfter(tokens, i) {
  let j = i + 1;
  while (j < tokens.length && (tokens[j].kind === 'plain' || tokens[j].text === ':')) j += 1;
  const t = tokens[j];
  if (!t) return undefined;
  if (t.kind === 'string') {
    try {
      return JSON.parse(t.text);
    } catch {
      return t.text.slice(1, -1);
    }
  }
  if (t.kind === 'number') return Number(t.text);
  if (t.kind === 'bool') return t.text === 'true';
  if (t.kind === 'null') return null;
  // { or [: an empty one ("{}", "[ ]") reads as empty, a non-empty one as a non-benign sentinel
  let k = j + 1;
  while (k < tokens.length && tokens[k].kind === 'plain' && tokens[k].text.trim() === '') k += 1;
  const close = tokens[k];
  return close && close.kind === 'punct' && (close.text === '}' || close.text === ']') ? [] : { nonEmpty: true };
}

function RawJson({ text, hot, alert }) {
  let key = '';
  const tokens = scan(text);
  let alertKey = false; // the current key is alert AND its value is not benign
  return tokens.map((t, i) => {
    if (t.kind === 'key') {
      key = t.text.slice(1, -1);
      alertKey = alert.has(key) && !isBenignAlertValue(key, valueAfter(tokens, i));
      return <span key={i} className={`jp-tok jp-tok--${hot.has(key) ? 'hot' : alertKey ? 'alert' : 'key'}`}>{visible(t.text)}</span>;
    }
    if (t.kind === 'string') {
      let inner = t.text.slice(1, -1);
      try {
        inner = JSON.parse(t.text);
      } catch {
        /* keep the escaped text */
      }
      const k = kindOf(inner, key);
      if (k === 'token') return <span key={i} className="jp-tok jp-tok--plain">&quot;<Jwt text={inner} />&quot;</span>;
      const cls = k === 'string' && alertKey ? 'alert' : k === 'string' && hot.has(key) ? 'hot' : k;
      return <span key={i} className={`jp-tok jp-tok--${cls}`}>{visible(t.text)}</span>;
    }
    if (t.kind === 'number') return <span key={i} className={`jp-tok jp-tok--${TIME_KEYS.has(key) ? 'time' : 'number'}`}>{t.text}</span>;
    return <span key={i} className={`jp-tok jp-tok--${t.kind}`}>{visible(t.text)}</span>;
  });
}

// ---- Per-field Copy (Form view) ---------------------------------------------------------------------------------
// Every primitive leaf (and each chip) gets its own Copy button, so a presenter can lift one token, claim or id without
// selecting text by hand. It copies the leaf's text exactly as it is in the data (a masked value copies as the mask).
const CopyFieldsContext = createContext(true);

// navigator.clipboard where it works; otherwise (insecure origin, permission denied) a hidden textarea and execCommand.
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the textarea route */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.className = 'jp-copy-sink';
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand('copy');
    ta.remove();
    return done;
  } catch {
    return false;
  }
}

const COPIED_MS = 1200;
const trim = (s, n = 40) => (s.length > n ? `${s.slice(0, n)}\u2026` : s);

function FieldCopy({ text, name }) {
  const on = useContext(CopyFieldsContext);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, [text]);
  if (!on || text === '') return null;
  const label = visible(name || 'value');
  return (
    <button type="button" className="jp-copy" data-copied={copied ? 'true' : undefined} aria-label={`${copied ? 'Copied' : 'Copy'} ${label}`} onClick={copy}>
      {copied ? (
        'Copied'
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 11V3a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
    </button>
  );
}

// A primitive value with its Copy button beside it (the button is a sibling of the value, never inside it).
function Leaf({ v, k, children }) {
  return (
    <span className="jp-leaf">
      {children}
      <FieldCopy text={String(v)} name={k} />
    </span>
  );
}

// ---- Form view: a form ------------------------------------------------------------------------------------------
function Value({ v, k, hot }) {
  const kind = kindOf(v, k);
  if (kind === 'null') return <span className="jp-v jp-v--null">none</span>;
  if (kind === 'bool') return <Leaf v={v} k={k}><span className="jp-chip" data-on={v ? 'true' : 'false'}>{v ? 'true' : 'false'}</span></Leaf>;
  if (kind === 'token') return <Leaf v={v} k={k}><span className="jp-v jp-v--token"><Jwt text={v} /></span></Leaf>;
  if (typeof v === 'string' && SPLIT.has(k) && /\s/.test(v.trim())) return <ChipList items={v.trim().split(/\s+/)} k={k} hot={hot} />;
  if (kind === 'time') {
    const d = typeof v === 'number' ? date(v) : null;
    return <Leaf v={v} k={k}><span className="jp-v jp-v--time">{visible(String(v))}{d && <span className="jp-sub"> {d}</span>}</span></Leaf>;
  }
  // A string that would read as another type (the text "{}", "[]", "5", "true", "null") keeps its quotes, so the Form view never hides string-versus-object.
  const typed = typeof v === 'string' && /^(?:\{[\s\S]*\}|\[[\s\S]*\]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/.test(v.trim());
  return <Leaf v={v} k={k}><span className={`jp-v jp-v--${kind}`}>{visible(typed ? JSON.stringify(v) : String(v))}</span></Leaf>;
}

function ChipList({ items, k, hot }) {
  if (!items.length) return <span className="jp-v jp-v--null">none</span>;
  return (
    <ul className="jp-chips" data-hot={hot.has(k) ? 'true' : undefined}>
      {items.map((x, i) => (
        <li key={`${x}-${i}`} className="jp-chip">
          {visible(String(x))}
          <FieldCopy text={String(x)} name={trim(String(x))} />
        </li>
      ))}
    </ul>
  );
}

function Form({ value, hot, alert, k = '', depth = 0 }) {
  if (depth > MAX_FORM_DEPTH) {
    let rest;
    try {
      rest = JSON.stringify(value);
    } catch {
      rest = String(value); // circular
    }
    return <span className="jp-v">{visible(rest)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.every(prim)) return <ChipList items={value} k={k} hot={hot} />;
    return (
      <ol className="jp-list">
        {value.map((x, i) => <li key={i}><span className="jp-idx">{i + 1}</span><Form value={x} hot={hot} alert={alert} depth={depth + 1} /></li>)}
      </ol>
    );
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return <span className="jp-v jp-v--null">empty</span>;
    return (
      <dl className="jp-fields" data-depth={Math.min(depth, 3)}>
        {entries.map(([key, v]) => (
          <div key={key} className="jp-row" data-hot={hot.has(key) ? 'true' : undefined} data-alert={alert.has(key) && !isBenignAlertValue(key, v) ? 'true' : undefined} data-nested={nestedValue(v) ? 'true' : undefined}>
            <dt className="jp-k">{visible(key)}</dt>
            <dd className="jp-d">{prim(v) ? <Value v={v} k={key} hot={hot} /> : <Form value={v} hot={hot} alert={alert} k={key} depth={depth + 1} />}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Value v={value} k={k} hot={hot} />;
}

// ---- The pane ---------------------------------------------------------------------------------------------------
/**
 * @param {object} props
 * @param {unknown} props.value     An object or array (or a string holding one) gets the Form | JSON choice; any other string is text
 *   (a token in its three colours); an undefined value is an empty pane.
 * @param {string[]} [props.hot]    Extra important keys, on top of HOT_KEYS, stood out in both views.
 * @param {string[]|false} [props.alert]  Extra error / decision keys, on top of ALERT_KEYS. Painted alert only for a failure-or-unknown value (isBenignAlertValue).
 *   `false` turns alert emphasis OFF for the whole pane, in both views and in the body pane of an HTTP transcript: no key is painted
 *   alert and the keys render normal (or hot, when also in `hot`). Use it for neutral data (a request body, a raw spec, free-text
 *   metadata). Do NOT use it for an error response or a deny / failure result: there the red is the point.
 * @param {boolean} [props.deep]    Unwrap nested stringified JSON before rendering.
 * @param {boolean} [props.toggle]  false hides the Form | JSON switch (the view still follows the page choice).
 * @param {'form'|'json'} [props.view]  Force one view and hide the switch (FormJsonToggle's JSON view).
 * @param {'form'|'json'} [props.defaultView]  View while the visitor has made no choice (default Form).
 * @param {React.ReactNode} [props.actions]  Controls shown beside the switch (e.g. a copy button).
 * @param {boolean} [props.copyFields]  Form view: a Copy button beside every primitive value and chip (default true); false hides them.
 */
export function JsonPane({ value: given, label, testId, toggle = true, hot, alert, deep = false, view: forced, defaultView = 'form', actions, copyFields = true }) {
  const [chosen] = useJsonView(defaultView);
  const jsonOnly = useContext(JsonOnlyContext);
  const mode = forced ?? (jsonOnly ? 'json' : chosen);
  const showToggle = toggle && !forced && !jsonOnly;
  const value = given === undefined ? '' : given; // a missing value is an empty pane, never the word "undefined"
  const hotSet = hot && hot.length ? new Set([...HOT_KEYS, ...hot]) : HOT;
  const alertSet = alert === false ? NO_ALERT : alert && alert.length ? new Set([...ALERT_KEYS, ...alert]) : ALERT;
  const base = deep ? deepParse(value) : value;
  const fromText = typeof base === 'string' ? parseJsonText(base) : undefined;
  const wire = fromText === undefined ? splitWire(base) : undefined;
  if (wire) {
    return (
      <div className="jp-wire" data-testid={testId ? `${testId}-box` : undefined}>
        <pre className="jp-raw jp-raw--head" tabIndex={0} aria-label={label ? `${label} headers` : 'Headers'} data-testid={testId ? `${testId}-head` : undefined}>{visible(wire.head)}</pre>
        <JsonPane value={wire.body} label={label ? `${label} body` : 'Body'} testId={testId ? `${testId}-body` : undefined} toggle={toggle} hot={hot} alert={alert} view={forced} defaultView={defaultView} copyFields={copyFields} />
      </div>
    );
  }
  const data = fromText !== undefined ? fromText : base;
  const isJson = typeof data === 'object' && data !== null;
  // A string is shown EXACTLY as given in the JSON view (a hashed or signed payload must not be re-serialized: key order, number text, spacing).
  // The Form view reads the parsed value. Only a value that is an object or array is laid out with JSON.stringify.
  let text;
  try {
    text = typeof base === 'string' ? base : isJson ? JSON.stringify(data, null, 2) : JSON.stringify(base);
  } catch {
    text = String(base); // circular or too deep to serialize: show what String() gives
  }
  if (text === undefined) text = String(base); // functions, symbols
  const bar = (isJson && showToggle) || actions;
  // Safety: a very large payload is shown as plain text (no colouring, no form) so a page can never freeze on it.
  if (text.length > MAX_PANE_CHARS) {
    return (
      <div className="jp-box" data-testid={testId ? `${testId}-box` : undefined} data-view="text">
        {actions && <div className="jp-bar">{actions}</div>}
        <pre className="jp-raw" tabIndex={0} aria-label={label} data-testid={testId}>{visible(text)}</pre>
      </div>
    );
  }
  const asForm = isJson && mode === 'form';
  return (
    <div className="jp-box" data-testid={testId ? `${testId}-box` : undefined} data-view={isJson ? mode : 'text'}>
      {bar && (
        <div className="jp-bar">
          {actions}
          {isJson && showToggle && <JsonViewToggle view={mode} label={`${label || 'JSON'} view`} />}
        </div>
      )}
      {asForm ? (
        <div className="jp-form" tabIndex={0} role="group" aria-label={label} data-testid={testId}>
          <CopyFieldsContext.Provider value={copyFields}><Form value={data} hot={hotSet} alert={alertSet} /></CopyFieldsContext.Provider>
        </div>
      ) : (
        <pre className="jp-raw" tabIndex={0} aria-label={label} data-testid={testId}>
          {isJson ? <RawJson text={text} hot={hotSet} alert={alertSet} /> : kindOf(text) === 'token' ? <Jwt text={text} /> : visible(text)}
        </pre>
      )}
    </div>
  );
}

export default JsonPane;
