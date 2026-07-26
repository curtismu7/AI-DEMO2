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
import './AgentFlowDiagramPanel.css';

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
      className="afd-panel"
      style={{
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
      <div className="afd-header" onPointerDown={handleDragStart}>
        <span className="afd-header-icon" aria-hidden>
          🔀
        </span>
        <div className="afd-header-text">
          <h2 id="afd-title" className="afd-title">
            Agent request flow
          </h2>
          <span className="afd-subtitle">
            {phase === 'running' ? 'Live' : phase === 'done' ? 'Complete' : phase === 'error' ? 'Completed with errors' : 'Overview'}
            {toolName ? ` · ${toolName}` : ''}
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
        
        {steps.length > 0 && (
          <div className="afd-flow" aria-live="polite">
            {steps.map((step, i) => (
              <div key={step.id || i} className={`afd-step afd-step--${step.status}`}>
                <div className="afd-step-rail" aria-hidden>
                  <span className="afd-step-dot" />
                  {i < steps.length - 1 && <span className="afd-step-line" />}
                </div>
                <div className="afd-step-card">
                  <h3 className="afd-step-title">{step.title}</h3>
                  <p className="afd-step-detail">{step.detail}</p>
                  {statusBadge(step.status)}
                </div>
              </div>
            ))}
          </div>
        )}
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

      {/* 8-direction resize handles */}
      <div className="afd-rh afd-rh--n"   onMouseDown={createResizeHandler('n')}  aria-hidden />
      <div className="afd-rh afd-rh--ne"  onMouseDown={createResizeHandler('ne')} aria-hidden />
      <div className="afd-rh afd-rh--e"   onMouseDown={createResizeHandler('e')}  aria-hidden />
      <div className="afd-rh afd-rh--se"  onMouseDown={createResizeHandler('se')} aria-label="Resize" title="Drag to resize" />
      <div className="afd-rh afd-rh--s"   onMouseDown={createResizeHandler('s')}  aria-hidden />
      <div className="afd-rh afd-rh--sw"  onMouseDown={createResizeHandler('sw')} aria-hidden />
      <div className="afd-rh afd-rh--w"   onMouseDown={createResizeHandler('w')}  aria-hidden />
      <div className="afd-rh afd-rh--nw"  onMouseDown={createResizeHandler('nw')} aria-hidden />
    </div>
  );

  return createPortal(panel, document.body);
}
