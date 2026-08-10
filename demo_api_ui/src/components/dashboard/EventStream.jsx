import React from 'react';

export default function EventStream({ columns, rows }) {
  if (!rows || rows.length === 0) {
    return <div className="dash-msg" role="status">No events in this window.</div>;
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
                const val = r[c.key];
                let content = '';
                if (React.isValidElement(val)) {
                  // Lets a caller (e.g. a severity dot) pass pre-rendered
                  // markup for a cell instead of a plain value.
                  content = val;
                } else if (val !== null && val !== undefined) {
                  content = String(val);
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
