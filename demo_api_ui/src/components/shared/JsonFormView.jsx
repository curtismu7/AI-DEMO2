// demo_api_ui/src/components/shared/JsonFormView.jsx
import React, { useCallback, useState } from 'react';
import { deepParse } from './JsonHighlight';
import './JsonFormView.css';

// Hybrid C+A form view: one collapsible section per top-level key. Scalar
// top-level keys render inline in their section header; objects and arrays
// expand to flat dot-path rows (result.customer.email, items[0].amount) —
// no nested boxes, no duplicated "Key Values" summary.
const LONG_STRING_LIMIT = 120;

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
    return <span className="jfv-empty">null</span>;
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

// Flatten any value into `dot.path[index]` → leaf rows. A branch header row is
// emitted for the root value when it is an object/array.
function flattenRows(value, prefix, rows) {
  if (value === null || value === undefined) {
    rows.push({ path: prefix, value });
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      rows.push({ path: prefix, empty: prefix ? '{ }' : '{ }' });
      return;
    }
    entries.forEach(([key, val]) => flattenRows(val, prefix ? `${prefix}.${key}` : key, rows));
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ path: prefix, empty: '[ ]' });
      return;
    }
    value.forEach((item, i) => flattenRows(item, `${prefix}[${i}]`, rows));
  } else {
    rows.push({ path: prefix, value });
  }
}

function Row({ row }) {
  return (
    <div className="jfv-row">
      <span className="jfv-label">{row.path}</span>
      {row.empty ? <span className="jfv-empty-inline">{row.empty}</span> : <LeafValue value={row.value} />}
    </div>
  );
}

// One collapsible section per top-level key. Scalars show inline in the
// header; branches expand to flat dot-path rows.
function Section({ name, value }) {
  const [open, setOpen] = useState(false);
  const scalar = !isPlainObject(value) && !Array.isArray(value);
  const isEmptyContainer = !scalar && Object.keys(value).length === 0;

  if (scalar) {
    return (
      <div className="jfv-item">
        <div className="jfv-head">
          <span className="jfv-head-name">{name}: </span>
          <LeafValue value={value} />
        </div>
      </div>
    );
  }

  const kind = Array.isArray(value) ? 'array' : 'object';
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  const rows = [];
  if (!isEmptyContainer) flattenRows(value, name, rows);

  return (
    <div className="jfv-item">
      <button type="button" className="jfv-head jfv-head--toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="jfv-caret">{open ? '▾' : '▸'}</span>
        <span className="jfv-head-name">{name}</span>
        <span className="jfv-meta">{kind} · {count} {count === 1 ? (kind === 'array' ? 'item' : 'field') : kind === 'array' ? 'items' : 'fields'}</span>
      </button>
      {open && !isEmptyContainer && (
        <div className="jfv-body">
          {rows.map((row, i) => <Row key={row.path || i} row={row} />)}
        </div>
      )}
      {open && isEmptyContainer && (
        <div className="jfv-body"><div className="jfv-row jfv-empty-inline">{Array.isArray(value) ? '[ ] empty list' : '{ } no fields'}</div></div>
      )}
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

  // Wrap a bare scalar or a top-level array so every payload renders as named
  // sections. A root object's keys become the sections directly.
  const entries = isPlainObject(normalized)
    ? Object.entries(normalized)
    : [[isPlainObject(normalized) || Array.isArray(normalized) ? 'value' : '(value)', normalized]];

  return (
    <div className="jfv-root">
      {entries.map(([name, val]) => <Section key={name} name={name} value={val} />)}
    </div>
  );
}
