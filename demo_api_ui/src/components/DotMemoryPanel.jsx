import React, { useEffect, useState, useCallback } from 'react';
import ConfirmModal from './ConfirmModal';

/**
 * DotMemoryPanel — what the Dot personal agent has learned about you.
 *
 * OpenAI's dots keep their own working memory across conversations: the
 * preferences and standards they pick up as you work. That memory belongs to
 * the AGENT, not the enterprise — Ping governs every tool call the dot makes,
 * never this panel. "Reset dot" is the user's own lifecycle control and
 * clears everything the dot has learned.
 */

export default function DotMemoryPanel({ refreshNonce = 0, embedded = false }) {
  const [memories, setMemories] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(() => {
    fetch('/api/agent/dot/memory', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { memories: [] }))
      .then((data) => { setMemories(Array.isArray(data.memories) ? data.memories : []); setLoaded(true); })
      .catch(() => { setLoaded(true); });
  }, []);

  useEffect(load, [load, refreshNonce]);

  const removeOne = (timestamp) => {
    // One-entry delete: refetch the list, POST is bulk-only server-side, so
    // deletion of a single entry is a reset + re-save of the survivors.
    // ponytail: O(n) rewrites per delete; fine at the 50-memory cap.
    const survivors = memories.filter((m) => m.timestamp !== timestamp);
    fetch('/api/agent/dot/memory', { method: 'DELETE', credentials: 'include' })
      .then(() => Promise.all(survivors
        .map((m) => fetch('/api/agent/dot/memory', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.text }),
        }))))
      .then(load)
      .catch(load);
  };

  const resetAll = () => {
    setConfirmReset(false);
    fetch('/api/agent/dot/memory', { method: 'DELETE', credentials: 'include' })
      .then(load)
      .catch(load);
  };

  return (
    <div
      data-testid="dot-memory-panel"
      style={{
        // embedded: sits inside another card (the Dot workbench), so fill it and drop the side border.
        width: embedded ? '100%' : 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface, #1a1d27)', borderLeft: embedded ? 'none' : '1px solid var(--border, #2e3347)', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border, #2e3347)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #8ee6da, #2bb3a3 55%, #12766b)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text)' }}>Dot&apos;s memory</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--th-text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          What Dot learned about you. It lives with the agent, not the enterprise —
          reset deletes everything it learned.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {!loaded ? (
          <p style={{ fontSize: 11, color: 'var(--th-text-muted)', padding: '6px 4px' }}>Loading…</p>
        ) : memories.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--th-text-muted)', padding: '6px 4px', lineHeight: 1.6 }}>
            Nothing yet. Tell Dot a preference — &ldquo;Always use a concise tone&rdquo; — and it will remember it here across conversations.
          </p>
        ) : memories.map((m) => (
          <div key={m.timestamp} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 6px', borderRadius: 6, background: 'var(--th-bg-inset, rgba(128,128,128,0.08))', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--th-text)', lineHeight: 1.5, flex: 1 }}>{m.text}</span>
            <button
              type="button"
              onClick={() => removeOne(m.timestamp)}
              title="Forget this"
              aria-label="Forget this memory"
              style={{ background: 'none', border: 'none', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border, #2e3347)' }}>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={memories.length === 0}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 6, cursor: memories.length === 0 ? 'default' : 'pointer',
            border: '1px solid var(--border, #2e3347)', background: 'transparent',
            color: memories.length === 0 ? 'var(--th-text-muted)' : '#f87171', fontSize: 12, fontWeight: 500,
          }}
        >
          Reset dot
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmReset}
        title="Reset Dot"
        message="This clears everything Dot has learned about you. It cannot be undone."
        confirmLabel="Reset Dot"
        cancelLabel="Keep memories"
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
