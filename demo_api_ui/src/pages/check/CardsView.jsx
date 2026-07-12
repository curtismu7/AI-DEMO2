// demo_api_ui/src/pages/check/CardsView.jsx
import React from 'react';
import { worst, groupByCategory } from './status';

export default function CardsView({ catalog, results, verdict }) {
  const cats = groupByCategory(catalog, results);
  return (
    <div className="grid">
      {Object.entries(cats).map(([category, checks]) => {
        const done = checks.map((c) => c.result?.status).filter(Boolean);
        const cls = `s-${worst(done)}`;
        const summary = checks.find((c) => c.result?.detail)?.result?.detail || 'Not run';
        return (
          <div className={`card ${cls}`} key={category}>
            <div className="card-top"><span className="light" /><span className="title">{category}</span></div>
            <div className="card-sub">{summary}</div>
          </div>
        );
      })}
    </div>
  );
}
