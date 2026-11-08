// Autonomous Agents — the runs that happened with nobody signed in.
//
// Public by explicit decision (auth-requirements.json), including the feature
// toggle, so the page can be opened and driven without a session.
//
// Opening a run expands it in place: the full record, and the token chain
// replayed into TokenChainFilmstrip — the same reel the dashboard uses, fed
// from the same store, so a 02:00 job gets the identical treatment a live
// browser-driven run gets.
//
// Honesty: the runs are real calls to this machine's BFF (the agent's own token
// request and the policy decision). The one simulated step is CIBA: the approval
// request for a run over its mandate goes to a MOCK phone or email, never a real
// device, and Approve / Decline on this page stand in for that answer.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons. P9 reads "one primary per view" as one primary ACTION per
// state: switch off or still loading = the switch ("Turn on"); switch on = "Run
// fraud watch"; a parked run open with its approval showing = "Approve" (the only
// action that advances it, so both run buttons and "Turn off" drop to secondary).
// "Decline" is always a secondary. A button that cannot act while a call is in flight
// takes aria-disabled, never disabled, so keyboard focus stays where it was.
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./AutonomousAgentsPage.css";
import InlineSpinner from '../components/shared/InlineSpinner';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';

/** Status → the word a reader actually needs. */
const STATUS_COPY = {
  completed: "Completed",
  parked: "Waiting on approval",
  denied: "Refused by policy",
  failed: "Failed",
  expired: "Approval expired",
};

/** The status word always shows; the tone only colours the card edge and chip (P4, P7). */
const STATUS_TONE = {
  completed: "ok",
  parked: "warn",
  denied: "danger",
  failed: "danger",
  expired: "neutral",
};

/** Key/value rows for an opened run; a row with no value is left out. */
function runFacts(run) {
  const rows = [
    ["Agent", run.agent],
    ["Fired by", run.trigger],
    ["Started", new Date(run.startedAt).toLocaleString()],
    ["Outcome", STATUS_COPY[run.status] || run.status],
    ["What it looked at", run.scanned ? `${run.scanned} record(s)` : null],
    ["Standing mandate", run.mandate
      ? `${run.mandate.maxAmount} per ${run.mandate.window} (${run.mandate.source})`
      : run.job === "balance-sweep" ? "none declared — refused" : null],
    ["Wanted to move", run.proposal ? `${run.proposal.amount} from ${run.proposal.fromName}` : null],
    ["Authenticated as", run.identity
      ? (run.identity.ownIdentity ? "its own PingOne registration" : "nothing — it has no identity of its own")
      : null],
    ["Policy said", run.decision ? `${run.decision.decision} · ${run.decision.code || "no code"}` : null],
    ["Error", run.error],
  ];
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => ({ label, value }));
}

