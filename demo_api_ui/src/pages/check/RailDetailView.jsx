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
              <span className={`s-${catCls}`}><span className="light" /></span>
              {category}
              <span className="n">{catDone.length}/{catChecks.length}</span>
            </div>
          );
        })}
      </aside>
      <div className="detail-pane">
        <div className="detail-head">
          <span className={`s-${cls}`}><span className="light" /></span>
          <h3>{activeCategory}</h3>
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
    </div>
  );
}
