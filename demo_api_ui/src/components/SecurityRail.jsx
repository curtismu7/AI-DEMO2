import React from 'react';

const STATUS_LABELS = { waiting: 'WAITING', checking: 'CHECKING…', permit: 'PERMIT', deny: 'DENY' };
const STATUS_COLORS = {
  waiting:  { bg: 'rgba(100,100,120,0.12)', color: '#8892a4', iconBg: 'rgba(100,100,120,0.12)' },
  checking: { bg: 'rgba(79,142,247,0.15)',  color: '#4f8ef7', iconBg: 'rgba(79,142,247,0.15)' },
  permit:   { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e', iconBg: 'rgba(34,197,94,0.15)' },
  deny:     { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', iconBg: 'rgba(239,68,68,0.15)' },
};

const EVENT_DOT_COLORS = { success: '#22c55e', permit: '#22c55e', error: '#ef4444', acquiring: '#4f8ef7', exchanged: '#a78bfa', indeterminate: '#f59e0b' };

export default function SecurityRail({ gates = [], actClaim = null, tokenEvents = [], onReplay }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface, #1a1d27)', borderLeft: '1px solid var(--border, #2e3347)', overflow: 'hidden', minWidth: 320 }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border, #2e3347)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #e2e8f0)' }}>Security Gates</span>
        <span style={{ fontSize: 11, color: 'var(--muted, #8892a4)', marginLeft: 'auto' }}>We don't control the agent — we control the gates</span>
      </div>

      {/* Gates */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #2e3347)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {gates.map((gate) => {
          const sc = STATUS_COLORS[gate.status] || STATUS_COLORS.waiting;
          return (
            <div key={gate.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #2e3347)', background: 'var(--surface2, #242838)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: sc.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{gate.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text, #e2e8f0)' }}>{gate.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8892a4)', marginTop: 1 }}>{gate.desc}</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>
                {STATUS_LABELS[gate.status] || gate.status.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Act claim badge */}
      {actClaim && (
        <div style={{ margin: '10px 16px', padding: '8px 12px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 6, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a78bfa', marginBottom: 4 }}>Delegated Token — act claim (RFC 8693)</div>
          <pre style={{ fontSize: 11, fontFamily: "'SF Mono','Fira Mono',monospace", color: '#c4b5fd', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(actClaim, null, 2)}</pre>
        </div>
      )}

      {/* Token events */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted, #8892a4)' }}>Token Events</span>
          <button
            onClick={onReplay}
            style={{ marginLeft: 'auto', fontSize: 11, color: '#4f8ef7', cursor: 'pointer', padding: '3px 8px', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 4, background: 'rgba(79,142,247,0.08)' }}
          >
            Replay
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tokenEvents.map((ev) => (
            <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: EVENT_DOT_COLORS[ev.status] || '#8892a4', marginTop: 4, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text, #e2e8f0)' }}>{ev.label}</div>
                {ev.description && <div style={{ fontSize: 11, color: 'var(--muted, #8892a4)', marginTop: 1, fontFamily: 'monospace' }}>{ev.description}</div>}
              </div>
            </div>
          ))}
          {tokenEvents.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted, #8892a4)', fontStyle: 'italic', paddingTop: 4 }}>Waiting for agent activity…</div>
          )}
        </div>
      </div>
    </div>
  );
}
