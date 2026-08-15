import React from 'react';

/**
 * Labelled counts with a bar scaled to the largest item. Zero items still
 * render — their absence is the signal on a posture strip.
 */
export default function StatStrip({ items }) {
  const peak = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="dash-strip">
      {items.map((i) => {
        const n = Number(i.value) || 0;
        const tone = i.tone && i.tone !== 'default' ? ` tone-${i.tone}` : '';
        return (
          <div key={i.key} className={`dash-stat${n === 0 ? ' is-zero' : ''}${tone}`}
               data-testid={`stat-${i.key}`}>
            <span className="dash-stat-label">{i.label}</span>
            <span className="dash-stat-value">{n}</span>
            {i.note ? <span className="dash-stat-note">{i.note}</span> : null}
            <div className="dash-stat-bar" style={{ width: `${(n / peak) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
