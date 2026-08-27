// demo_api_ui/src/pages/TransactionTracePage.jsx
import React, { useCallback, useEffect, useState } from "react";
import "./TransactionTracePage.css";
// One source for how the PingGateway filters are named and explained, shared
// with the Token Chain rail so the two surfaces cannot describe them differently.
import { GW_STAGE_META } from "../services/tokenChainTrace/buildTraceSteps";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";

const REFRESH_MS = 15000;
const LIST_LIMIT = 50;
const TOKEN_CHAIN_HREF = "/monitoring/token-chain";
const JAEGER_TRACE_HREF = "/jaeger/trace/";

// REGRESSION_PLAN §0 allowlist only.
const VERDICT_BADGE = {
  PASS: "✅ PASS",
  FAIL: "❌ FAIL",
  INCOMPLETE: "⚠️ INCOMPLETE",
};

const PHASE_ICON = {
  "token.exchange": "🔐",
};

const RECONCILIATION_LABEL = {
  MATCH: "corroborated",
  MISMATCH: "does not match second witness",
  SOURCE_UNAVAILABLE: "not corroborated — second witness unavailable",
};

const RECONCILIATION_CLASS = {
  MATCH: "match",
  MISMATCH: "mismatch",
  SOURCE_UNAVAILABLE: "unknown",
};

function fmtTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString() : "—";
}

function Identity({ identity }) {
  if (!identity) return null;
  const scopes = Array.isArray(identity.scopes) ? identity.scopes : [];
  const act = Array.isArray(identity.act) ? identity.act : [];
  return (
    <div className="ttrace-identity">
      {identity.sub ? <span>👤 {identity.sub}</span> : null}
      {act.length ? <span>act[{act.join(" → ")}]</span> : null}
      {scopes.length ? <span>🔑 {scopes.join(" ")}</span> : null}
      {identity.aud ? <span>aud={String(identity.aud)}</span> : null}
    </div>
  );
}

function Decision({ decision }) {
  if (!decision || decision.outcome === "n/a") return null;
  const denied = decision.outcome === "deny";
  // 'inferred' means the gateway could not read the PDP's stamped decision and
  // guessed the outcome from the HTTP status. Surface it so a guess never reads
  // as a confirmed policy verdict — the one thing an authorization trace exists
  // to rule out. Trail-sourced (authoritative) decisions, and any hop that
  // carries no provenance, render exactly as before.
  const inferred = decision.source === "inferred";
  return (
    <div className={`ttrace-decision ${denied ? "deny" : "permit"}`}>
      {denied ? "❌ DENY" : "✓ PERMIT"}
      {inferred ? (
        <span
          className="ttrace-inferred"
          data-testid="decision-inferred"
          title="Inferred from the HTTP status — the gateway could not read the policy decision, so this outcome is a guess, not a confirmed PDP verdict."
        >
          inferred
        </span>
      ) : null}
      {decision.reason ? <span className="ttrace-reason">{decision.reason}</span> : null}
    </div>
  );
}

