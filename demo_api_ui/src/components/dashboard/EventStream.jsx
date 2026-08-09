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
              {columns.map((c) => (
                <td key={c.key} className={c.className || ''}>
                  {r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
