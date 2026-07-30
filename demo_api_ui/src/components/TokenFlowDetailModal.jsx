import React, { useState, useEffect, useCallback } from 'react';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildRunStory } from '../services/tokenChainTrace/buildTraceSteps';
import './TokenFlowDetailModal.css';

// ── Helpers ────────────────────────────────────────────────────────────────

const IC = { done: '✓', error: '✕', pending: '·', notinpath: '—', wait: '!' };
const IC_CLS = { done: 'done', error: 'error', pending: 'pending', notinpath: 'skip', wait: 'wait' };

function badgeCls(lane) {
  return `tfd-step-badge tfd-badge-${lane || 'BFF'}`;
}

function inspBadgeCls(lane) {
  return `tfd-insp-lane tfd-badge-${lane || 'BFF'}`;
}

// Extract a concise technical subtitle from step detail
function stepSub(step) {
  if (!step.detail) return null;
  const d = step.detail;
  if (step.id === 'exchange') {
    const aud = d.claims?.aud || d.claims?.audience;
    const scope = d.claims?.scope;
    if (aud || scope) return [aud && `aud: ${aud}`, scope && `scope: ${scope}`].filter(Boolean).join(' · ');
  }
  if (step.id === 'authorize') {
    const dec = d.decision?.outcome || d.outcome || d.decision;
    if (dec) return String(dec).toUpperCase();
  }
  if (step.id === 'exchange' && d.why) return d.why.slice(0, 60);
  return null;
}

// Build a terse claims list from step detail for the inspector
function buildClaims(step) {
  const d = step.detail || {};
  // Token exchange step: show token claims
  if (step.id === 'exchange' && d.claims) {
    return Object.entries(d.claims).slice(0, 10).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v),
      cls: k === 'scope' ? 'hi' : k === 'act' || k === 'may_act' ? 'ok' : k === 'aud' ? 'aud' : '',
    }));
  }
  // Authorize: show decision attributes
  if ((step.id === 'authorize' || step.id === 'authorize2') && d.decision) {
    const dec = d.decision;
    const rows = [];
    if (dec.outcome) rows.push({ k: 'decision', v: String(dec.outcome).toUpperCase(), cls: dec.outcome === 'PERMIT' || dec.outcome === 'done' ? 'ok' : 'warn' });
    if (dec.decisionId) rows.push({ k: 'decision_id', v: dec.decisionId });
    if (dec.engine) rows.push({ k: 'engine', v: dec.engine });
    if (dec.decisionContext) rows.push({ k: 'context', v: dec.decisionContext });
    if (dec.why) rows.push({ k: 'reason', v: dec.why.slice(0, 80) });
    return rows;
  }
  // Sign-in: show user token claims
  if (step.id === 'signin' && d.claims) {
    return Object.entries(d.claims).slice(0, 8).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), cls: '',
    }));
  }
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StepRow({ step, num, selected, onClick }) {
  const skip = step.status === 'notinpath';
  const halted = step.status === 'error' && step.detail?.isHalt;
  const ic = IC[step.status] || '·';
  const icCls = IC_CLS[step.status] || 'pending';
  const sub = stepSub(step);

  return (
    <div
      className={`tfd-step${selected ? ' selected' : ''}${halted ? ' halted' : ''}${skip ? ' notinpath' : ''}`}
      onClick={skip ? undefined : onClick}
    >
      <span className={`tfd-step-ic ${icCls}`}>{ic}</span>
      <span className="tfd-step-num">{num}.</span>
      <span className="tfd-step-title">
        {step.title}
        {sub && <span className="tfd-step-sub"> · {sub}</span>}
      </span>
      {skip
        ? <span className="tfd-notinpath-tag">Not in path</span>
        : <span className={badgeCls(step.lane)}>{step.lane}</span>
      }
      {!skip && <span className="tfd-arrow">▶</span>}
    </div>
  );
}

function DetailCard({ step, num, selected, onClick }) {
  const skip = step.status === 'notinpath';
  const ic = IC[step.status] || '·';
  const icCls = IC_CLS[step.status] || 'pending';
  const rfcs = step.detail?.rfcs || step.rfcs || [];
  const narrative = step.detail?.narrative || '';

  return (
    <div
      className={`tfd-card ${step.status}${selected ? ' selected' : ''}`}
      onClick={skip ? undefined : onClick}
    >
      <div className="tfd-card-head">
        <span className={`tfd-card-ic ${icCls}`}>{ic}</span>
        <div className="tfd-card-info">
          <div className="tfd-card-top">
            <span className="tfd-card-num">{num}.</span>
            <span className={`tfd-card-title${skip ? ' striked' : ''}`}>{step.title}</span>
            <span className={badgeCls(step.lane)}>{step.lane}</span>
          </div>
          {step.detail?.why && (
            <div className="tfd-card-sub">{step.detail.why.slice(0, 80)}</div>
          )}
          {rfcs.length > 0 && (
            <div className="tfd-card-tags">
              {rfcs.map(r => <span key={r} className="tfd-rfc-pill">{r}</span>)}
            </div>
          )}
        </div>
        {!skip && (
          <button className="tfd-card-inspect" onClick={onClick}>→ inspect</button>
        )}
      </div>
      {narrative && !skip && (
        <div className="tfd-card-narrative">{narrative}</div>
      )}
    </div>
  );
}