export default function AutonomousAgentsPage() {
  const [enabled, setEnabled] = useState(null); // null = not yet known
  const [runs, setRuns] = useState([]);
  const [openRunId, setOpenRunId] = useState(null);
  const [openRun, setOpenRun] = useState(null);
  const [busy, setBusy] = useState(false);
  // After a decision the Approve / Decline buttons leave the page; focus goes to the run's own row
  // button so a keyboard user is not dropped back to the top of the document.
  const [focusRunId, setFocusRunId] = useState(null);
  const rowButtons = useRef({});

  useEffect(() => {
    if (!focusRunId) return;
    const el = rowButtons.current[focusRunId];
    if (el) el.focus();
    setFocusRunId(null);
  }, [focusRunId, runs, openRun]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/autonomous-runs");
      setRuns(res.data?.runs || []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/autonomous-runs/flag")
      .then((res) => {
        if (cancelled) return;
        const on = Boolean(res.data?.enabled);
        setEnabled(on);
        if (on) loadRuns();
      })
      .catch(() => {
        if (!cancelled) notifyError("Could not read the autonomous-agents setting");
      });
    return () => { cancelled = true; };
  }, [loadRuns]);

  async function toggle() {
    if (busy || enabled === null) return;
    const next = !enabled;
    setBusy(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/flag", { enabled: next });
      const on = Boolean(res.data?.enabled);
      setEnabled(on);
      notifySuccess(on ? "Autonomous agents on" : "Autonomous agents off");
      if (on) loadRuns();
      else { setRuns([]); setOpenRunId(null); setOpenRun(null); }
    } catch {
      notifyError("Could not change the setting");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(job) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/run", { job });
      const run = res.data?.run;
      if (run) {
        notifySuccess(
          run.status === "parked"
            ? "Over the mandate — the run is waiting on approval"
            : run.status === "denied"
              ? "Refused by policy — nothing moved"
              : "Run finished",
        );
        await loadRuns();
        open(run.runId);
      }
    } catch {
      notifyError("Could not start a run");
    } finally {
      setBusy(false);
    }
  }

  /** Expand a run: fetch the full record and replay its chain into the reel. */
  async function open(runId) {
    if (openRunId === runId) {
      setOpenRunId(null);
      setOpenRun(null);
      return;
    }
    setOpenRunId(runId);
    setOpenRun(null);
    try {
      const res = await apiClient.get(`/api/autonomous-runs/${runId}`);
      const run = res.data?.run;
      setOpenRun(run);
      // Feeds the same store TokenChainFilmstrip subscribes to. Returns false
      // when the run captured no token events — then there is no reel to show,
      // and the detail below says so rather than rendering an empty one.
      replayUnattendedRun(run);
    } catch {
      notifyError("Could not load that run");
      setOpenRunId(null);
    }
  }

  async function decide(runId, decision) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiClient.post(`/api/autonomous-runs/${runId}/${decision}`);
      const run = res.data?.run;
      notifySuccess(
        run?.status === "completed"
          ? "Approved — the transfer went through"
          : run?.status === "denied"
            ? "Declined — nothing moved"
            : "The approval request had already expired",
      );
      await loadRuns();
      setOpenRun(run);
      setFocusRunId(runId);
    } catch {
      notifyError("Could not record that decision");
    } finally {
      setBusy(false);
    }
  }

  // P9 (one primary per state, see the header comment).
  const approvalShowing = Boolean(enabled && openRun && openRun.status === "parked");
  const switchPrimary = enabled !== true;
  const fraudPrimary = enabled === true && !approvalShowing;
  const stateWord = enabled === null ? "Checking" : enabled ? "On" : "Off";

  return (
    <PingPage className="aap">
      <SimBanner data-testid="aap-banner">
        <strong>SIMULATED APPROVAL</strong> — the runs are real calls: this machine&apos;s BFF fetches the
        agent&apos;s token with the client-credentials grant and asks the policy engine for a decision, and a run
        says so when the agent has no registration of its own. The one simulated step is CIBA: an approval request
        goes to a <strong>mock phone or email</strong>, never to a real phone or inbox, and Approve and Decline on
        this page stand in for that answer. An approved sweep moves demo-bank money only.
      </SimBanner>
      <PageHeader className="aap-head" title="Autonomous Agents" summary={<>An agent that runs on a schedule, with nobody signed in, and authenticates as
          itself.</>} />

      <PageFrame>
        {/* ── What this is ─────────────────────────────────────────── */}
        <Section id="aap-idea-h" kicker="1 · The idea" title="Worker agents and autonomous agents">
          <p className="aap-body">
            Nearly every agent in this demo is a <strong>worker agent</strong>: you type
            something, and it acts inside your session. Its token says the subject is{" "}
            <em>you</em>, with an <code>act</code> claim naming the agent — RFC 8693
            delegation. It can only reach what you can reach, and when it needs permission
            for something risky it asks you, because you are right there.
          </p>
          <p className="aap-body">
            An <strong>autonomous agent</strong> has none of that. It wakes on a schedule at
            02:00 with no session to borrow, so it authenticates as itself with the
            client-credentials grant: the token&apos;s subject is the <em>agent</em>, and there is
            no <code>act</code> claim, because nobody delegated anything. Nothing bounds it to
            a person&apos;s entitlements and nobody is present to consent.
          </p>
          <CardGrid>
            <Card tone="neutral" title="Worker agent" data-testid="aap-card-worker">
              <p className="pu-status-line"><StatusChip tone="neutral">User present</StatusChip></p>
              <ul className="aap-points">
                <li>Fired by a user turn</li>
                <li><code>sub</code> = the user, <code>act</code> = the agent</li>
                <li>Bounded by that user&apos;s entitlements</li>
                <li>Asks the user in-session</li>
                <li>Ends when the session ends</li>
              </ul>
            </Card>
            <Card tone="warn" title="Autonomous agent" data-testid="aap-card-autonomous">
              <p className="pu-status-line"><StatusChip tone="warn">Nobody present</StatusChip></p>
              <ul className="aap-points">
                <li>Fired by a schedule or an event</li>
                <li><code>sub</code> = the agent, no <code>act</code> claim</li>
                <li>Bounded by a <strong>standing mandate</strong></li>
                <li>Asks an absent human over CIBA (a mock phone or email here)</li>
                <li>Only stops when revoked — explicitly</li>
              </ul>
            </Card>
          </CardGrid>
        </Section>

        {/* ── Why it matters ───────────────────────────────────────── */}
        <Section
          id="aap-why-h"
          kicker="2 · Why it matters"
          title="Why the distinction is the point"
          lede={<>The question a security team actually asks is not &quot;how clever is this agent&quot; but{" "}
            <strong>&quot;was a human present when the token was minted?&quot;</strong> Everything that
            matters follows from the answer — what bounds it, who approves an exception, and
            what &quot;stop it&quot; has to mean.</>}
        >
          <CardGrid>
            <Card title="The mandate is the consent">
              <p className="aap-body">
                Nobody can approve at 02:00, so the ceiling is granted ahead of time, in the
                agent&apos;s declaration — and enforced by PingOne Authorize, not by the agent&apos;s
                own code.
              </p>
            </Card>
            <Card title="An unevaluable request is refused, not escalated">
              <p className="aap-body">
                An agent with no declared mandate is denied outright. Asking a human to
                approve something no policy could reason about just moves it past a rubber
                stamp.
              </p>
            </Card>
            <Card title="Stopping it means cancelling the schedule">
              <p className="aap-body">
                Blocking the next tool call is not containment — the cron keeps firing and the
                agent keeps waking up and authenticating. The kill cancels the schedule, and
                survives a restart.
              </p>
            </Card>
          </CardGrid>
        </Section>

        {/* ── Use cases ────────────────────────────────────────────── */}
        <Section
          id="aap-use-h"
          kicker="3 · Where it applies"
          title="When you would use one"
          lede="Anywhere the work has to happen whether or not somebody is at a keyboard — and where you would be uncomfortable handing a service account a blank cheque."
        >
          <CardGrid>
            <Card title="Nightly Fraud Watch">
              <p className="aap-body">
                Scans overnight transactions for anything over a threshold and records what it
                found. <strong>Read only</strong> — it moves nothing, so it can never exceed a
                mandate and never has to ask. This is the one that proves an agent can run
                unattended at all.
              </p>
            </Card>
            <Card title="Balance Sweep">
              <p className="aap-body">
                Moves surplus out of checking on a schedule. <strong>It can spend</strong>, so
                it is the one with something to ask about: within its mandate it sweeps
                silently, over it the run parks and a simulated CIBA request goes to the account
                owner (a mock phone or email), and past the absolute limit it is refused with
                no approval on offer.
              </p>
            </Card>
            <Card title="The same shape elsewhere">
              <p className="aap-body">
                Reconciliation that must clear before the books open, an access review that
                expires whether or not the reviewer logs in, a supplier feed that reprices
                overnight, a patient-record sweep that flags gaps before a clinic opens.
              </p>
            </Card>
          </CardGrid>
        </Section>

        {/* ── The switch ───────────────────────────────────────────── */}
        <Section id="aap-switch-h" kicker="4 · The switch" title="Autonomous agents">
          <Card data-testid="aap-switch-card">
            <div className="aap-toggle-row">
              <div>
                <p className="pu-status-line">
                  <StatusChip tone={enabled ? "warn" : "neutral"}>{stateWord}</StatusChip>
                  <code>ff_autonomous_agents</code>
                </p>
                <p className="aap-sub">
                  {enabled === null
                    ? "Checking the setting…"
                    : enabled
                      ? "On: the nightly jobs are scheduled and runs can be started."
                      : "Off: nothing is scheduled and no run can be started."}
                </p>
              </div>
              <ActionButton
                emphasis={switchPrimary}
                busy={busy || enabled === null}
                onClick={toggle}
                data-testid="aap-switch"
              >
                {enabled ? "Turn off" : "Turn on"}
              </ActionButton>
            </div>
          </Card>
          {enabled === false ? (
            <p className="pu-empty pu-note" data-testid="aap-off-note">
              Turn the switch on to schedule the nightly jobs and start a run. Nothing is
              scheduled while it is off, and no run can be started.
            </p>
          ) : null}
        </Section>

        {/* ── History ──────────────────────────────────────────────── */}
        {enabled ? (
          <Section
            id="aap-runs-h"
            kicker="5 · Run history"
            title="Run history"
            lede={<>Fraud watch runs at 02:00, balance sweep at 06:00. Nobody watches a demo at
              02:00, so start one now. <strong>Open a run</strong> to see its full record and
              replay the token chain it produced.</>}
          >
            <div className="pu-actions">
              <ActionButton
                emphasis={fraudPrimary}
                busy={busy}
                onClick={() => runNow("fraud-watch")}
                data-testid="aap-run-fraud-watch"
              >
                Run fraud watch
              </ActionButton>
              <ActionButton
                busy={busy}
                onClick={() => runNow("balance-sweep")}
                data-testid="aap-run-balance-sweep"
              >
                Run balance sweep
              </ActionButton>
            </div>

            {!runs.length ? (
              <p className="pu-empty pu-note">No unattended runs yet.</p>
            ) : (
              <ul className="aap-list">
                {runs.map((run) => {
                  const isOpen = openRunId === run.runId;
                  const tone = STATUS_TONE[run.status] || "neutral";
                  return (
                    <li key={run.runId}>
                      <Card tone={tone} className="aap-run" data-testid={`aap-run-${run.runId}`}>
                        <button
                          type="button"
                          className="aap-open"
                          onClick={() => open(run.runId)}
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? `aap-detail-${run.runId}` : undefined}
                          ref={(el) => { rowButtons.current[run.runId] = el; }}
                        >
                          <span className="aap-chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                          <span className="aap-job">{run.job}</span>
                          <StatusChip tone={tone}>{STATUS_COPY[run.status] || run.status}</StatusChip>
                          <span className="aap-when">{new Date(run.startedAt).toLocaleString()}</span>
                          <span className="aap-desc">{run.summary || describeRun(run)}</span>
                        </button>

                        {isOpen ? (
                          <div className="aap-detail" id={`aap-detail-${run.runId}`}>
                            {!openRun ? (
                              <p className="pu-empty pu-note"><InlineSpinner label="Loading the run…" /></p>
                            ) : (
                              <>
                                <KvList items={runFacts(openRun)} />

                                {openRun.identity && !openRun.identity.ownIdentity ? (
                                  <Card tone="warn" title="No identity of its own" data-testid="aap-no-identity">
                                    <p className="pu-status-line"><StatusChip tone="warn">Did not run</StatusChip></p>
                                    <p className="aap-body">
                                      <strong>This agent has no identity of its own, so it did not run.</strong>{" "}
                                      {openRun.identity.reason}. It deliberately does not borrow a shared
                                      client: an agent acting under someone else&apos;s identity is the thing
                                      this demo exists to make visible. Configure its credentials and
                                      provision the registration, and the run proceeds.
                                    </p>
                                  </Card>
                                ) : null}

                                {openRun.findings?.length ? (
                                  <div className="aap-findings">
                                    <h3 className="pu-h3">Findings</h3>
                                    <ul className="aap-points">
                                      {openRun.findings.map((f, i) => (
                                        <li key={f.transactionId || i}>
                                          {f.amount != null ? `${f.amount}` : ""}{" "}
                                          {f.description || f.fromName || f.transactionId}{" "}
                                          {f.reason ? <em>— {f.reason}</em> : null}
                                          {f.executed ? <strong> (moved)</strong> : null}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}

                                {openRun.status === "parked" ? (
                                  <Card tone="warn" title="Waiting on the account owner" data-testid="aap-parked">
                                    <p className="pu-status-line"><StatusChip tone="warn">Waiting on approval</StatusChip></p>
                                    <p className="aap-body">
                                      Over the standing mandate, so the agent cannot do this on its own.
                                      A simulated CIBA request was raised for {openRun.pending?.loginHint}.
                                      It goes to a mock phone or email, not a real device, so Approve and
                                      Decline below stand in for the answer. Left unanswered, it lapses
                                      after {Math.round((openRun.pending?.expiresIn || 300) / 60)} minutes.
                                    </p>
                                    <div className="pu-actions">
                                      <ActionButton
                                        emphasis={approvalShowing}
                                        busy={busy}
                                        onClick={() => decide(openRun.runId, "approve")}
                                        data-testid="aap-approve"
                                      >
                                        Approve
                                      </ActionButton>
                                      <ActionButton
                                        busy={busy}
                                        onClick={() => decide(openRun.runId, "deny")}
                                        data-testid="aap-decline"
                                      >
                                        Decline
                                      </ActionButton>
                                    </div>
                                  </Card>
                                ) : null}

                                <div className="aap-reel">
                                  <h3 className="pu-h3">Token chain</h3>
                                  {openRun.tokenEvents?.length ? (
                                    <>
                                      <p className="aap-sub">
                                        The chain this run actually produced. The subject is the agent and
                                        there is no <code>act</code> claim — nobody delegated it.
                                      </p>
                                      <div className="aap-reel-frame">
                                        <TokenChainFilmstrip />
                                      </div>
                                    </>
                                  ) : (
                                    <p className="pu-empty pu-note">
                                      This run captured no token events, so there is nothing to replay.
                                    </p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        ) : null}
      </PageFrame>
    </PingPage>
  );
}

/**
 * The page's one button. `emphasis` is true for the single action that advances the current state (P9); the
 * callers compute it from one rule, so exactly one ActionButton has it at a time. While a call is in flight
 * `busy` sets aria-disabled instead of disabled, so keyboard focus stays on the button.
 */
function ActionButton({ emphasis, busy, children, ...rest }) {
  return (
    <button
      type="button"
      className={`pu-btn${emphasis ? " pu-btn--primary" : ""}`}
      aria-disabled={busy ? "true" : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