// The PingGateway filters that handled this hop, in the order they ran.
// PingGateway's own MCP module does this work — McpValidationFilter (protocol
// + schema), McpAuditFilter, McpProtectionFilter (OAuth2) — and until now the
// trace showed only its VERDICT, so the product features that produced it were
// invisible in the surface built to demonstrate them.
//
// Renders nothing when the hop carries no chain: hops from other services never
// have one, and ping-gateway omits it when the audit trail was unreadable
// (transaction-hop.groovy fails open). Absent must not read as "no filters ran".
export function FilterChain({ chain, denyingFilter }) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  return (
    <div className="ttrace-filters" data-testid="filter-chain">
      {chain.map((f) => {
        // Only the filter that actually stopped the call is marked as the
        // blocker. A filter reporting 'blocked' downstream of the real one
        // would double-count the failure.
        const blocked = f.filter === denyingFilter;
        // Same labels and explanations the Token Chain rail uses. Sharing the
        // map rather than restating it is the point: two hand-written
        // descriptions of one filter chain drift, and the reel would otherwise
        // show raw Java class names for filters the rail explains in English.
        // Unknown filters fall back to the raw name, exactly as the rail does.
        const meta = GW_STAGE_META[f.filter] || {};
        const label = meta.label || f.filter;
        const detail = blocked
          ? `${label} stopped this request${f.decision ? ` (${f.decision})` : ""}`
          : `${label}: ${f.result}${f.decision ? ` (${f.decision})` : ""}`;
        return (
          <span
            key={f.filter}
            className={`ttrace-filter ${blocked ? "blocked" : ""}`}
            title={meta.note ? `${detail}\n\n${meta.note}` : detail}
          >
            {blocked ? "❌ " : ""}
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Hops are rendered as nodes on a continuous vertical spine. `severed` marks
// hops at/after the earliest violation — the spine (and the node) turns red
// from that point on, so a broken chain of custody is legible at a glance.
export function HopCard({ hop, violations, severed }) {
  return (
    <>
      <li
        className={`ttrace-hop${severed ? " ttrace-hop--severed" : ""}`}
        data-testid={`hop-${hop.seq}`}
      >
        <span className="ttrace-node">{hop.seq}</span>
        <div className="ttrace-hop-body">
          <div className="ttrace-hop-head">
            <strong>{hop.service}</strong>
            <span className="ttrace-phase">
              {PHASE_ICON[hop.phase] ? `${PHASE_ICON[hop.phase]} ` : ""}
              {hop.phase}
            </span>
            {hop.op ? <span className="ttrace-op">{hop.op}</span> : null}
            {Number.isFinite(hop.durationMs) ? <span className="ttrace-ms">{hop.durationMs}ms</span> : null}
            {hop.source === "derived" ? (
              <span
                className="ttrace-derived"
                title="Reconstructed at read time from the token chain — not a first-hand record"
              >
                derived
              </span>
            ) : null}
          </div>
          <Identity identity={hop.identity} />
          <Decision decision={hop.decision} />
          <FilterChain chain={hop.filterChain} denyingFilter={hop.denyingFilter} />
        </div>
      </li>
      {violations.map((v) => (
        <li key={v.id + v.detail} className="ttrace-violation" data-testid={`violation-${hop.seq}`}>
          ❌ {v.id} — {v.detail}
        </li>
      ))}
    </>
  );
}

function TraceDetail({ detail }) {
  const byHop = new Map();
  let severFromSeq = null;
  for (const v of detail.verdict?.violations || []) {
    const key = v.hopSeq ?? "unanchored";
    if (!byHop.has(key)) byHop.set(key, []);
    byHop.get(key).push(v);
    if (Number.isFinite(v.hopSeq) && (severFromSeq === null || v.hopSeq < severFromSeq)) {
      severFromSeq = v.hopSeq;
    }
  }
  const rStatus = detail.reconciliation?.status || "SOURCE_UNAVAILABLE";

  return (
    <div className="ttrace-detail">
      <div className="ttrace-detail-head">
        <span className={`ttrace-verdict ${(detail.verdict?.status || "").toLowerCase()}`}>
          {VERDICT_BADGE[detail.verdict?.status] || "⚠️ INCOMPLETE"}
        </span>
        <span
          className={`ttrace-recon ${RECONCILIATION_CLASS[rStatus] || "unknown"}`}
          data-testid="reconciliation-pill"
        >
          {RECONCILIATION_LABEL[rStatus] || RECONCILIATION_LABEL.SOURCE_UNAVAILABLE}
        </span>
        <span className="ttrace-links">
          {detail.traceId ? (
            <a href={`${JAEGER_TRACE_HREF}${detail.traceId}`} target="_blank" rel="noreferrer">Jaeger</a>
          ) : null}
          <a href={TOKEN_CHAIN_HREF}>Token Chain</a>
        </span>
      </div>

      {(byHop.get("unanchored") || []).map((v) => (
        <div key={v.id + v.detail} className="ttrace-violation ttrace-violation--unanchored">❌ {v.id} — {v.detail}</div>
      ))}

      <ul className="ttrace-hops">
        {(detail.hops || []).map((hop) => (
          <HopCard
            key={hop.seq}
            hop={hop}
            violations={byHop.get(hop.seq) || []}
            severed={severFromSeq !== null && hop.seq >= severFromSeq}
          />
        ))}
      </ul>
    </div>
  );
}

export default function TransactionTracePage() {
  const [transactions, setTransactions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/transaction-trace?limit=${LIST_LIMIT}`, { credentials: "include" });
      if (res.status === 403) {
        setDisabled(true);
        setLoaded(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setDisabled(false);
      setError(null);
      setTransactions(body.transactions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadList]);

  const loadDetail = useCallback(async (correlationId) => {
    setDetailError(null);
    try {
      const res = await fetch(`/api/transaction-trace/${encodeURIComponent(correlationId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (err) {
      setDetailError({ correlationId, message: err.message });
    }
  }, []);

  const toggle = useCallback((correlationId) => {
    if (expanded === correlationId) {
      setExpanded(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpanded(correlationId);
    setDetail(null);
    loadDetail(correlationId);
  }, [expanded, loadDetail]);

  return (
    <div className="ttrace-page">
      <header className="ttrace-header">
        <h1>Transaction Trace</h1>
        <p className="ttrace-sub">
          One agent turn, hop by hop — who acted, under whose delegation, with what authorization.
        </p>
      </header>

      {disabled ? (
        <div className="ttrace-notice">
          ⚠️ Transaction Chain of Custody is off. Enable <code>ff_transaction_ledger</code> on the
          Feature Flags page to start recording.
        </div>
      ) : null}

      {error && !disabled ? <div className="ttrace-notice">⚠️ {error}</div> : null}

      {loaded && !disabled && transactions.length === 0 ? (
        <div className="ttrace-notice">
          No transactions recorded yet. Run one agent turn, then refresh.
        </div>
      ) : null}

      <ul className="ttrace-list">
        {transactions.map((t) => (
          <li key={t.correlationId}>
            <button
              type="button"
              className="ttrace-row"
              onClick={() => toggle(t.correlationId)}
              aria-expanded={expanded === t.correlationId}
            >
              <span className="ttrace-time">{fmtTime(t.startedAt)}</span>
              <span className="ttrace-cid">{t.correlationId}</span>
              <span className="ttrace-count">{t.hopCount} hops</span>
            </button>
            {expanded === t.correlationId ? (
              detail ? (
                <TraceDetail detail={detail} />
              ) : detailError && detailError.correlationId === t.correlationId ? (
                <div className="ttrace-detail-error" data-testid="detail-error">
                  <p>⚠️ Trace could not be loaded.</p>
                  <button
                    type="button"
                    className="ttrace-retry-btn"
                    onClick={() => loadDetail(t.correlationId)}
                  >
                    Retry
                  </button>
                </div>
              ) : null
            ) : null}
          </li>
        ))}
      </ul>

      {/* Movie reel - the same TokenChainFilmstrip the dashboard mounts, over
          the same global store. This page explains one recorded turn hop by hop
          but had no live chain of its own. .tcfs is display:contents, so it
          needs the .tcfs-float-host grid wrapper, exactly as the dashboard's
          float and dock layouts do. */}
      <div className="tcfs-float-host">
        <TokenChainFilmstrip />
      </div>
    </div>
  );
}
