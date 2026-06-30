// RecordDrawer.jsx
import React from 'react';
import { buildTimeline } from './buildTimeline';

export default function RecordDrawer({ open, category, row, customer, onClose, onAction }) {
  if (!open || !row) return <div className="vops-scrim" aria-hidden="true" />;
  return (
    <>
      <div className="vops-scrim vops-scrim--open" onClick={onClose} aria-hidden="true" />
      <aside className="vops-drawer vops-drawer--open" role="dialog" aria-label={row.title}>
        <header className="vops-drawer__head">
          <button className="vops-drawer__x" onClick={onClose} aria-label="Close">✕</button>
          <div className="vops-drawer__cat">{category.icon} {category.label}</div>
          <div className="vops-drawer__title">{row.title}</div>
        </header>
        <div className="vops-drawer__body">
          <div className="vops-kv"><span>Status</span><b>{row.status}</b></div>
          <div className="vops-kv"><span>Detail</span><b>{row.sub}</b></div>
          <div className="vops-kv"><span>Owner</span><b>{customer?.name || '—'}</b></div>
          <div className="vops-drawer__acts">
            {row.actions.map((a, i) => (
              <button key={a} className={i === 0 ? 'vops-btn vops-btn--primary' : 'vops-btn'} onClick={() => onAction(a, row, category.id)}>{a}</button>
            ))}
          </div>
          {/* Ops Assistant stub — wired in the Ops Assistant plan */}
          <div className="vops-assistant-stub" data-testid="ops-assistant-slot" />
          <p className="vops-tl__h">Activity</p>
          <div className="vops-tl">
            {buildTimeline(row, customer?.name).map((e, i) => (
              <div className="vops-tl__e" key={i}><div className="vops-tl__t">{e.title}</div><div className="vops-tl__s">{e.when}</div></div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
