/**
 * ArchitectureDiagramPage.js
 *
 * Shared display component for architecture diagram pages.
 * Renders a PNG image with an absolutely-positioned SVG overlay.
 *
 * Token card design: light background with colored left border so text is readable.
 * Supports dual tokens (token + token2 stacked), RFC badges, URN abbreviation,
 * and stacked Request/Issued layout for RFC 8693 exchange steps.
 *
 * Props:
 *   title, imageSrc, imageAlt, regions, activeRegions, regionLabels
 *   onSimulate, isSimulating
 *   isPaused, onPause, onResume, onPrevStep, onNextStep, onStop
 *   currentStep {number}  (-1 = idle)
 *   totalSteps  {number}
 *   stepDetail  {object}  token for primary card
 *   stepDetail2 {object}  token for secondary card (dual display)
 *   stepDetailOut {object} issued token for RFC 8693 exchange step
 *   isTokenExchange {boolean}
 *   isHitl      {boolean}
 *   audHops     {Array}
 */
import React, { useState } from 'react';
import AdminSubPageShell from './AdminSubPageShell';
import HistoryModal from './HistoryModal';
import { DiagramControls } from './diagram';
import './ArchitectureDiagramPage.css';

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 4.0;

// Abbreviate long OAuth URNs to something readable
const URN_SHORT = {
  'urn:ietf:params:oauth:grant-type:token-exchange': 'token-exchange',
  'urn:ietf:params:oauth:token-type:access_token':   'access_token',
  'urn:ietf:params:oauth:token-type:id_token':        'id_token',
  'urn:ietf:params:oauth:token-type:refresh_token':   'refresh_token',
};
function fmtVal(v) {
  return URN_SHORT[v] !== undefined ? URN_SHORT[v] : v;
}

// Card accent color by _type
const ACCENT = {
  oauth:    '#2563eb',
  exchange: '#7c3aed',
  permit:   '#16a34a',
  hitl:     '#d97706',
  idtoken:  '#0891b2',
  mcp:      '#475569',
  error:    '#dc2626',
};

