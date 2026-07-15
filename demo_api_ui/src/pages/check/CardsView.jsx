// demo_api_ui/src/pages/check/CardsView.jsx
import React, { useState } from 'react';
import { worst, groupByCategory } from './status';

export default function CardsView({ catalog, results, verdict }) {
  const cats = groupByCategory(catalog, results);
  const [expanded, setExpanded] = useState(null);
  const expandedChecks = expanded ? cats[expanded] : null;

  return (
    <>
      <div className="grid">
        {Object.entries(cats).map(([category, checks]) => {
          const done = checks.map((c) => c.result?.status).filter(Boolean);
          const cls = `s-${worst(done)}`;
          const summary = checks.find((c) => c.result?.detail)?.result?.detail || 'Not run';
          return (
            <div
              className={`card ${cls}`}
              key={category}
              onClick={() => setExpanded(expanded === category ? null : category)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded(expanded === category ? null : category);
                }
              }}
            >
              <div className="card-top"><span className="chk-light" /><span className="title">{category}</span></div>
              <div className="card-sub">{summary}</div>
            </div>
          );
        })}
      </div>

      {expandedChecks && (
        <div className="chk-rows" style={{ marginTop: 14 }}>
          {expandedChecks.map((c) => (
            <div className={`chk-row s-${c.result?.status || 'idle'}`} key={c.id}>
              <span className="chk-light" />
              <span className="name">
                {c.name}
                {(c.severity === 'gate' || c.severity === 'blocking') && (
                  <span className="chk-gate-badge" title="Required for READY">Required</span>
                )}
              </span>
              <span className="detail">
                {c.result?.detail || 'Not run'}
                {c.result?.nextAction && (
                  <span className="chk-next"> → {c.result.nextAction}</span>
                )}
              </span>
              {c.result?.meta && (
                <details className="chk-meta">
                  <summary>Detail</summary>
                  <pre>{JSON.stringify(c.result.meta, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
