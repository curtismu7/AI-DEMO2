import React, { useCallback, useEffect, useState } from "react";
import GroupMembershipToggle from "../components/GroupMembershipToggle";
import "./GroupPolicyBoardPage.css";

/**
 * GroupPolicyBoardPage — one live PingOne Authorize decision per vertical, for
 * that vertical's group-gated tool, against the signed-in user's real directory
 * membership.
 *
 * The point of the page is the transition, not the table: flip the toggle and
 * every row moves together. No single use-case chip can show that, because a chip
 * is one vertical and one decision.
 *
 * Every row is a real decision from the endpoint the PEP calls. Nothing here is
 * derived from the manifest — if it were, the board would agree with itself
 * regardless of what the policy actually does, which is the exact failure this
 * demo exists to disprove.
 */
export default function GroupPolicyBoardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/groups/decision-board", { credentials: "include" });
      if (!res.ok) throw new Error(`decision board failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const permits = rows.filter((r) => r.decision === "PERMIT").length;
  const denies = rows.filter((r) => r.decision === "DENY").length;
  const unknown = rows.filter((r) => r.decision === "UNKNOWN").length;

  return (
    <div className="gpb-page">
      <header className="gpb-head">
        <p className="gpb-eyebrow">LIVE AUTHORIZATION EXPLAINER</p>
        <h1>Group policy — live decisions</h1>
        <p className="gpb-sub">
          This page makes one boundary visible: scopes are not entitlements. PingOne
          directory membership is re-read for each group-gated tool call, then the
          resulting decision is shown for every demo vertical below.
        </p>
      </header>

      <section className="gpb-control">
        {/* Re-uses the same component as the UC9 card, so there is one code path
            for the membership write rather than two that can disagree. */}
        <GroupMembershipToggle onChange={load} />
      </section>

      <section className="gpb-board" aria-live="polite">
        <div className="gpb-board-head">
          <h2>Decisions</h2>
          <div className="gpb-tally">
            <span className="gpb-pill gpb-pill--permit">{permits} permit</span>
            <span className="gpb-pill gpb-pill--deny">{denies} deny</span>
            {unknown > 0 ? <span className="gpb-pill gpb-pill--unknown">{unknown} unknown</span> : null}
            <button type="button" className="gpb-refresh" onClick={load} disabled={loading}>
              {loading ? "Checking…" : "Re-check"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="gpb-error">
            <span>⚠️</span>
            <div>
              <div className="gpb-error-title">Could not read decisions</div>
              <div className="gpb-error-detail">{error}</div>
            </div>
          </div>
        ) : null}

        {loading && rows.length === 0 ? (
          <p className="gpb-loading" role="status"><span className="gpb-spinner" aria-hidden="true" /> Asking PingOne Authorize…</p>
        ) : null}

        {rows.length > 0 ? (
          <div className="gpb-table-wrap">
            <table className="gpb-table">
              <thead>
                <tr>
                  <th scope="col">Vertical</th>
                  <th scope="col">Group-gated tool</th>
                  <th scope="col">Required group</th>
                  <th scope="col">In group</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Statement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.verticalId}:${r.tool}`}>
                    <th scope="row">{r.displayName}</th>
                    <td className="gpb-tool">{r.tool}</td>
                    <td className="gpb-tool">{r.requiredGroup || "—"}</td>
                    <td>{r.inRequiredGroup ? "✓" : "✕"}</td>
                    <td>
                      <span className={`gpb-decision gpb-decision--${String(r.decision).toLowerCase()}`}>
                        {r.decision}
                      </span>
                    </td>
                    {/* The statement code is what proves WHICH rule answered.
                        A bare PERMIT/DENY could come from anywhere. */}
                    <td className="gpb-codes">{r.codes?.length ? r.codes.join(" + ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data && !data.liveLookupReady ? (
          <p className="gpb-note gpb-note--warn">
            ⚠️ PingOne worker credentials are not configured, so membership is read
            from the manifest rather than the directory. The decisions are real, but
            the membership they are based on is declared intent, not directory truth.
          </p>
        ) : null}

        {data?.rows?.some((r) => r.source === "manifest") && data?.liveLookupReady ? (
          <p className="gpb-note gpb-note--warn">
            ⚠️ At least one row fell back to manifest membership — the live lookup
            failed for it. Treat those rows as unverified.
          </p>
        ) : null}
      </section>
    </div>
  );
}
