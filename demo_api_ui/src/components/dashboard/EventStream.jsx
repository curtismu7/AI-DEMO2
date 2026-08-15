import React from 'react';

/**
 * columns: Array<{ key, label, className?, render?(row) }>
 *
 * A column is plain-value-only by default — the cell renders String(row[key]).
 * `render` is an explicit, per-column opt-in for a caller that needs markup
 * in a cell (e.g. a severity dot); omit it and the default plain-text
 * guarantee holds for every other column and every other caller.
 *
 * `emptyMessage` overrides the default "no rows" text — callers use it to
 * say "no matches for this search term" instead of "no events in this
 * window" when a search is active. Those are different facts; conflating
 * them tells the operator the wrong thing (an empty window vs. a term that
 * just doesn't appear in an otherwise busy one).
 */
export default function EventStream({ columns, rows, emptyMessage }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="dash-msg" role="status">
        {emptyMessage || 'No events in this window.'}
      </div>
    );
  }
  return (
    <div className="dash-tbl-wrap">
      <table className="dash-tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.timestamp || 'row'}-${i}`}>
              {columns.map((c) => {
                let content;
                if (c.render) {
                  content = c.render(r);
                } else {
                  const val = r[c.key];
                  content = val === null || val === undefined ? '' : String(val);
                }
                return (
                  <td key={c.key} className={c.className || ''}>{content}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
