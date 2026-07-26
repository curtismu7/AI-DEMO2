// demo_api_ui/src/components/shared/JsonFormView.jsx
import React, { useCallback, useState } from 'react';
import { deepParse } from './JsonHighlight';
import './JsonFormView.css';

// Keys whose value renders in the "Key Values" summary section in addition
// to its place in the full "All Fields" tree. Generic, name-pattern based —
// deliberately not shape-aware (see design spec's Non-goals).
const IMPORTANT_KEY_WORDS = [
  'id', 'name', 'status', 'amount', 'balance', 'url', 'scope', 'audience',
  'type', 'label', 'email', 'role', 'code', 'message', 'state',
];

const LONG_STRING_LIMIT = 120;

function isImportantKey(key) {
  const lower = key.toLowerCase();
  return IMPORTANT_KEY_WORDS.some((w) => lower.includes(w));
}

function humanizeKey(key) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(String(text)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);
  return (
    <button type="button" className="jfv-copy" onClick={copy}>
      {copied ? '✅' : 'Copy'}
    </button>
  );
}

function LeafValue({ value }) {
  const [expanded, setExpanded] = useState(false);
  if (value === null || value === undefined) {
    return <span className="jfv-empty">—</span>;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const isLong = text.length > LONG_STRING_LIMIT;
  const shown = isLong && !expanded ? `${text.slice(0, LONG_STRING_LIMIT)}…` : text;
  return (
    <span className="jfv-value">
      <span className="jfv-value-text">{shown}</span>
      {isLong && (
        <button type="button" className="jfv-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      <CopyButton text={text} />
    </span>
  );
}

// Plain recursive function (NOT a React component) so pushes into
// `keyValues` happen synchronously while building the tree, before
// JsonFormView decides whether to render the "Key Values" section.
function buildRows(value, path, keyValues) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <div className="jfv-row jfv-empty">Empty list</div>;
    }
    return (
      <>
        {value.map((item, i) => {
          const itemPath = `${path}[${i}]`;
          if (isPlainObject(item) || Array.isArray(item)) {
            return (
              <div className="jfv-subgroup" key={i}>
                <div className="jfv-subgroup-label">Item {i + 1}</div>
                {buildRows(item, itemPath, keyValues)}
              </div>
            );
          }
          return (
            <div className="jfv-row" key={i}>
              <span className="jfv-label">Item {i + 1}</span>
              <LeafValue value={item} />
            </div>
          );
        })}
      </>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <div className="jfv-row jfv-empty">No fields</div>;
    }
    return (
      <>
        {entries.map(([key, val]) => {
          const fieldPath = path ? `${path}.${key}` : key;
          if (isPlainObject(val) || Array.isArray(val)) {
            return (
              <div className="jfv-subgroup" key={key}>
                <div className="jfv-subgroup-label">{humanizeKey(key)}</div>
                {buildRows(val, fieldPath, keyValues)}
              </div>
            );
          }
          // Only scalar leaves are collected here — an array-valued key (e.g.
          // `scopes`) can't be summarized as one row, even if its name matches;
          // it still renders in full under All Fields via the branch above.
          if (isImportantKey(key)) {
            keyValues.push({
              path: fieldPath,
              label: humanizeKey(fieldPath.replace(/\./g, ' › ')),
              value: val,
            });
          }
          return (
            <div className="jfv-row" key={key}>
              <span className="jfv-label">{humanizeKey(key)}</span>
              <LeafValue value={val} />
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="jfv-row">
      <LeafValue value={value} />
    </div>
  );
}

export default function JsonFormView({ value, emptyMessage = 'No data.' }) {
  const normalized = deepParse(value);
  const isEmpty =
    normalized === null ||
    normalized === undefined ||
    (isPlainObject(normalized) && Object.keys(normalized).length === 0);

  if (isEmpty) {
    return <div className="jfv-empty-state">{emptyMessage}</div>;
  }

  const keyValues = [];
  const tree = buildRows(normalized, '', keyValues);

  return (
    <div className="jfv-root">
      {keyValues.length > 0 && (
        <div className="jfv-section">
          <div className="jfv-section-title">Key Values</div>
          <div className="jfv-group">
            {keyValues.map((kv) => (
              <div className="jfv-row" key={kv.path}>
                <span className="jfv-label">{kv.label}</span>
                <LeafValue value={kv.value} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="jfv-section">
        <div className="jfv-section-title">All Fields</div>
        <div className="jfv-group">{tree}</div>
      </div>
    </div>
  );
}
