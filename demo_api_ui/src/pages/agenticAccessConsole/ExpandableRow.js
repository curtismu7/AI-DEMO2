import React, { useState } from "react";

/** Plain key/value rendering of a detail object — one row per top-level field.
 * Nested objects/arrays render as compact JSON inline rather than a full
 * recursive tree; that's enough depth for the records this renders (policy
 * rule nodes, specialist config). */
function DetailForm({ detail }) {
  if (typeof detail === "string") return <p className="aac-card-body">{detail}</p>;
  const entries = Object.entries(detail || {});
  if (entries.length === 0) return <p className="aac-card-sub">No detail available.</p>;
  return (
    <dl className="aac-detail-form">
      {entries.map(([key, value]) => (
        <div className="aac-detail-form__row" key={key}>
          <dt className="aac-mono">{key}</dt>
          <dd>
            {value === null || value === undefined || value === ""
              ? <span className="aac-card-sub">—</span>
              : typeof value === "object"
                ? <span className="aac-mono">{JSON.stringify(value)}</span>
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A table row that expands in place (click or keyboard) to show a detail
 * block underneath — used anywhere a row's real data is richer than what
 * fits in its visible cells (P1AZ Policies rules, Agents specialists).
 * The detail view defaults to a readable Form; a JSON toggle shows it raw. */
export default function ExpandableRow({ cells, detail }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("form");
  return (
    <>
      <tr
        className="aac-table-row--clickable"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
      >
        {cells}
      </tr>
      {open && (
        <tr className="aac-table-row--detail">
          <td colSpan={cells.length}>
            <div className="aac-filter-bar" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`aac-filter-btn${view === "form" ? " aac-filter-btn--active" : ""}`}
                onClick={() => setView("form")}
              >
                Form
              </button>
              <button
                type="button"
                className={`aac-filter-btn${view === "json" ? " aac-filter-btn--active" : ""}`}
                onClick={() => setView("json")}
              >
                JSON
              </button>
            </div>
            {view === "form"
              ? <DetailForm detail={detail} />
              : <pre className="aac-prompt-block">{typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
