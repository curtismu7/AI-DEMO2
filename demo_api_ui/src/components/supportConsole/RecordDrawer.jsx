// RecordDrawer.jsx
import React from 'react';
import { buildTimeline } from './buildTimeline';
import { PERMISSION_LABEL } from './resolvePermission';
import OpsAssistantChat from './OpsAssistantChat';

// `permissionFor(actionLabel)` returns the same state the card buttons use.
// Without it the drawer rendered every action as a plain enabled button, so a
// card reading 'Needs approval' still offered the action one click away — and
// for approval- and scope-gated actions the server does not refuse, so it ran.
export default function RecordDrawer({ open, vertical, category, row, customer, query, onClose, onAction, permissionFor }) {
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
            {row.actions.map((a, i) => {
              const state = permissionFor ? permissionFor(a) : 'allowed';
              const allowed = state === 'allowed';
              return (
                <button
                  key={a}
                  type="button"
                  className={i === 0 && allowed ? 'vops-btn vops-btn--primary' : 'vops-btn'}
                  data-permission={state}
                  disabled={!allowed}
                  title={allowed ? a : `${a} — ${PERMISSION_LABEL[state]}`}
                  onClick={() => onAction(a, row, category.id)}
                >
                  {allowed ? a : `🔐 ${a}`}
                </button>
              );
            })}
          </div>
          <OpsAssistantChat vertical={vertical} query={query} />
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
