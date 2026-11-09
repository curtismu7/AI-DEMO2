import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import apiClient from "../services/apiClient";
import GroupMembershipToggle from "../components/GroupMembershipToggle";
import { useThemeOptional } from "../context/ThemeContext";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import { GROUP_POLICY_DIAGRAM } from "../config/groupPolicyBoardDiagram";
import "./GroupPolicyBoardPage.css";
import PageHeader from "../components/common/PageHeader";
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from "../components/pingUi";

const GROUP_POLICY_FLAG = "ff_authorize_group_policy";

// The chip tone a decision word earns. DENY is the policy working, not a page error, but it reads as the stop it is;
// anything that is not a clean PERMIT or DENY (UNKNOWN, INDETERMINATE) is a warning.
function decisionTone(decision) {
  const d = String(decision).toUpperCase();
  if (d === "PERMIT") return "ok";
  if (d === "DENY") return "danger";
  return "warn";
}

function sourceLabel(source) {
  if (source === "pingone") return "PingOne directory";
  if (source === "manifest") return "Manifest (not live)";
  return source ? String(source) : "Not reported";
}

/**
 * /group-policy and /group-policy/full on the Ping UI Standard, through the shared primitives (components/pingUi,
 * docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons. Skipped: P1 (the
 * app has its own shell), P6 (no list-and-detail inspector) and P8 (the diagram is the shared EmbeddedFlowDiagram).
 *
 * P9, one primary per view state: "Run check" is the primary in every state (nothing run, a result showing, a run
 * in flight, a failed run, a failed board read). It is the one action that asks a question; every other button
 * changes state or re-reads (Add / Remove, Re-check, the membership toggle, Retry, dark mode) and is a secondary.
 * While a request runs a button takes aria-disabled, not disabled, so keyboard focus stays on it, and its label
 * stays put: the progress is announced by a status line instead.
 *
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
  // The picked vertical lives in the URL (?verticalId=) so a reload, a shared link and
  // sign-in/sign-out all come back to the same vertical.
  const [searchParams, setSearchParams] = useSearchParams();
  const checkVertical = searchParams.get('verticalId') || 'banking';
  const setCheckVertical = useCallback((id) => {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('verticalId', id); return next; }, { replace: true });
  }, [setSearchParams]);
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
    if (toggling || checking) return; // aria-disabled keeps focus on the button; the click is ignored
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
  }, [checkUser, checkVertical, runCheck, load, toggling, checking]);

  const rows = data?.rows || [];
  const permits = rows.filter((r) => r.decision === "PERMIT").length;
  const denies = rows.filter((r) => r.decision === "DENY").length;
  const unknown = rows.filter((r) => r.decision === "UNKNOWN").length;

  const anyManifestRow = Boolean(data?.rows?.some((r) => r.source === "manifest"));
  const liveLookupReady = Boolean(data?.liveLookupReady);
  const boardName = rows[0]?.displayName
    || verticals?.find((v) => v.id === checkVertical)?.displayName
    || checkVertical;

  // Banner and board status are derived from what the board read actually returned, never fixed text: the same
  // words are false while the board is loading, after a failed read, or when membership is declared not live.
  let mode;
  if (error) mode = "unavailable";
  else if (!data) mode = "loading";
  else if (!liveLookupReady) mode = "manifest";
  else if (anyManifestRow) mode = "partial";
  else mode = "live";

  const BANNER = {
    loading: ["READING THE BOARD", "No decision has come back yet, so nothing on this page has been checked."],
    unavailable: ["BOARD UNAVAILABLE", "The decision board could not be read, so no verdicts are shown. That does not mean access is allowed or denied."],
    manifest: ["DECISIONS REAL, MEMBERSHIP DECLARED", "PingOne worker credentials are not configured, so membership comes from the vertical's manifest, which is declared intent and not directory truth. The Add and Remove controls write to the directory, which these decisions do not read."],
    partial: ["PARTLY LIVE", "At least one row fell back to manifest membership because its live lookup failed; treat those rows as unverified. The other rows read the PingOne directory."],
    live: ["LIVE DECISIONS", "Membership is read from the PingOne directory, and the Add and Remove controls write to it."],
  };
  const [bannerWord, bannerText] = BANNER[mode];

  // The board status line: always mounted, so a screen reader hears each change of state.
  let boardStatus;
  if (error) {
    boardStatus = { tone: "danger", word: "Unavailable", text: `The decision board could not be read (${error}). Nothing is shown, which does not mean nothing is denied.` };
  } else if (loading && !data) {
    boardStatus = { tone: "neutral", word: "Loading", text: `Requesting the decision for ${boardName}.` };
  } else if (loading) {
    boardStatus = { tone: "neutral", word: "Refreshing", text: "Asking again. The rows below are the previous answer." };
  } else if (data && rows.length === 0) {
    boardStatus = { tone: "neutral", word: "No rows", text: `${boardName} declares no group-gated tool, so there is no decision to show.` };
  } else if (data && (!liveLookupReady || anyManifestRow)) {
    boardStatus = { tone: "warn", word: "Not live", text: "Decisions came back, but some or all of the membership behind them is declared, not read from the directory." };
  } else if (data) {
    boardStatus = { tone: "ok", word: "Loaded", text: `${rows.length} decision${rows.length === 1 ? "" : "s"} read for ${boardName}.` };
  } else {
    boardStatus = { tone: "neutral", word: "Waiting", text: "Waiting for the board." };
  }

  const resultTone = checkResult ? decisionTone(checkResult.decision) : "neutral";
  const resultCardTone = { ok: "ok", danger: "danger", warn: "warn", neutral: "neutral" }[resultTone];

  return (
    <PingPage className="gpb-page">
      <SimBanner data-testid="gpb-banner">
        <strong>{bannerWord}</strong> — Each verdict comes from the same decision endpoint the tool gate calls; this
        page does not compute or simulate one. {bannerText} Opening this page switches {GROUP_POLICY_FLAG} on if it
        was off (admin access only) and restores it when you leave.
        {data && data.policyEnabled === false ? ` ${GROUP_POLICY_FLAG} is OFF right now, so group membership decides nothing.` : ""}
      </SimBanner>
      <PageHeader
        eyebrow="LIVE AUTHORIZATION EXPLAINER"
        title="Group policy — live decisions"
        summary={<>This page makes one boundary visible: scopes are not entitlements. PingOne
          directory membership is re-read for each group-gated tool call, then the
          resulting decision is shown for the picked vertical. Switch verticals with
          the picker to see the same group rule enforced in each business.</>}
        actions={(
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            data-testid="gpb-theme-toggle"
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            Dark mode
          </button>
        )}
      />
      <PageFrame>
        <Section
          id="gpb-rule-h"
          kicker="1 · The rule"
          title="Scopes are not entitlements"
          lede="The token's scopes never change on this page. What decides access is membership in the vertical's group."
        >
          <EmbeddedFlowDiagram
            config={GROUP_POLICY_DIAGRAM}
            title="How one decision is made"
            lede="The board and the check panel ask PingOne Authorize the same question about two different users; flipping membership in the PingOne directory flips the next answer."
            ariaLabel="Group policy decision flow"
            testId="gpb-diagram"
            pingStyle
          />
        </Section>

        <Section
          id="gpb-membership-h"
          kicker="2 · Your membership"
          title="Move yourself in and out of the group"
          lede="Add or remove the signed-in user from this vertical's group, then watch the board below move."
        >
          <Card data-testid="gpb-membership">
            {/* Re-uses the same component as the UC9 card, so there is one code path
                for the membership write rather than two that can disagree. Its own
                buttons are restyled as secondaries in this page's sheet. */}
            <GroupMembershipToggle onChange={load} />
          </Card>
        </Section>

        <Section
          id="gpb-check-h"
          kicker="3 · Ask about anyone"
          title="Run a group check"
          lede="The board below can only ask about you. This runs the same live decision for any demo user: pick one, pick a vertical, run it. Add or remove them from the group and the very next check flips: the directory changed, the token did not."
        >
          <CardGrid>
            <Card title="Pick a user and a vertical" data-testid="gpb-check">
              <div className="gpb-check-controls">
                <label>
                  <span className="pu-label">User</span>
                  <select
                    className="pu-select"
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
                  <span className="pu-label">Vertical</span>
                  <select
                    className="pu-select"
                    value={checkVertical}
                    onChange={(e) => setCheckVertical(e.target.value)}
                    disabled={checking}
                  >
                    {(verticals || [{ id: "banking", displayName: "Banking" }]).map((v) => (
                      <option key={v.id} value={v.id}>{v.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn pu-btn--primary"
                  onClick={() => { if (!checking) runCheck(); }}
                  aria-disabled={checking ? "true" : undefined}
                  data-testid="gpb-run-check"
                >
                  Run check
                </button>
              </div>
              <p className="pu-note" role="status" data-testid="gpb-check-status">
                {checking ? "Asking for the decision…" : ""}
              </p>
              {checkError ? (
                <div className="gpb-error" role="alert">
                  <StatusChip tone="danger">Check failed</StatusChip>
                  <span className="gpb-error-detail">{checkError}</span>
                </div>
              ) : null}
            </Card>

            <Card tone={resultCardTone} title="Result" data-testid="gpb-result">
              {/* Always mounted, so a screen reader hears the answer when it arrives. The write control sits
                  outside it: its label changes with the answer and must not be read out twice. */}
              <div className="gpb-result-live" role="status">
                {checkResult ? (
                  <>
                    <p className="pu-status-line">
                      <span data-testid="check-decision">
                        <StatusChip tone={resultTone}>{String(checkResult.decision)}</StatusChip>
                      </span>
                      <span className="gpb-check-who">{checkResult.username} · {checkResult.displayName}</span>
                    </p>
                    <KvList
                      items={[
                        { label: "Required group", value: checkResult.requiredGroup || "—", mono: true },
                        { label: "Membership", value: checkResult.inRequiredGroup ? "In group" : "Not in group" },
                        { label: "Source", value: sourceLabel(checkResult.source) },
                        ...(checkResult.denyReason
                          ? [{ label: "Reason", value: <span data-testid="check-reason">{checkResult.denyReason}</span>, mono: true }]
                          : []),
                        ...(checkResult.codes?.length
                          ? [{ label: "Statements", value: checkResult.codes.join(" + "), mono: true }]
                          : []),
                      ]}
                    />
                    {checkResult.error ? (
                      <p className="pu-status-line"><StatusChip tone="warn">Probe error</StatusChip>{checkResult.error}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="pu-note pu-empty">No check has run yet. Pick a user and a vertical, then Run check.</p>
                )}
                {toggling ? <p className="pu-note">Applying the change in PingOne…</p> : null}
                {toggleNote ? <p className="pu-note">{toggleNote}</p> : null}
              </div>
              {checkResult ? (
                <>
                  {/* The transition control: the demo is add, permitted; remove, denied, with the check re-run
                      against the live directory each time. Offered once a check has answered for this user. */}
                  <div className="pu-actions">
                    <button
                      type="button"
                      className="pu-btn"
                      onClick={() => toggleMembership(!checkResult.inRequiredGroup)}
                      aria-disabled={toggling || checking ? "true" : undefined}
                      data-testid="gpb-check-toggle"
                    >
                      {checkResult.inRequiredGroup
                        ? `Remove from ${checkResult.requiredGroup}`
                        : `Add to ${checkResult.requiredGroup}`}
                    </button>
                  </div>
                  {!checkResult.policyEnabled ? (
                    <p className="pu-status-line">
                      <StatusChip tone="warn">Flag off</StatusChip>
                      {GROUP_POLICY_FLAG} is OFF — the group decides nothing while it is off.
                    </p>
                  ) : null}
                  {checkResult.source === "manifest" ? (
                    <p className="pu-status-line">
                      <StatusChip tone="warn">Not live</StatusChip>
                      Membership came from the manifest, not the live directory.
                    </p>
                  ) : null}
                  {/* The vertical's own story: what the tier is called in this business, and why THIS user is in
                      or out. The server picks the story half from the decision, so the presenter reads the right
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
                </>
              ) : null}
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="gpb-board-h"
          kicker="4 · The board"
          title={`Decisions — ${boardName}`}
          lede={(
            <>
              {/* Two subjects live on this page: the check panel asks about the user YOU picked, the board asks
                  about the user who is SIGNED IN. Without the label, opposite verdicts for two users in the same
                  group read as a contradiction (seen live 2026-10-12: panel DENY for demoDelegate, board PERMIT
                  for the signed-in demoUser). */}
              {data?.username ? (
                <span data-testid="board-subject">asking about the signed-in user: {data.username}</span>
              ) : "Asking about the signed-in user."}
            </>
          )}
        >
          <Card tone="neutral" data-testid="gpb-board">
            <p className="pu-status-line" role="status" data-testid="gpb-board-status">
              <StatusChip tone={boardStatus.tone}>{boardStatus.word}</StatusChip>
              {boardStatus.text}
            </p>
            {data && rows.length > 0 ? (
              <p className="pu-status-line">
                <StatusChip tone="ok">{permits} permit</StatusChip>
                <StatusChip tone="danger">{denies} deny</StatusChip>
                {unknown > 0 ? <StatusChip tone="warn">{unknown} unknown</StatusChip> : null}
              </p>
            ) : null}
            <div className="pu-actions">
              <button
                type="button"
                className="pu-btn"
                onClick={() => { if (!loading) load(); }}
                aria-disabled={loading ? "true" : undefined}
                data-testid="gpb-refresh"
              >
                Re-check
              </button>
            </div>

            {rows.length > 0 ? (
              // Scrolls inside its own wrapper on wide content and stacks as labelled rows at phone width.
              // The wrapper is a keyboard-reachable named region because it can scroll.
              <div className="gpb-table-wrap" role="region" aria-label="Decision table" tabIndex={0}>
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
                        <th scope="row" data-label="Vertical">{r.displayName}</th>
                        <td data-label="Group-gated tool" className="pu-mono">{r.tool}</td>
                        <td data-label="Required group" className="pu-mono">{r.requiredGroup || "—"}</td>
                        <td data-label="In group">{r.inRequiredGroup ? "In group" : "Not in group"}</td>
                        <td data-label="Decision">
                          <StatusChip tone={decisionTone(r.decision)}>{String(r.decision)}</StatusChip>
                        </td>
                        {/* The statement code is what proves WHICH rule answered.
                            A bare PERMIT/DENY could come from anywhere. */}
                        <td data-label="Statement" className="pu-mono">{r.codes?.length ? r.codes.join(" + ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          {data && !liveLookupReady ? (
            <Card tone="warn" title="Membership is declared, not read" data-testid="gpb-manifest-note">
              <p className="pu-status-line"><StatusChip tone="warn">Not live</StatusChip>PingOne worker credentials are not configured.</p>
              <p className="pu-note">
                Membership is read from the manifest rather than the directory. The decisions are real, but
                the membership they are based on is declared intent, not directory truth.
              </p>
            </Card>
          ) : null}

          {data && liveLookupReady && anyManifestRow ? (
            <Card tone="warn" title="Some rows are unverified" data-testid="gpb-manifest-note">
              <p className="pu-status-line"><StatusChip tone="warn">Unverified</StatusChip>At least one row fell back to manifest membership.</p>
              <p className="pu-note">The live lookup failed for it. Treat those rows as unverified.</p>
            </Card>
          ) : null}
        </Section>
      </PageFrame>
    </PingPage>
  );
}
