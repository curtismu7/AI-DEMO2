import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * DelegationSection — RFC 8693 delegation chains and A2A specialist handoff.
 *
 * Live sources, all readable without a session:
 *   GET /api/logs/exchange — the in-memory exchange audit ring buffer, written
 *   by agentMcpTokenService on every exchange (success and failure). Carries
 *   hashed/derived fields only (scopes, audience, act flag), no tokens.
 *   /a2a/specialists/registry — public specialist directory (fetched with
 *   credentials omitted).
 *
 * Session-scoped exchange log (GET /api/token-exchanges) requires a session and
 * only ever shows the current session's exchanges; guests see a sign-in note
 * for that one block.
 */

export default function DelegationSection() {
  const [events, setEvents] = useState(null);
  const [eventsError, setEventsError] = useState(false);

  const [specialists, setSpecialists] = useState([]);
  const [specialistsError, setSpecialistsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/logs/exchange?limit=25")
      .then(({ data }) => { if (!cancelled) setEvents(data.logs || []); })
      .catch(() => { if (!cancelled) setEventsError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/a2a/specialists/registry", { credentials: "omit", headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((payload) => {
        if (cancelled) return;
        const entries = Array.isArray(payload?.specialists) ? payload.specialists : [];
        setSpecialists(entries.filter((e) => e && e.vertical && e.specialistName));
      })
      .catch(() => { if (!cancelled) setSpecialistsError(true); });
    return () => { cancelled = true; };
  }, []);

  const exchanges = (events || []).filter((e) => (e.args?.[0]?.type || e._src) && e._src === "exchange");
  const success = exchanges.filter((e) => e.args?.[0]?.type === "exchange-success");
  const failed = exchanges.filter((e) => e.args?.[0]?.type === "exchange-failed");

  return (
    <div>
      <p className="aac-section-intro">
        Every agent hop is a chain of RFC 8693 exchanges: the user token is the
        subject of Exchange #1 (one-hop act claim), then an A2A generalist may
        exchange again as a vertical specialist (nested act, Exchange #2). This
        tab reads the live audit ring buffer — no tokens, only derived facts.
      </p>

      <div className="aac-stat-grid">
        <div className="aac-stat-tile">
          <div className="aac-stat-value">{eventsError ? "—" : exchanges.length}</div>
          <div className="aac-stat-label">Exchange events (buffer)</div>
          <div className="aac-stat-detail">source: /api/logs/exchange — always public</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value" style={{ color: "var(--th-status-success, #3fb27f)" }}>{eventsError ? "—" : success.length}</div>
          <div className="aac-stat-label">Successful exchanges</div>
          <div className="aac-stat-detail">act claim presence per row below</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value" style={{ color: "var(--th-status-error-text, #d95c5c)" }}>{eventsError ? "—" : failed.length}</div>
          <div className="aac-stat-label">Failed exchanges</div>
          <div className="aac-stat-detail">denials, audience mismatches, scope errors</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">{specialistsError ? "—" : specialists.length}</div>
          <div className="aac-stat-label">A2A specialists</div>
          <div className="aac-stat-detail">public registry — no session needed</div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>
          Live exchange audit{" "}
          {!eventsError && <span className="aac-badge aac-badge--live">Live</span>}
          {eventsError && <span className="aac-badge aac-badge--broken">Unavailable</span>}
        </h3>
        {eventsError ? (
          <div className="aac-card"><div className="aac-card-body">Exchange audit log unavailable right now.</div></div>
        ) : exchanges.length === 0 ? (
          <div className="aac-card"><div className="aac-card-body">
            No exchanges recorded yet. Trigger an agent run (or any MCP tool call)
            and each RFC 8693 hop lands here within seconds.
          </div></div>
        ) : (
          <div className="aac-table-wrap">
            <table className="aac-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Hop</th>
                  <th scope="col">Detail</th>
                  <th scope="col">act claim</th>
                </tr>
              </thead>
              <tbody>
                {exchanges.slice(0, 15).map((e, i) => {
                  const ev = e.args?.[0] || {};
                  return (
                    <tr key={e.id || i}>
                      <td className="aac-mono">{(ev.timestamp || e.timestamp || "").slice(11, 19) || "—"}</td>
                      <td className="aac-mono">{ev.type || "—"}</td>
                      <td>{ev.message || "—"}</td>
                      <td><ChainPill act={ev.actPresent} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aac-section-block">
        <h3>
          A2A specialist directory{" "}
          {!specialistsError && specialists.length > 0 && <span className="aac-badge aac-badge--live">Live</span>}
        </h3>
        <p className="aac-card-sub" style={{ marginBottom: 10 }}>
          The generalist delegates a sensitive subtask to the vertical specialist
          via a second exchange — the nested-act two-hop chain. Source: the public
          A2A registry at <code>/a2a/specialists/registry</code>.
        </p>
        {specialistsError ? (
          <div className="aac-card"><div className="aac-card-body">A2A specialist registry unavailable right now.</div></div>
        ) : specialists.length === 0 ? (
          <div className="aac-card"><div className="aac-card-body">No specialists registered.</div></div>
        ) : (
          <div className="aac-table-wrap">
            <table className="aac-table">
              <thead>
                <tr>
                  <th scope="col">Vertical</th>
                  <th scope="col">Specialist</th>
                  <th scope="col">Tools</th>
                </tr>
              </thead>
              <tbody>
                {specialists.map((s, i) => (
                  <tr key={`${s.vertical}-${s.specialistName}-${i}`}>
                    <td>{s.vertical}</td>
                    <td className="aac-mono">{s.specialistName}</td>
                    <td className="aac-mono">{(s.tools || []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aac-section-block">
        <h3>Your session's exchange log <span className="aac-badge aac-badge--user">sign-in</span></h3>
        <p className="aac-card-sub">
          The per-session exchange log (GET /api/token-exchanges) is session-scoped
          and hashes tokens before storage — it stays behind sign-in. Sign in and
          reload to see your own hops with token hashes.
        </p>
      </div>
    </div>
  );
}

function ChainPill({ act }) {
  return act ? (
    <span className="aac-pill aac-pill--permit">act ✓</span>
  ) : (
    <span className="aac-pill aac-pill--indeterminate">no act</span>
  );
}
