// demo_api_ui/src/components/A2AFlowVisualizer.jsx
import React, { useMemo, useState } from 'react';
import A2ATokenFlowDiagram from './A2ATokenFlowDiagram';
import './A2AFlowVisualizer.css';

/**
 * A2AFlowVisualizer — animated, two-plane packet flow built from real
 * tokenEvents (live run or recorded replay). Each event becomes a "packet"
 * chip traveling between actor lanes, staggered so the chain plays in event
 * order. Click a packet to expand the actual evidence JSON (decoded claims,
 * exchange request, protocol request/response) — the same redacted artifacts
 * the token panes show; raw token strings never enter these events.
 *
 * Lane mapping is derived from each event's a2aRole/id — no per-vertical
 * special cases. Unknown event ids fall back to a generic PingOne packet so a
 * captured run with a new event type still renders instead of vanishing.
 */

const ACTOR_ORDER = ['user', 'generalist', 'pingone', 'specialist', 'gateway'];

const PLANE = {
  identity: 'identity',
  wire: 'wire',
};

const FALLBACK = {
  from: 'pingone',
  to: 'generalist',
  plane: PLANE.identity,
};

function eventMeta(ev) {
  switch (ev?.id) {
    case 'user-token':
      return { from: 'user', to: 'generalist', plane: PLANE.identity, verb: 'presents subject token' };
    case 'a2a-agent1-actor':
      return { from: 'generalist', to: 'pingone', plane: PLANE.identity, verb: 'client_credentials (actor)' };
    case 'a2a-exchange1':
      return { from: 'pingone', to: 'generalist', plane: PLANE.identity, verb: 'Exchange #1 · RFC 8693 delegated token' };
    case 'a2a-agent2-actor':
      return { from: 'specialist', to: 'pingone', plane: PLANE.identity, verb: 'client_credentials (actor)' };
    case 'a2a-exchange2':
      return { from: 'pingone', to: 'specialist', plane: PLANE.identity, verb: 'Exchange #2 · nested act' };
    case 'a2a-protocol-bearer':
      return { from: 'generalist', to: 'specialist', plane: PLANE.wire, verb: 'wire bearer · Exchange #1 token' };
    case 'a2a-agent-card':
      return { from: 'generalist', to: 'specialist', plane: PLANE.wire, verb: 'Agent Card discovery' };
    case 'a2a-protocol-message':
      return { from: 'generalist', to: 'specialist', plane: PLANE.wire, verb: 'SendMessage · JSON-RPC message/send' };
    default:
      return FALLBACK;
  }
}

function scopeOf(ev) {
  const raw = ev?.claims?.scope || ev?.scope || null;
  if (!raw) return null;
  const scopes = String(raw).split(/\s+/).filter(Boolean);
  return scopes.length > 1 ? `${scopes.length} scopes · ${scopes[scopes.length - 1]}` : scopes[0];
}

function actDepth(ev) {
  let depth = 0;
  let node = ev?.claims?.act;
  while (node && typeof node === 'object') {
    depth += 1;
    node = node.act;
  }
  return depth;
}

function statusOf(ev) {
  const s = String(ev?.status || '').toLowerCase();
  return ['error', 'failed', 'failure', 'denied'].includes(s) ? 'error' : 'ok';
}

