/**
 * AttackAnatomyExplainer — Plan A · Phase A7.1
 *
 * Renders a 4-row panel that explains the anatomy of an attack use case
 * after a sim run. Props-only — no fetches, no context.
 *
 * Props:
 *   ucEntry   {object|null}  — catalog entry for the use case that was run
 *   simResult {object|null}  — POST /api/demo/attack-sim/run response
 *
 * Returns null when either prop is absent (no result yet, or non-attack UC).
 *
 * Row layout:
 *   1. Attacker goal      — ucEntry.buyerStory
 *   2. What was injected  — simResult.errorCode + simResult.reason
 *   3. Without PingOne    — ucEntry.buyerStory (v1: same text, frames the threat)
 *   4. What PingOne did   — ucEntry.pingOneSolution
 *
 * Footer: HTTP status badge, errorCode badge, OWASP chip (SVG-label, no emoji).
 *
 * CSS lives in UseCaseLauncherPage.css (attack-anatomy-explainer block).
 */
import React from 'react';

/* ── OWASP chip — SVG shield + text label, no emoji ─────────────────────── */

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="13"
      viewBox="0 0 11 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }}
    >
      <path
        d="M5.5 0L0 2.167v4.5C0 9.5 2.917 12.25 5.5 13c2.583-.75 5.5-3.5 5.5-6.333v-4.5L5.5 0z"
        fill="currentColor"
      />
    </svg>
  );
}

function OwaspChip({ owasp }) {
  if (!owasp || !owasp.threats?.length) return null;
  const label = `OWASP ASI ${owasp.threats.join(', ')}`;
  return (
    <span className="aae-owasp-chip" title={owasp.sections?.join(', ')}>
      <ShieldIcon />
      {label}
    </span>
  );
}

/* ── Row — single anatomy row ────────────────────────────────────────────── */

function AnatomyRow({ label, children }) {
  return (
    <div className="aae-row">
      <div className="aae-row__label">{label}</div>
      <div className="aae-row__body">{children}</div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

export default function AttackAnatomyExplainer({ ucEntry, simResult }) {
  if (!simResult || !ucEntry) return null;

  const { status, errorCode, reason } = simResult;

  return (
    <section className="attack-anatomy-explainer">
      <div className="aae-header">
        <h2 className="aae-title">Attack anatomy: {ucEntry.title}</h2>
        {ucEntry.whatToSay && (
          <p className="aae-caption">{ucEntry.whatToSay}</p>
        )}
      </div>

      <div className="aae-rows">
        {/* Row 1 — Attacker goal */}
        <AnatomyRow label="Attacker goal">
          {ucEntry.buyerStory}
        </AnatomyRow>

        {/* Row 2 — What was injected */}
        <AnatomyRow label="What was injected">
          {errorCode && (
            <span className="aae-code-badge">{errorCode}</span>
          )}
          {reason && (
            <span className="aae-row__detail">{reason}</span>
          )}
        </AnatomyRow>

        {/* Row 3 — Without PingOne */}
        <AnatomyRow label="Without PingOne">
          {ucEntry.buyerStory}
        </AnatomyRow>

        {/* Row 4 — What PingOne did */}
        <AnatomyRow label="What PingOne did">
          {ucEntry.pingOneSolution}
        </AnatomyRow>
      </div>

      <div className="aae-footer">
        {status != null && (
          <span className={`aae-status-badge ${status >= 400 ? 'aae-status-badge--deny' : 'aae-status-badge--permit'}`}>{status}</span>
        )}
        {errorCode && (
          <span className="aae-code-badge">{errorCode}</span>
        )}
        <OwaspChip owasp={ucEntry.owasp} />
      </div>
    </section>
  );
}
