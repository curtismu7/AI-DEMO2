import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import GroupMembershipToggle from "../components/GroupMembershipToggle";
import PingIdentitySpinner from "../components/shared/PingIdentitySpinner";
import { useThemeOptional } from "../context/ThemeContext";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import { GROUP_POLICY_DIAGRAM } from "../config/groupPolicyBoardDiagram";
import "./GroupPolicyBoardPage.css";
import PageHeader from '../components/common/PageHeader';

const GROUP_POLICY_FLAG = "ff_authorize_group_policy";

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
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The flag is this demo step's own doing: the group decides nothing while
  // ff_authorize_group_policy is off, so arriving here (step 9A) turns it ON,
  // and leaving turns it back OFF — the demo never leaves the authorization
  // surface changed behind it. A ref captures whether WE turned it on, so a
  // presenter who had it on before the page never sees it switched off.
  const armedFlagRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    apiClient.get("/api/admin/feature-flags", { _silent: true })
      .then(({ data: flagData }) => {
        if (cancelled) return;
        const current = flagData?.flags?.find((f) => f.id === GROUP_POLICY_FLAG)?.value;
        if (current === true) return; // already on — not ours to restore
        armedFlagRef.current = true;
        return apiClient.patch(
          "/api/admin/feature-flags",
          { updates: { [GROUP_POLICY_FLAG]: true } },
          { _noAuthBanner: true },
        ).catch(() => { armedFlagRef.current = false; });
      })
      .catch(() => { /* read failed — the page still works and says the flag state */ });
    return () => {
      cancelled = true;
      if (armedFlagRef.current) {
        armedFlagRef.current = false;
        apiClient.patch(
          "/api/admin/feature-flags",
          { updates: { [GROUP_POLICY_FLAG]: false } },
          { _noAuthBanner: true },
        ).catch(() => { /* best effort — Demo Config is the manual backstop */ });
      }
    };
  }, []);
  // Single group-check panel: the board can only ever ask about the signed-in
  // user; this answers "is demoDelegate in Banking_PremiumTier?" live, without
  // signing in as anyone else.
  const [checkUser, setCheckUser] = useState('demoDelegate');
  const [checkVertical, setCheckVertical] = useState('banking');
  const [verticals, setVerticals] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleNote, setToggleNote] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One vertical per load — the picker below scopes the board. Firing all
      // ~13 gated verticals on every page view was ~13 live Authorize calls
      // plus a membership read each, for a single page load.
      const params = new URLSearchParams({ verticalId: checkVertical });
      const res = await fetch(`/api/groups/decision-board?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`decision board failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [checkVertical]);

  useEffect(() => { load(); }, [load]);

  // The picker's options: the demo's vertical list (ids + display names), the
  // same source the VerticalSwitcher uses. Fetched once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/verticals/list", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((list) => { if (!cancelled) setVerticals(Array.isArray(list) ? list : null); })
      .catch(() => { /* the page falls back to the board's own row label */ });
    return () => { cancelled = true; };
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const params = new URLSearchParams({ username: checkUser, verticalId: checkVertical });
      const res = await fetch(`/api/groups/check?${params}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || `check failed (${res.status})`);
      setCheckResult(body);
      return body;
    } catch (err) {
      setCheckResult(null);
      setCheckError(err.message);
      return null;
    } finally {
      setChecking(false);
    }
  }, [checkUser, checkVertical]);

  /**
   * The demo IS the transition: write the picked user's membership live in
   * PingOne, then re-run the check so the decision visibly flips. The server
   * returns the post-write re-read — if PingOne accepted the call but did not
   * apply it, the note says so instead of showing a confident wrong state.
   */
  const toggleMembership = useCallback(async (inGroup) => {
    setToggling(true);
    setCheckError(null);
    setToggleNote(null);
    try {
      const res = await fetch("/api/groups/check/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inGroup, username: checkUser, verticalId: checkVertical }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || `toggle failed (${res.status})`);
      setToggleNote(
        body.verified && body.inGroup !== inGroup
          ? "PingOne accepted the change but the re-read does not match what was requested — membership may not have applied."
          : `${body.username} is ${body.inGroup ? "now in" : "no longer in"} ${body.groupName}.`,
      );
      await runCheck();
      load();
    } catch (err) {
      setCheckError(err.message);
    } finally {
      setToggling(false);
    }
  }, [checkUser, checkVertical, runCheck, load]);

  const rows = data?.rows || [];
  const permits = rows.filter((r) => r.decision === "PERMIT").length;
  const denies = rows.filter((r) => r.decision === "DENY").length;
  const unknown = rows.filter((r) => r.decision === "UNKNOWN").length;

  return (
    <div className="gpb-page">
      <header className="gpb-head">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="gpb-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
        </button>
        <PageHeader eyebrow="LIVE AUTHORIZATION EXPLAINER" title="Group policy — live decisions" summary={<>This page makes one boundary visible: scopes are not entitlements. PingOne
          directory membership is re-read for each group-gated tool call, then the
          resulting decision is shown for the picked vertical. Switch verticals with
          the picker to see the same group rule enforced in each business.</>} />
      </header>

      <EmbeddedFlowDiagram
        config={GROUP_POLICY_DIAGRAM}
        title="How one decision is made"
        lede="The board and the check panel ask PingOne Authorize the same question about two different users; flipping membership in the PingOne directory flips the next answer."
        ariaLabel="Group policy decision flow"
        testId="gpb-diagram"
        pingStyle
      />

      <section className="gpb-control">
        {/* Re-uses the same component as the UC9 card, so there is one code path
            for the membership write rather than two that can disagree. */}
        <GroupMembershipToggle onChange={load} />
      </section>

      <section className="gpb-check" aria-label="Group check">
        <h2>Run a group check</h2>
        <p className="gpb-check-sub">
          The board above can only ask about you. This runs the same live
          PingOne Authorize decision for any demo user — pick one, pick a
          vertical, fire. Add or remove them from the group and the very next
          check flips: the directory changed, the token did not.
        </p>
        <div className="gpb-check-controls">
          <label>
            <span>User</span>
            <select
              value={checkUser}
              onChange={(e) => setCheckUser(e.target.value)}
              disabled={checking}
            >
              <option value="demoUser">demoUser</option>
              <option value="demoAdmin">demoAdmin</option>
              <option value="demoDelegate">demoDelegate</option>
            </select>
          </label>
          <label>
            <span>Vertical</span>
            <select
              value={checkVertical}
              onChange={(e) => setCheckVertical(e.target.value)}
              disabled={checking}
            >
              {(verticals || [{ id: 'banking', displayName: 'Banking' }]).map((v) => (
                <option key={v.id} value={v.id}>{v.displayName}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="gpb-check-run"
            onClick={runCheck}
            disabled={checking}
          >
            {checking ? "Checking…" : "Run check"}
          </button>
        </div>

        {checkError ? (
          <div className="gpb-error" role="alert">
            <span>⚠️</span>
            <div>
              <div className="gpb-error-title">Check failed</div>
              <div className="gpb-error-detail">{checkError}</div>
            </div>
          </div>
        ) : null}

        {checkResult ? (
          <div className="gpb-check-result">
            <span
              className={`gpb-decision gpb-decision--${String(checkResult.decision).toLowerCase()}`}
              data-testid="check-decision"
            >
              {checkResult.decision}
            </span>
            <span className="gpb-check-who">
              {checkResult.username} · {checkResult.displayName}
            </span>
            <span className="gpb-check-group">
              {checkResult.inRequiredGroup ? "✓" : "✕"} {checkResult.requiredGroup || "—"}
            </span>
            {checkResult.denyReason ? (
              <span className="gpb-codes" data-testid="check-reason">{checkResult.denyReason}</span>
            ) : null}
            {checkResult.codes?.length ? (
              <span className="gpb-codes">{checkResult.codes.join(" + ")}</span>
            ) : null}
            {checkResult.error ? (
              <span className="gpb-codes" role="alert">{checkResult.error}</span>
            ) : null}
            {/* The transition control — the demo is add → permitted, remove →
                denied, with the check re-run against the live directory each
                time. Only offered once a check has answered for this user. */}
            <button
              type="button"
              className={`gpb-check-toggle ${checkResult.inRequiredGroup ? "gpb-check-toggle--remove" : "gpb-check-toggle--add"}`}
              onClick={() => toggleMembership(!checkResult.inRequiredGroup)}
              disabled={toggling || checking}
            >
              {toggling
                ? "Applying…"
                : checkResult.inRequiredGroup
                  ? `Remove from ${checkResult.requiredGroup}`
                  : `Add to ${checkResult.requiredGroup}`}
            </button>
            {!checkResult.policyEnabled ? (
              <span className="gpb-note gpb-note--warn">
                ff_authorize_group_policy is OFF — the group decides nothing while it is off.
              </span>
            ) : null}
            {checkResult.source === "manifest" ? (
              <span className="gpb-note gpb-note--warn">
                Membership came from the manifest, not the live directory.
              </span>
            ) : null}
            {toggleNote ? <span className="gpb-check-note">{toggleNote}</span> : null}
            {/* The vertical's own story: what the tier is called in this
                business, and why THIS user is in or out. The server picks the
                story half from the decision, so the presenter reads the right
                half aloud without translating manifest keys on stage. */}
            {checkResult.access ? (
              <div className="gpb-check-story">
                <span className="gpb-check-story-label" data-testid="check-access-label">
                  {checkResult.access.label}
                </span>
                <span className="gpb-check-story-text" data-testid="check-access-story">
                  {checkResult.inRequiredGroup
                    ? checkResult.access.memberStory
                    : checkResult.access.nonMemberStory}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="gpb-board" aria-live="polite">
        <div className="gpb-board-head">
          <h2>Decisions — {rows[0]?.displayName || checkVertical}</h2>
          {/* Two subjects live on this page: the check panel asks about the
              user YOU picked (demoDelegate…), the board asks about the user
              who is SIGNED IN. Without the label, opposite verdicts for two
              users in the same group read as a contradiction (seen live
              2026-10-12: panel DENY for demoDelegate, board PERMIT for the
              signed-in demoUser). */}
          {data?.username ? (
            <span className="gpb-board-subject" data-testid="board-subject">
              asking about the signed-in user: {data.username}
            </span>
          ) : null}
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
          <p className="gpb-loading" role="status"><PingIdentitySpinner size={20} label="Asking PingOne Authorize…" /></p>
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