export default function A2AFlowVisualizer({ tokenEvents, labels }) {
  const [openKey, setOpenKey] = useState(null);
  const [replayKey, setReplayKey] = useState(0);
  const [mode, setMode] = useState('canvas'); // 'canvas' | 'timeline'

  const events = useMemo(
    () => (Array.isArray(tokenEvents) ? tokenEvents.filter(Boolean) : []),
    [tokenEvents],
  );

  const packets = useMemo(
    () => events.map((ev, index) => ({ ev, index, meta: eventMeta(ev) })),
    [events],
  );

  const lanes = useMemo(() => {
    const present = new Set();
    packets.forEach(({ meta }) => {
      present.add(meta.from);
      present.add(meta.to);
    });
    return ACTOR_ORDER.filter((a) => present.has(a)).map((id) => ({
      id,
      label: labels?.[id] || {
        user: 'User',
        generalist: 'Generalist Agent',
        pingone: 'PingOne',
        specialist: 'Specialist',
        gateway: 'MCP Gateway',
      }[id],
    }));
  }, [packets, labels]);

  if (!packets.length) return null;

  const laneIndex = Object.fromEntries(lanes.map((l, i) => [l.id, l]));
  const laneIndexById = (id) => laneIndex[id] ?? 0;

  return (
    <div className="a2fv" data-replay={replayKey}>
      <div className="a2fv-toolbar">
        <button
          type="button"
          className="a2fv-replay"
          onClick={() => { setOpenKey(null); setReplayKey((n) => n + 1); }}
        >
          ▶ Replay flow
        </button>
        <span className="a2fv-legend">
          <span className="a2fv-legend-chip a2fv-legend-chip--identity">Identity · RFC 8693</span>
          <span className="a2fv-legend-chip a2fv-legend-chip--wire">Wire · A2A protocol</span>
        </span>
        <span className="a2fv-mode" role="group" aria-label="Diagram mode">
          <button
            type="button"
            className={`a2fv-mode-btn${mode === 'canvas' ? ' a2fv-mode-btn--on' : ''}`}
            aria-pressed={mode === 'canvas'}
            onClick={() => setMode('canvas')}
          >
            Token canvas
          </button>
          <button
            type="button"
            className={`a2fv-mode-btn${mode === 'timeline' ? ' a2fv-mode-btn--on' : ''}`}
            aria-pressed={mode === 'timeline'}
            onClick={() => setMode('timeline')}
          >
            Timeline
          </button>
        </span>
      </div>

      {mode === 'canvas' ? (
        <A2ATokenFlowDiagram tokenEvents={events} labels={labels} />
      ) : (
      <div className="a2fv-canvas" style={{ '--a2fv-lanes': lanes.length }}>
        {lanes.map((lane) => (
          <div key={lane.id} className="a2fv-lane" data-lane={lane.id}>
            <div className="a2fv-lane-head">{lane.label}</div>
          </div>
        ))}
        <div className="a2fv-wires" aria-hidden="true">
          {lanes.slice(0, -1).map((lane, i) => (
            <div
              key={lane.id}
              className="a2fv-wire"
              style={{ '--lane': i + 1 }}
            />
          ))}
        </div>

        {packets.map(({ ev, index, meta }) => {
          const from = laneIndexById(meta.from);
          const to = laneIndexById(meta.to);
          const left = Math.min(from, to);
          const width = Math.abs(to - from);
          const key = ev.id || `ev-${index}`;
          const open = openKey === key;
          const scope = scopeOf(ev);
          const depth = actDepth(ev);
          const evidence = ev.claims || ev.exchangeRequest || ev.protocolRequest || ev.protocolResponse || ev.agentCard;
          return (
            <React.Fragment key={key}>
              <button
                type="button"
                className={`a2fv-packet a2fv-packet--${meta.plane}${statusOf(ev) === 'error' ? ' a2fv-packet--error' : ''}`}
                style={{
                  '--from': from,
                  '--span': Math.max(width, 1),
                  '--step': index,
                  left: `calc(${(left / lanes.length) * 100}% + 8px)`,
                }}
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : key)}
              >
                <span className="a2fv-packet-step">{index + 1}</span>
                <span className="a2fv-packet-verb">{meta.verb}</span>
                {(scope || depth > 0) && (
                  <span className="a2fv-packet-claims">
                    {scope && <span className="a2fv-scope">{scope}</span>}
                    {depth > 0 && <span className="a2fv-depth">act ×{depth}</span>}
                  </span>
                )}
              </button>
              {open && evidence != null && (
                <div
                  className="a2fv-detail"
                  style={{ '--step': index, top: `${(index + 1) * 64 + 56}px` }}
                >
                  <div className="a2fv-detail-head">
                    <span className="a2fv-detail-title">{ev.label || key}</span>
                    <button
                      type="button"
                      className="a2fv-detail-close"
                      onClick={() => setOpenKey(null)}
                      aria-label="Close detail"
                    >
                      ✕
                    </button>
                  </div>
                  <pre className="a2fv-detail-json">{JSON.stringify(evidence, null, 2)}</pre>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      )}

      <p className="a2fv-footnote">
        Click any packet to inspect the real claims, request, or response that hop carried.
        Packets are built from this run&apos;s token-chain events; no raw token strings are ever shown.
      </p>
    </div>
  );
}
