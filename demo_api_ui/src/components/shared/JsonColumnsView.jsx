import React, { useMemo, useState } from "react";
import JsonHighlight from "./JsonHighlight";
import "./JsonColumnsView.css";

function typeOf(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isExpandable(v) {
  return v !== null && typeof v === "object";
}

function preview(v) {
  const t = typeOf(v);
  if (t === "object") return `{${Object.keys(v).length}}`;
  if (t === "array") return `[${v.length}]`;
  if (t === "string") return v.length > 22 ? `"${v.slice(0, 22)}…"` : `"${v}"`;
  return String(v);
}

// Miller-column browser for a JSON claims object (e.g. a nested RFC 8693 `act`
// delegation chain) — drill into a nested key without losing the parent
// column, unlike the flat Raw view. Read-only.
export default function JsonColumnsView({ value }) {
  const [path, setPath] = useState([]);
  const [leaf, setLeaf] = useState(null);

  const columns = useMemo(() => {
    const cols = [{ label: "root", obj: value }];
    let cursor = value;
    for (const key of path) {
      if (cursor && typeof cursor === "object" && key in cursor) {
        cursor = cursor[key];
        cols.push({ label: key, obj: cursor });
      } else {
        break;
      }
    }
    return cols;
  }, [value, path]);

  if (value === null || value === undefined) {
    return <div className="jcv-empty">Nothing selected yet.</div>;
  }
  if (typeof value !== "object") {
    return <JsonHighlight value={value} />;
  }

  const deepest = columns[columns.length - 1];
  const detailValue = leaf ? leaf.value : deepest.obj;
  const detailPath = leaf ? [...path.slice(0, leaf.colIdx), leaf.key] : path;

  return (
    <div className="jcv-columns">
      {columns.map((col, colIdx) => (
        <div className="jcv-col" key={colIdx}>
          <div className="jcv-col-label">{col.label}</div>
          {col.obj && typeof col.obj === "object" &&
            Object.entries(col.obj).map(([k, v]) => {
              const expandable = isExpandable(v);
              const selected = expandable
                ? path[colIdx] === k
                : leaf && leaf.colIdx === colIdx && leaf.key === k;
              return (
                <button
                  type="button"
                  key={k}
                  className={
                    "jcv-row" +
                    (expandable ? "" : " jcv-row--leaf") +
                    (selected ? " jcv-row--selected" : "")
                  }
                  onClick={() => {
                    if (expandable) {
                      setPath((prev) => [...prev.slice(0, colIdx), k]);
                      setLeaf(null);
                    } else {
                      setLeaf({ colIdx, key: k, value: v });
                    }
                  }}
                >
                  <span className="jcv-row-key">{k}</span>
                  <span className="jcv-row-preview">{preview(v)}</span>
                  {expandable && <span className="jcv-row-caret">{"›"}</span>}
                </button>
              );
            })}
        </div>
      ))}
      <div className="jcv-col jcv-col--detail">
        <div className="jcv-col-label">preview</div>
        <div className="jcv-detail-path">{["root", ...detailPath].join(" › ")}</div>
        <pre className="jcv-detail-value">
          <JsonHighlight value={detailValue} />
        </pre>
      </div>
    </div>
  );
}
