// demo_api_ui/src/pages/check/RailDetailView.jsx
import React, { useState } from 'react';
import { worst, groupByCategory } from './status';

export default function RailDetailView({ catalog, results, verdict }) {
  const cats = groupByCategory(catalog, results);
  const categories = Object.keys(cats);
  const [selected, setSelected] = useState(categories[0]);
  const activeCategory = categories.includes(selected) ? selected : categories[0];
  const checks = cats[activeCategory] || [];
  const done = checks.map((c) => c.result?.status).filter(Boolean);
  const cls = worst(done);

  return (
    <div className="split">
      <aside className="rail">
        {categories.map((category) => {
          const catChecks = cats[category];
          const catDone = catChecks.map((c) => c.result?.status).filter(Boolean);
          const catCls = worst(catDone);
          return (
            <div
              className={`rail-item${category === activeCategory ? ' sel' : ''}`}
              key={category}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(category)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(category); }
              }}
            >
              <span className={`s-${catCls}`}><span className="chk-light" /></span>
              {category}
              <span className="n">{catDone.length}/{catChecks.length}</span>
            </div>
          );
        })}
      </aside>
      <div className="detail-pane">
        <div className="detail-head">
          <span className={`s-${cls}`}><span className="chk-light" /></span>
          <h3>{activeCategory}</h3>
        </div>
        <div className="chk-rows">
          {checks.map((c) => (
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
      </div>
    </div>
  );
}