function Inspector({ step, onClose }) {
  const [tab, setTab] = useState('claims');

  useEffect(() => { setTab('claims'); }, [step?.id]);

  if (!step) {
    return (
      <div className="tfd-insp-empty">
        <div className="tfd-insp-empty-icon">🔑</div>
        <div>Click a step to inspect its token</div>
      </div>
    );
  }

  const claims = buildClaims(step);
  const rfcs = step.detail?.rfcs || step.rfcs || [];
  const spec = step.detail?.spec;
  const actClaim = step.id === 'exchange' && step.detail?.claims?.act;

  return (
    <>
      <div className="tfd-insp-header">
        <span className={inspBadgeCls(step.lane)}>{step.lane}</span>
        <span className="tfd-insp-title">{step.title}</span>
        <button className="tfd-insp-close" onClick={onClose} title="Close inspector">✕</button>
      </div>
      <div className="tfd-insp-tabs">
        {claims && <button className={`tfd-insp-tab${tab==='claims'?' active':''}`} onClick={() => setTab('claims')}>Claims</button>}
        <button className={`tfd-insp-tab${tab==='narrative'?' active':''}`} onClick={() => setTab('narrative')}>Why</button>
        {spec && <button className={`tfd-insp-tab${tab==='spec'?' active':''}`} onClick={() => setTab('spec')}>RFC</button>}
      </div>
      <div className="tfd-insp-body">
        {tab === 'claims' && claims && (
          <>
            <div className="tfd-insp-section">Token / Decision Claims</div>
            <div className="tfd-claims-table">
              {claims.map(({ k, v, cls }) => (
                <div key={k} className="tfd-ct-row">
                  <span className="tfd-ct-k">{k}</span>
                  <span className={`tfd-ct-v${cls ? ' '+cls : ''}`}>{v}</span>
                </div>
              ))}
            </div>
            {actClaim && (
              <div className="tfd-act-chip">
                ✅ act · delegation chain intact — RFC 8693 §4.1
              </div>
            )}
            {rfcs.length > 0 && (
              <div className="tfd-rfc-tags">
                {rfcs.map(r => <span key={r} className="tfd-rfc-pill">{r}</span>)}
              </div>
            )}
          </>
        )}

        {tab === 'narrative' && (
          <>
            <div className="tfd-insp-section">What happens on this hop</div>
            <div className="tfd-edu-box">
              <div className="tfd-edu-title">{step.title}</div>
              {step.detail?.narrative || 'No narrative available for this step.'}
            </div>
            {step.detail?.why && (
              <div className="tfd-edu-box" style={{ marginTop: 0 }}>
                <div className="tfd-edu-title">Why this run</div>
                {step.detail.why}
              </div>
            )}
          </>
        )}

        {tab === 'spec' && spec && (
          <>
            <div className="tfd-insp-section">Specification</div>
            {spec.refs?.length > 0 && (
              <div className="tfd-rfc-tags">
                {spec.refs.map(r => (
                  <a key={r.label} href={r.href} target="_blank" rel="noreferrer"
                    className="tfd-rfc-pill" style={{ textDecoration: 'none' }}
                    title={r.title}
                  >{r.label}</a>
                ))}
              </div>
            )}
            {spec.mandate && (
              <div className="tfd-edu-box">
                <div className="tfd-edu-title">Mandate</div>
                {spec.mandate}
              </div>
            )}
            {spec.why && (
              <div className="tfd-edu-box">
                <div className="tfd-edu-title">Why this demo</div>
                {spec.why}
              </div>
            )}
            {spec.failure && (
              <div className="tfd-edu-box" style={{ borderColor: 'rgba(248,81,73,.2)', background: 'rgba(248,81,73,.06)' }}>
                <div className="tfd-edu-title" style={{ color: '#fca5a5' }}>Common failure</div>
                {spec.failure}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function TokenFlowDetailModal({ isOpen, onClose }) {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [view, setView] = useState('simple');
  const [selectedStep, setSelectedStep] = useState(null);
  const [inspOpen, setInspOpen] = useState(false);
  const [footerOpen, setFooterOpen] = useState(null);

  useEffect(() => {
    return tokenChainTraceStore.subscribe(setStoreState);
  }, []);

  const { trace, steps } = storeState;
  const story = buildRunStory(trace, steps);

  const selectStep = useCallback((step) => {
    setSelectedStep(step);
    setInspOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspOpen(false);
    setSelectedStep(null);
  }, []);

  const doneCount = steps.filter(s => s.status === 'done').length;
  const errorCount = steps.filter(s => s.status === 'error').length;

  const bannerClass = story
    ? (story.outcome === 'error' ? 'error' : story.outcome === 'ok' ? 'ok' : 'pending')
    : 'pending';

  const bannerIcon = bannerClass === 'error' ? '✕' : bannerClass === 'ok' ? '✓' : '·';

  const routingMode = trace.routingMode || (trace.llmDetail ? 'llm' : trace.phases?.length ? 'heuristic' : null);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Flow Detail"
      defaultWidth={860}
      defaultHeight={680}
      storageKey="ba-flow-detail-modal"
      footer={null}
      noBackdrop
      zIndex={10000}
      minWidth={480}
      minHeight={360}
    >
      <div className="tfd-root">

        {/* View tabs */}
        <div className="tfd-tabs">
          <button
            className={`tfd-tab${view === 'simple' ? ' active' : ''}`}
            onClick={() => setView('simple')}
          >
            Pipeline
            <span className="tfd-badge">{steps.length}</span>
          </button>
          <button
            className={`tfd-tab${view === 'detailed' ? ' active' : ''}`}
            onClick={() => setView('detailed')}
          >
            Detailed
          </button>
        </div>

        {/* Body */}
        <div className="tfd-body">

          {/* Pipeline column */}
          <div className="tfd-pipeline">

            {/* Context bar */}
            <div className="tfd-ctx">
              <span className="tfd-ctx-label">Prompt</span>
              {trace.prompt?.message
                ? <span className="tfd-ctx-prompt">{String(trace.prompt.message).slice(0, 60)}{String(trace.prompt.message).length > 60 ? '…' : ''}</span>
                : <span className="tfd-ctx-prompt" style={{ color: 'var(--text-muted, #8b949e)' }}>waiting…</span>
              }
              {routingMode && (
                <span className="tfd-ctx-mode">{routingMode}</span>
              )}
            </div>

            {/* Banner */}
            {story && (
              <div className={`tfd-banner ${bannerClass}`}>
                <div className="tfd-banner-title">
                  {bannerIcon} {story.headline}
                </div>
                {story.bits?.length > 0 && (
                  <div className="tfd-banner-bits">
                    {story.bits.map((bit, i) => (
                      <div key={i} className="tfd-banner-bit">
                        <span>·</span>
                        <span>{bit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pipeline header */}
            <div className="tfd-pipeline-head">
              <span className="tfd-head-label">Token pipeline</span>
              <span className="tfd-head-count">
                {doneCount} done{errorCount > 0 ? ` · ${errorCount} failed` : ''} · {steps.length} steps
              </span>
            </div>

            {/* Steps */}
            <div className="tfd-steps">
              {view === 'simple'
                ? steps.map((step, i) => (
                    <StepRow
                      key={step.id + i}
                      step={step}
                      num={i + 1}
                      selected={selectedStep?.id === step.id && selectedStep?.status === step.status}
                      onClick={() => selectStep(step)}
                    />
                  ))
                : steps.map((step, i) => (
                    <DetailCard
                      key={step.id + i}
                      step={step}
                      num={i + 1}
                      selected={selectedStep?.id === step.id}
                      onClick={() => selectStep(step)}
                    />
                  ))
              }
            </div>

            {/* Footer */}
            <div className="tfd-footer">
              <div className="tfd-footer-row" onClick={() => setFooterOpen(footerOpen === 'tokens' ? null : 'tokens')}>
                Token Summary
                <span className="tfd-footer-badge">
                  {steps.filter(s => s.detail?.claims || s.detail?.decision).length} tokens
                </span>
              </div>
              {footerOpen === 'tokens' && (
                <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
                  {steps.filter(s => s.detail?.claims && Object.keys(s.detail.claims).length > 0).map(s => (
                    <div key={s.id} style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #c9d1d9)' }}>
                      <span style={{ color: 'var(--accent, #2f81f7)' }}>{s.lane}</span>
                      {' · '}
                      {s.detail.claims.scope
                        ? <span style={{ color: '#bc8cff' }}>scope: {typeof s.detail.claims.scope === 'object' ? JSON.stringify(s.detail.claims.scope) : s.detail.claims.scope}</span>
                        : null
                      }
                      {s.detail.claims.aud
                        ? <span style={{ color: '#39d353', marginLeft: 6 }}>aud: {s.detail.claims.aud}</span>
                        : null
                      }
                    </div>
                  ))}
                  {steps.filter(s => s.detail?.claims && Object.keys(s.detail.claims).length > 0).length === 0 && (
                    <span style={{ color: 'var(--text-muted, #8b949e)' }}>No token claims captured yet.</span>
                  )}
                </div>
              )}
              <div className="tfd-footer-row" onClick={() => setFooterOpen(footerOpen === 'mode' ? null : 'mode')}>
                Exchange Mode
                <span className="tfd-footer-badge">{routingMode || '—'}</span>
              </div>
              {footerOpen === 'mode' && trace.routingDetail && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary, #c9d1d9)' }}>
                  {trace.routingDetail}
                </div>
              )}
            </div>
          </div>

          {/* Inspector */}
          <div className={`tfd-inspector${inspOpen ? '' : ' closed'}`}>
            <Inspector step={selectedStep} onClose={closeInspector} />
          </div>

        </div>
      </div>
    </DraggableModal>
  );
}
