// demo_api_ui/src/pages/check/ChecklistView.jsx
import React from 'react';
import { worst, groupByCategory } from './status';

export default function ChecklistView({ catalog, results, verdict }) {
  const cats = groupByCategory(catalog, results);
  return (
    <div>
      {Object.entries(cats).map(([category, checks]) => {
        const done = checks.map((c) => c.result?.status).filter(Boolean);
        const cls = worst(done);
        return (
          <div className="group" key={category}>
            <div className="group-head">
              <span className={`s-${cls}`}><span className="light" /></span>
              {category}
              <span className="count">{done.length}/{checks.length}</span>
            </div>
            <div className="rows">
              {checks.map((c) => (
                <div className={`row s-${c.result?.status || 'idle'}`} key={c.id}>
                  <span className="light" />
                  <span className="name">{c.name}</span>
                  <span className="detail">{c.result?.detail || 'Not run'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
