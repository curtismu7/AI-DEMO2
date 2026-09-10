// banking_api_ui/src/components/AgentFlowDiagramPanel.js
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';
import { useExchangeMode } from '../context/ExchangeModeContext';
import { useEducationUIOptional } from '../context/EducationUIContext';
import { useTokenChainOptional } from '../context/TokenChainContext';
import TokenExchangeFlowDiagram from './TokenExchangeFlowDiagram';
import JsonHighlight from './shared/JsonHighlight';
import { buildSequenceLayout, nextPlayIndex } from '../utils/stepReplay';
import './AgentFlowDiagramPanel.css';

const REPLAY_TICK_MS = 900;
const SEQ_ROW_H = 34;
const SEQ_TOP_PAD = 12;
const ACTOR_LABELS = { browser: 'Browser', bff: 'BFF', pingone: 'PingOne' };
function actorLabel(actor) {
  return ACTOR_LABELS[actor] || actor.charAt(0).toUpperCase() + actor.slice(1);
}

function statusBadge(status) {
  const labels = { pending: 'Waiting', active: 'In progress', done: 'Done', error: 'Issue' };
  const cls = `afd-badge afd-badge--${status}`;
  return <span className={cls}>{labels[status] || status}</span>;
}

/** One-line teaching tip per common token-chain event id. */
const EVENT_HOP_WHY = {
  'user-token': 'Subject token from PingOne login — identity of the human, held in the BFF session.',
  'agent-actor-token': 'Actor token — the agent’s own client-credentials identity (separate from the user).',
  'exchanged-token': 'RFC 8693 exchange result — delegated token proving the agent acts FOR this user.',
  'two-ex-final-token': 'Second-hop delegated token — nested act chain for agent-to-agent (2-exchange).',
  'exchange-failed': 'Token exchange failed — no delegated MCP token was issued for this call.',
  'gw-authorize': 'Gateway authorize hop — policy decision at the Agent Gateway edge.',
  'gw-introspection': 'RFC 7662 introspection — is the token still active / revoked?',
};

/**
 * Token chain card — request/response teaching detail is always inline
 * (same contract as TraceRail TraceStepCard; no click-to-reveal).
 */