function wrapText(text, maxChars) {
  if (!text || text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.slice(0, 3);
}

function HighlightRect({ region, colorVariant, label }) {
  const { xPct, yPct, wPct, hPct } = region.bounds;
  const className = colorVariant
    ? `diagram-region diagram-region--${colorVariant}`
    : 'diagram-region';
  const fontSize  = Math.min(2.2, Math.max(1.0, hPct * 0.18));
  const cx        = xPct + wPct / 2;
  const labelLines = label ? wrapText(label, Math.floor(wPct / fontSize * 1.8)) : [];
  const textY      = yPct + hPct / 2 - (labelLines.length - 1) * fontSize * 0.6;
  return (
    <g>
      <rect x={xPct} y={yPct} width={wPct} height={hPct} rx={0.8}
        className={className} aria-label={region.label}>
        <title>{region.label}</title>
      </rect>
      {colorVariant && labelLines.length > 0 && (
        <text x={cx} y={textY} textAnchor="middle" dominantBaseline="middle"
          fontSize={fontSize}
          className={`diagram-region-text diagram-region-text--${colorVariant}`}
          style={{ pointerEvents: 'none' }}>
          {labelLines.map((line, i) => (
            <tspan key={i} x={cx} dy={i === 0 ? 0 : `${fontSize * 1.25}`}>{line}</tspan>
          ))}
        </text>
      )}
    </g>
  );
}

function StepArrowHighlight({ arrow }) {
  if (!arrow) return null;
  const { yPct, xMinPct, xMaxPct, colorClass } = arrow;
  const h = 1.5;
  const y = yPct - h / 2;
  const w = xMaxPct - xMinPct;
  const cls = colorClass
    ? `diagram-step-arrow diagram-step-arrow--${colorClass}`
    : 'diagram-step-arrow diagram-step-arrow--active';
  return <rect x={xMinPct} y={y} width={w} height={h} rx={0.4} className={cls} />;
}

// ─── Aud Trail ────────────────────────────────────────────────────────────────

function AudTrail({ audHops, currentStep }) {
  if (!audHops || audHops.length === 0) return null;
  return (
    <div className="arch-aud-trail">
      <span className="arch-aud-trail__label">aud trail:</span>
      {audHops.map((hop, i) => {
        const on   = currentStep >= hop.activeFrom && currentStep <= hop.activeTo;
        const past = currentStep > hop.activeTo;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className={`arch-aud-trail__arrow${past ? ' arch-aud-trail__arrow--past' : ''}`}>→</span>}
            <div className={`arch-aud-trail__hop${on ? ' arch-aud-trail__hop--on' : past ? ' arch-aud-trail__hop--past' : ''}`}>
              <span className="arch-aud-trail__icon">{hop.icon}</span>
              <span className="arch-aud-trail__name">{hop.label}</span>
              <span className="arch-aud-trail__aud">{hop.isExchange ? hop.aud : `aud: ${hop.aud}`}</span>
              {hop.act     && <span className="arch-aud-trail__act">act: {hop.act}</span>}
              {hop.may_act && <span className="arch-aud-trail__mayact">may_act: {hop.may_act}</span>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Token Card (light-background, readable) ──────────────────────────────────

function ClaimRow({ k, v }) {
  const isAud    = k === 'aud' || k === 'audience' || k === 'TokenAudience' || k === 'requested_aud';
  const isAct    = k === 'act' || k === 'may_act' || k === 'ActClientId';
  const isDecide = k === 'decision' || k === 'DecisionContext';
  const isMeta   = k === 'note' || k === '_type';
  if (isMeta) return null;
  return (
    <div className="arch-claim-row">
      <span className="arch-claim-key">{k}</span>
      <span className={`arch-claim-val${isAud ? ' arch-claim-val--aud' : isAct ? ' arch-claim-val--act' : isDecide ? ' arch-claim-val--decide' : ''}`}>
        {fmtVal(String(v))}
      </span>
    </div>
  );
}

function OneCard({ token, isExchange, isHitl, label }) {
  if (!token) return null;

  const accentType = token._type || (isHitl ? 'hitl' : isExchange ? 'exchange' : 'oauth');
  const accent = ACCENT[accentType] || ACCENT.oauth;
  const title  = token.type  || token._title || 'Token';
  const rfcs   = token._rfcs || [];
  const note   = token.note;

  // For exchange steps: split into request entries + issued entries via stepDetailOut
  const claimEntries = Object.entries(token).filter(([k]) =>
    k !== 'type' && k !== '_type' && k !== '_title' && k !== '_rfcs' && k !== 'note'
  );

  return (
    <div className="arch-token-card" style={{ borderLeftColor: accent }}>
      <div className="arch-token-card__head">
        <span className="arch-token-card__title">{title}</span>
        {rfcs.map((r) => (
          <span key={r} className="arch-token-card__rfc">{r}</span>
        ))}
      </div>
      {label && <div className="arch-token-card__section-label">{label}</div>}
      {claimEntries.map(([k, v]) => <ClaimRow key={k} k={k} v={v} />)}
      {note && <div className="arch-token-card__note">ℹ {note}</div>}
    </div>
  );
}

function TokenCard({ stepDetail, stepDetail2, stepDetailOut, isTokenExchange, isHitl }) {
  if (!stepDetail && !stepDetail2) return null;
  return (
    <div className="arch-token-panel">
      {/* RFC 8693 exchange: two separate cards — subject token + issued token */}
      {isTokenExchange && stepDetailOut ? (
        <>
          <OneCard token={stepDetail} />
          <OneCard token={stepDetailOut} />
        </>
      ) : (
        <OneCard token={stepDetail} isHitl={isHitl} />
      )}
      {stepDetail2 && <OneCard token={stepDetail2} />}
    </div>
  );
}

// ─── History panel ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
// eslint-disable-next-line no-unused-vars
function HistoryPanel({ history, onClear }) {
  const [open, setOpen] = useState(true);
  if (!history || history.length === 0) return null;
  return (
    <div className="arch-history">
      <div className="arch-history__header">
        <button className="arch-history__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="arch-history__title">
          📋 Token History — {history.length} token{history.length !== 1 ? 's' : ''} captured
        </span>
        <button className="arch-history__clear" onClick={onClear} title="Clear history">
          ✕ Clear
        </button>
      </div>
      {open && (
        <div className="arch-history__scroll">
          {history.map((entry, idx) => (
            <div key={idx} className="arch-history__entry">
              <div className="arch-history__entry-label">
                <span className="arch-history__step-chip">Step {entry.stepNum}</span>
                {entry.label}
              </div>
              {entry.isTokenExchange && entry.token ? (
                <div className="arch-token-card arch-history__card" style={{ borderLeftColor: ACCENT.exchange }}>
                  <div className="arch-token-card__head">
                    <span className="arch-token-card__title">{entry.token.type || 'Token Exchange'}</span>
                    {(entry.token._rfcs || ['RFC 8693']).map((r) => (
                      <span key={r} className="arch-token-card__rfc">{r}</span>
                    ))}
                  </div>
                  <div className="arch-token-card__section-label">Request →</div>
                  {Object.entries(entry.token).filter(([k]) =>
                    k !== 'type' && k !== '_type' && k !== '_title' && k !== '_rfcs' && k !== 'note'
                  ).map(([k, v]) => <ClaimRow key={k} k={k} v={v} />)}
                  {entry.tokenOut && (
                    <>
                      <div className="arch-token-card__section-label arch-token-card__section-label--issued">↓ Issued</div>
                      {Object.entries(entry.tokenOut).filter(([k]) =>
                        k !== 'type' && k !== '_type' && k !== '_rfcs' && k !== 'note'
                      ).map(([k, v]) => <ClaimRow key={k} k={k} v={v} />)}
                      {entry.tokenOut.note && <div className="arch-token-card__note">ℹ {entry.tokenOut.note}</div>}
                    </>
                  )}
                  {entry.token.note && <div className="arch-token-card__note">ℹ {entry.token.note}</div>}
                </div>
              ) : (
                <>
                  {entry.token  && <OneCard token={entry.token}  isHitl={entry.isHitl} />}
                  {entry.token2 && <OneCard token={entry.token2} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function ArchitectureDiagramPage({
  title,
  imageSrc,
  imageAlt,
  regions = [],
  activeRegions = {},
  regionLabels  = {},
  onSimulate,
  isSimulating,
  isPaused,
  onPause,
  onResume,
  onPrevStep,
  onNextStep,
  onStop,
  currentStep,
  totalSteps,
  stepDetail,
  stepDetail2,
  stepDetailOut,
  isTokenExchange,
  isHitl,
  stepArrow,
  audHops,
  tokenHistory,
  onClearHistory,
  toolbarExtra,
}) {
  const [zoom, setZoom] = useState(1.0);
  const zoomIn    = () => setZoom((z) => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(2))));
  const zoomOut   = () => setZoom((z) => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(2))));
  const zoomReset = () => setZoom(1.0);

  const stepNum   = currentStep != null && currentStep >= 0 ? currentStep + 1 : null;
  const hasCard   = isSimulating && (Boolean(stepDetail) || Boolean(stepDetail2));

  return (
    <AdminSubPageShell title={title}>
      <div className="arch-diagram-page">

        {/* Toolbar */}
        <div className="arch-diagram-toolbar">
          <DiagramControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onZoomReset={zoomReset}
            currentStep={onSimulate ? (stepNum ?? 0) : undefined}
            totalSteps={totalSteps}
            isSimulating={isSimulating}
            isPaused={isPaused}
            onSimulate={onSimulate}
            onPrev={onPrevStep}
            onPause={onPause}
            onResume={onResume}
            onNext={onNextStep}
            onStop={onStop}
            extra={toolbarExtra}
          />
        </div>

        {/* Aud trail */}
        {isSimulating && audHops && (
          <AudTrail audHops={audHops} currentStep={currentStep} />
        )}

        {/* Body: diagram + token side panel */}
        <div className={`arch-diagram-body${hasCard ? ' arch-diagram-body--with-card' : ''}`}>
          <div className="arch-diagram-scroll-wrapper">
            <div className="arch-diagram-container" style={{ width: `${zoom * 100}%` }}>
              <img src={imageSrc} alt={imageAlt || title} className="arch-diagram-img" />
              <svg className="arch-diagram-svg" viewBox="0 0 100 100"
                preserveAspectRatio="none" aria-hidden="true">
                {regions.map((region) => (
                  <HighlightRect
                    key={region.id}
                    region={region}
                    colorVariant={activeRegions[region.id] || null}
                    label={regionLabels[region.id] || null}
                  />
                ))}
                <StepArrowHighlight arrow={stepArrow} />
              </svg>
            </div>
          </div>

          {hasCard && (
            <div className="arch-token-side">
              <TokenCard
                stepDetail={stepDetail}
                stepDetail2={stepDetail2}
                stepDetailOut={stepDetailOut}
                isTokenExchange={isTokenExchange}
                isHitl={isHitl}
              />
            </div>
          )}
        </div>

        {/* Token history — floating draggable modal */}
        <HistoryModal history={tokenHistory} onClear={onClearHistory} />

      </div>
    </AdminSubPageShell>
  );
}
