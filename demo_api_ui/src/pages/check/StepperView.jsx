// demo_api_ui/src/pages/check/StepperView.jsx
import React from 'react';
import { worst, groupByCategory } from './status';

export default function StepperView({ catalog, results, verdict }) {
  const cats = groupByCategory(catalog, results);
  const categories = Object.entries(cats);
  // "Current" phase: the first category not fully passed, else the first category.
  const current = categories.find(([, checks]) => {
    const done = checks.map((c) => c.result?.status).filter(Boolean);
    return worst(done) !== 'pass';
  }) || categories[0];

  return (
    <div>
      <div className="steps">
        {categories.map(([category, checks]) => {
          const done = checks.map((c) => c.result?.status).filter(Boolean);
          const cls = worst(done);
          return (
            <div className={`step s-${cls}`} key={category}>
              <div className="node"><span className="light" /></div>
              <div className="lbl">{category}</div>
            </div>
          );
        })}
      </div>
      {current && (
        <div className="phase-detail">
          <h3>{current[0]}</h3>
          <div className="rows">
            {current[1].map((c) => (
              <div className={`row s-${c.result?.status || 'idle'}`} key={c.id}>
                <span className="light" />
                <span className="name">{c.name}</span>
                <span className="detail">{c.result?.detail || 'Not run'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