export function TokenEventCard({ event, resolvedIdentity }) {
  function fmtSub(sub) {
    if (!sub) return null;
    const s = String(sub);
    if (resolvedIdentity?.currentUser?.sub && s === resolvedIdentity.currentUser.sub && resolvedIdentity.currentUser.name) {
      return `${resolvedIdentity.currentUser.name} (${s.slice(0, 8)}…)`;
    }
    return s.length > 16 ? s.slice(0, 14) + '…' : s;
  }

  function fmtAct(act) {
    if (!act) return null;
    const clientId = typeof act === 'object' ? act.client_id : String(act);
    if (!clientId) return null;
    const known = resolvedIdentity?.knownClients?.[clientId];
    return known ? `${known} (${String(clientId).slice(0, 8)}…)` : String(clientId).slice(0, 14) + '…';
  }

  const claims = event.jwtFullDecode?.claims || event.claims || null;
  const aud = claims?.aud ?? event.aud ?? event.tokenAud ?? event.audience
    ?? event.exchangeRequest?.audience ?? event.exchangeRequest?.resource ?? null;
  const scopeAfter = claims?.scope ?? event.tokenScope ?? event.scope ?? event.exchangeRequest?.scope ?? null;
  const scopeBefore = event.scopeBefore ?? event.subjectScope ?? null;
  const err = event.pingoneError || event.error || (event.status === 'failed' || event.status === 'error' ? (event.label || 'failed') : null);
  const hopWhy = event.explanation || EVENT_HOP_WHY[event.id] || null;
  const hasDetail = event.exchangeRequest || event.jwtFullDecode || event.claims || hopWhy || err;
  const tokenTypeLabel = (event.tokenType || event.id || 'token').replace(/_/g, ' ').toUpperCase();
  const audText = aud == null ? null : (Array.isArray(aud) ? aud.join(' ') : String(aud));
  const scopeText = scopeBefore && scopeAfter && String(scopeBefore) !== String(scopeAfter)
    ? `${scopeBefore} → ${scopeAfter}`
    : (scopeAfter != null ? String(scopeAfter) : null);

  return (
    <div className={`afd-tc-card${hasDetail ? ' afd-tc-card--open' : ''}`}>
      <div className="afd-tc-card-header">
        <span className={`afd-tc-type afd-tc-type--${event.tokenType || 'default'}`}>{tokenTypeLabel}</span>
        <span className="afd-tc-label">{event.label || event.description || tokenTypeLabel}</span>
        <span className="afd-tc-time">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      </div>

      <div className="afd-tc-summary">
        {(event.tokenSub || claims?.sub) && (
          <span className="afd-tc-pill afd-tc-pill--sub">👤 {fmtSub(event.tokenSub || claims?.sub)}</span>
        )}
        {(event.tokenAct || claims?.act) && (
          <span className="afd-tc-pill afd-tc-pill--act">act {fmtAct(event.tokenAct || claims?.act)}</span>
        )}
        {audText && (
          <span className="afd-tc-pill afd-tc-pill--aud" title="Audience / resource">aud {audText.length > 28 ? `${audText.slice(0, 26)}…` : audText}</span>
        )}
        {scopeText && (
          <span className="afd-tc-pill afd-tc-pill--scope" title="Scope">scope {scopeText.length > 36 ? `${scopeText.slice(0, 34)}…` : scopeText}</span>
        )}
        {event.status && (
          <span className={`afd-tc-pill afd-tc-pill--status afd-tc-pill--${event.status}`}>{event.status}</span>
        )}
        {err && (
          <span className="afd-tc-pill afd-tc-pill--error" title="Error">{String(err).slice(0, 48)}</span>
        )}
      </div>

      {hasDetail && (
        <div className="afd-tc-detail">
          {hopWhy && (
            <p className="afd-tc-explanation">{hopWhy}</p>
          )}
          {err && !event.explanation && (
            <p className="afd-tc-explanation afd-tc-explanation--error">{String(err)}</p>
          )}
          {event.exchangeRequest && (
            <section className="afd-tc-section">
              <h4 className="afd-tc-section-title">API Request</h4>
              <pre className="afd-tc-pre"><JsonHighlight value={event.exchangeRequest} /></pre>
            </section>
          )}
          {(claims || event.jwtFullDecode) && (
            <section className="afd-tc-section">
              <h4 className="afd-tc-section-title">Token Claims (Response)</h4>
              <pre className="afd-tc-pre"><JsonHighlight value={claims || event.jwtFullDecode} /></pre>
            </section>
          )}
          {event.jwtFullDecode?.header && (
            <section className="afd-tc-section">
              <h4 className="afd-tc-section-title">JWT Header</h4>
              <pre className="afd-tc-pre"><JsonHighlight value={event.jwtFullDecode.header} /></pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Step rail for AgentFlowDiagramPanel: an actor swimlane (only when steps
 * carry actor/toActor — the login flow does, live MCP-call steps don't), the
 * step cards with an optional protocol-detail toggle, and a play/pause/scrub
 * replay control once a completed flow has more than one step to walk
 * through (hidden while a flow is still live — there's nothing to replay yet).
 */
export function StepTimeline({ steps, phase }) {
  const [focusIndex, setFocusIndex] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const stepsKey = steps.map((s) => s.id).join('|');

  useEffect(() => {
    setFocusIndex(null);
    setPlaying(false);
  }, [stepsKey]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setFocusIndex((current) => {
        const { index, done } = nextPlayIndex(current ?? 0, steps.length);
        if (done) setPlaying(false);
        return index;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [playing, steps.length]);

  const showScrubber = steps.length > 1 && phase !== 'running';
  const activeIndex = focusIndex ?? 0;
  const { lane, rows: sequenceRows } = buildSequenceLayout(steps, activeIndex);

  function toggleDetail(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    setFocusIndex((current) => (current === null || current >= steps.length - 1 ? 0 : current));
    setPlaying(true);
  }

  const seqHeight = sequenceRows.length * SEQ_ROW_H + SEQ_TOP_PAD * 2;
  const laneX = (idx) => ((idx + 0.5) / lane.length) * 100;

  return (
    <div className="afd-flow" aria-live="polite">
      {lane.length > 0 && (
        <div className="afd-sequence">
          <div className="afd-sequence-headers" style={{ gridTemplateColumns: `repeat(${lane.length}, 1fr)` }}>
            {lane.map((actor) => (
              <div key={actor} className="afd-sequence-header">{actorLabel(actor)}</div>
            ))}
          </div>
          <div className="afd-sequence-body">
            <svg
              className="afd-sequence-svg"
              width="100%"
              height={seqHeight}
              viewBox={`0 0 100 ${seqHeight}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Sequence diagram"
            >
              {lane.map((actor, i) => (
                <line
                  key={actor}
                  className="afd-sequence-lifeline"
                  x1={laneX(i)} y1={0}
                  x2={laneX(i)} y2={seqHeight}
                />
              ))}
              {sequenceRows.map((row) => {
                if (row.fromIdx == null) return null;
                const step = steps[row.index];
                const y = SEQ_TOP_PAD + row.index * SEQ_ROW_H + SEQ_ROW_H / 2;
                const cls = `afd-sequence-row${row.highlighted ? ' afd-sequence-row--active' : ''}${row.dimmed ? ' afd-sequence-row--dimmed' : ''}`;
                const x1 = laneX(row.fromIdx);
                const commonProps = {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': step.title || `Step ${row.index + 1}`,
                  onClick: () => setFocusIndex(row.index),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusIndex(row.index); }
                  },
                };
                if (row.isSelf) {
                  return (
                    <g key={row.index} className={cls} {...commonProps}>
                      <path className="afd-sequence-line" d={`M${x1},${y - 5} h6 v10 h-6`} fill="none" />
                    </g>
                  );
                }
                const x2 = laneX(row.toIdx);
                return (
                  <g key={row.index} className={cls} {...commonProps}>
                    <line className="afd-sequence-line" x1={x1} y1={y} x2={x2} y2={y} />
                  </g>
                );
              })}
            </svg>
            {/* Joint dots as HTML, not SVG — a plain <circle> would render as an
                ellipse under this diagram's non-uniform stretch (x in %, y in
                real px). Purely decorative; the clickable target is the <g>
                above, so this stays out of the tab order and off the a11y tree. */}
            <div className="afd-sequence-dots" aria-hidden="true">
              {sequenceRows.map((row) => {
                if (row.fromIdx == null) return null;
                const y = SEQ_TOP_PAD + row.index * SEQ_ROW_H + SEQ_ROW_H / 2;
                const dotCls = `afd-sequence-dot${row.highlighted ? ' afd-sequence-dot--active' : ''}${row.dimmed ? ' afd-sequence-dot--dimmed' : ''}`;
                const x1 = laneX(row.fromIdx);
                if (row.isSelf) {
                  return (
                    <React.Fragment key={row.index}>
                      <span className={dotCls} style={{ left: `${x1}%`, top: y - 5 }} />
                      <span className={dotCls} style={{ left: `${x1}%`, top: y + 5 }} />
                    </React.Fragment>
                  );
                }
                const x2 = laneX(row.toIdx);
                return (
                  <React.Fragment key={row.index}>
                    <span className={dotCls} style={{ left: `${x1}%`, top: y }} />
                    <span className={dotCls} style={{ left: `${x2}%`, top: y }} />
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {steps.map((step, i) => {
        const detailId = step.id || i;
        return (
          <div
            key={detailId}
            className={`afd-step afd-step--${step.status}${i === activeIndex ? ' afd-step--focused' : ''}`}
          >
            <div className="afd-step-rail" aria-hidden>
              <span className="afd-step-dot" />
              {i < steps.length - 1 && <span className="afd-step-line" />}
            </div>
            <div className="afd-step-card">
              <h3 className="afd-step-title">{step.title}</h3>
              <p className="afd-step-detail">{step.detail}</p>
              {statusBadge(step.status)}
              {step.protocolDetail && (
                <div className="afd-step-protocol">
                  <button type="button" className="afd-token-toggle" onClick={() => toggleDetail(detailId)}>
                    {expanded.has(detailId) ? 'Hide protocol detail' : 'Show protocol detail'}
                  </button>
                  {expanded.has(detailId) && (
                    <dl className="afd-step-protocol-list">
                      {step.protocolDetail.map(([k, v]) => (
                        <div className="afd-step-protocol-row" key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {showScrubber && (
        <div className="afd-replay">
          <button type="button" className="afd-replay-btn" aria-label="Jump to start" onClick={() => setFocusIndex(0)}>|&laquo;</button>
          <button type="button" className="afd-replay-btn" onClick={() => setFocusIndex((c) => Math.max(0, (c ?? 0) - 1))}>Prev</button>
          <button type="button" className="afd-replay-btn" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" className="afd-replay-btn" onClick={() => setFocusIndex((c) => Math.min(steps.length - 1, (c ?? 0) + 1))}>Next</button>
          <button type="button" className="afd-replay-btn" aria-label="Jump to end" onClick={() => setFocusIndex(steps.length - 1)}>&raquo;|</button>
          <input
            type="range"
            className="afd-replay-range"
            min={0}
            max={steps.length - 1}
            value={activeIndex}
            onChange={(e) => setFocusIndex(Number(e.target.value))}
            aria-label="Step scrubber"
          />
          <span className="afd-replay-count">{activeIndex + 1} / {steps.length}</span>
        </div>
      )}
    </div>
  );
}

// Token chain display — uses live events from TokenChainContext
function TokenChainDisplay({ events, resolvedIdentity }) {
  if (!events || events.length === 0) return <p className="afd-tc-empty">No token events yet.</p>;
  return (
    <div className="afd-tc-list">
      {events.map((ev, i) => (
        <TokenEventCard key={ev.id || i} event={ev} resolvedIdentity={resolvedIdentity} />
      ))}
    </div>
  );
}

// Phase 266 R2: credential-path label map for the panel badge.
const AFD_PATH_LABELS = {
  oauth_bearer: 'OAUTH BEARER PATH',
  api_key:      'API-KEY PATH',
  dual_token:   'ACCESS + ID-TOKEN PATH',
};

const AFD_PATH_COLORS = {
  oauth_bearer: { bg: '#dbeafe', border: '#004687', text: '#004687' },
  api_key:      { bg: '#fef9c3', border: '#ca8a04', text: '#713f12' },
  dual_token:   { bg: '#ccfbf1', border: '#0d9488', text: '#0d9488' },
};

/**
 * Floating, draggable, resizable live diagram: PingOne → Agent → BFF → MCP → tool.
 * State is driven by agentFlowDiagramService (bankingAgentService + BankingAgent).
 */
export default function AgentFlowDiagramPanel() {
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());
  const [showTokenChain, setShowTokenChain] = useState(false);
  const [showFlowDiagram, setShowFlowDiagram] = useState(false);
  // Maximize is a separate on-top-of-the-hook flag, not a bigger drag size —
  // useDraggablePanel is shared by other floating panels, so its pos/size stay
  // exactly as the user left them underneath; maximizing only overrides the
  // rendered style, and restoring returns to that saved pos/size untouched.
  const [maximized, setMaximized] = useState(false);
  const { mode } = useExchangeMode();
  const edu = useEducationUIOptional();
  const tokenChainCtx = useTokenChainOptional();
  const resolvedIdentity = tokenChainCtx?.resolvedIdentity ?? null;
  const credentialPath = tokenChainCtx?.events?.[0]?.credentialPath || 'oauth_bearer';
  const afdPathLabel = AFD_PATH_LABELS[credentialPath] || AFD_PATH_LABELS.oauth_bearer;
  const afdPathColor = AFD_PATH_COLORS[credentialPath] || AFD_PATH_COLORS.oauth_bearer;

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(16, window.innerWidth - 420),
      y: Math.max(72, (window.innerHeight - 480) / 2),
    }),
    { w: 380, h: 440 }
  );

  useEffect(() => {
    const unsub = agentFlowDiagram.subscribe(setSnap);
    return unsub;
  }, []);

  // Show token chain when panel opens
  useEffect(() => {
    if (snap.visible) setShowTokenChain(true);
  }, [snap.visible]);

  useEffect(() => {
    const onOpen = () => {
      agentFlowDiagram.open();
      if (!agentFlowDiagram.getState().steps?.length) {
        agentFlowDiagram.reset();
      }
    };
    window.addEventListener('agent-flow-diagram-open', onOpen);
    return () => window.removeEventListener('agent-flow-diagram-open', onOpen);
  }, []);

  const handleClose = useCallback(() => {
    agentFlowDiagram.close();
  }, []);

  useEffect(() => {
    if (!snap.visible) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [snap.visible, handleClose]);

  if (!snap.visible) return null;

  const { steps, hint, phase, toolName, serverEvents = [] } = snap;

  const panel = (
    <div
      className={`afd-panel${maximized ? ' afd-panel--maximized' : ''}`}
      style={maximized ? undefined : {
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="afd-title"
    >
      <div className="afd-header" onPointerDown={maximized ? undefined : handleDragStart}>
        <span className="afd-header-icon" aria-hidden>
          🔀
        </span>
        <div className="afd-header-text">
          <h2 id="afd-title" className="afd-title">
            Agent request flow
          </h2>
          <span className="afd-subtitle">
            {/* Login's steps render on their own page (/login-flow), not here —
                so this panel reads as a generic overview for that case rather
                than advertising "login" content it no longer shows. */}
            {toolName === 'login'
              ? 'Overview'
              : (phase === 'running' ? 'Live' : phase === 'done' ? 'Complete' : phase === 'error' ? 'Completed with errors' : 'Overview')}
            {toolName && toolName !== 'login' ? ` · ${toolName}` : ''}
          </span>
          {/* Phase 266 R2: show credential path badge when a path is active */}
          {tokenChainCtx?.events?.length > 0 && (
            <span style={{
              display: 'inline-block',
              marginTop: 2,
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: '0.6rem',
              fontWeight: 700,
              background: afdPathColor.bg,
              border: `1px solid ${afdPathColor.border}`,
              color: afdPathColor.text,
              letterSpacing: 0.3,
            }}>
              {afdPathLabel}
            </span>
          )}
        </div>
        <div className="afd-header-actions">
          <button
            type="button"
            className="afd-btn"
            onClick={() => setMaximized(v => !v)}
            title={maximized ? 'Restore' : 'Maximize'}
            aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
          >
            {maximized ? '⤡' : '⤢'}
          </button>
          <button
            type="button"
            className="afd-btn"
            onClick={() => agentFlowDiagram.reset()}
            title="Clear diagram (keep panel open)"
            aria-label="Reset diagram"
          >
            ↺
          </button>
          <button type="button" className="afd-btn afd-btn--close" onClick={handleClose} title="Close" aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="afd-body">
        {hint && steps.length === 0 && <p className="afd-hint">{hint}</p>}
        {hint && steps.length > 0 && phase === 'idle' && <p className="afd-hint">{hint}</p>}
        {steps.length === 0 && !hint && <p className="afd-empty">Use the Banking Agent (e.g. My Accounts) — this panel updates on each MCP tool call.</p>}

        {/* Token Exchange Flow Diagram — collapsible */}
        <div className="afd-flow-section">
          <div className="afd-flow-section-header">
            <span className="afd-flow-section-title">
              {mode === 'double' ? '2-Token Exchange Flow (RFC 8693 §4)' : '1-Exchange Flow (RFC 8693 §2.1)'}
            </span>
            <button
              type="button"
              className="afd-token-toggle"
              onClick={() => setShowFlowDiagram(v => !v)}
              aria-expanded={showFlowDiagram}
            >
              {showFlowDiagram ? 'Hide' : 'Show'}
            </button>
          </div>
          {showFlowDiagram && (
            <TokenExchangeFlowDiagram
              mode={mode}
              className="afd-flow-diagram"
              onEducation={panelId => edu && edu.open(panelId)}
            />
          )}
        </div>
        
        {/* Token chain — live events from TokenChainContext, clickable for API call detail */}
        {showTokenChain && (() => {
          const liveEvents = tokenChainCtx?.events ?? [];
          return (
            <div className="afd-token-section">
              <div className="afd-token-header">
                <span>Token Chain ({liveEvents.length})</span>
                <button
                  type="button"
                  className="afd-token-toggle"
                  onClick={() => setShowTokenChain(v => !v)}
                >
                  Hide
                </button>
              </div>
              <TokenChainDisplay events={liveEvents} resolvedIdentity={resolvedIdentity} />
            </div>
          );
        })()}
        
        {/* Login's sequence diagram now lives on its own page (/login-flow) —
            this panel goes back to just the live MCP tool-call steps. */}
        {steps.length > 0 && toolName !== 'login' && <StepTimeline steps={steps} phase={phase} />}
        {serverEvents.length > 0 && (
          <div className="afd-sse-block" aria-live="polite">
            <h3 className="afd-sse-title">Live server phases (SSE)</h3>
            <ul className="afd-sse-list">
              {serverEvents.map((ev, idx) => (
                <li key={`${ev.phase}-${ev.t || idx}-${idx}`} className="afd-sse-row">
                  <span className="afd-sse-label">{ev.label}</span>
                  <span className="afd-sse-detail">{ev.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      {/* 8-direction resize handles — meaningless at a fixed maximized size */}
      {!maximized && (
        <>
          <div className="afd-rh afd-rh--n"   onMouseDown={createResizeHandler('n')}  aria-hidden />
          <div className="afd-rh afd-rh--ne"  onMouseDown={createResizeHandler('ne')} aria-hidden />
          <div className="afd-rh afd-rh--e"   onMouseDown={createResizeHandler('e')}  aria-hidden />
          <div className="afd-rh afd-rh--se"  onMouseDown={createResizeHandler('se')} aria-label="Resize" title="Drag to resize" />
          <div className="afd-rh afd-rh--s"   onMouseDown={createResizeHandler('s')}  aria-hidden />
          <div className="afd-rh afd-rh--sw"  onMouseDown={createResizeHandler('sw')} aria-hidden />
          <div className="afd-rh afd-rh--w"   onMouseDown={createResizeHandler('w')}  aria-hidden />
          <div className="afd-rh afd-rh--nw"  onMouseDown={createResizeHandler('nw')} aria-hidden />
        </>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
