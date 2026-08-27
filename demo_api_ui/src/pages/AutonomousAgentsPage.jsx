// Autonomous Agents — the runs that happened with nobody signed in.
//
// Public by explicit decision (auth-requirements.json), including the feature
// toggle, so the page can be opened and driven without a session.
//
// Opening a run expands it in place: the full record, and the token chain
// replayed into TokenChainFilmstrip — the same reel the dashboard uses, fed
// from the same store, so a 02:00 job gets the identical treatment a live
// browser-driven run gets.
import React, { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./AutonomousAgentsPage.css";

/** Status → the word a reader actually needs. */
const STATUS_COPY = {
  completed: "Completed",
  parked: "Waiting on approval",
  denied: "Refused by policy",
  failed: "Failed",
  expired: "Approval expired",
};

function Row({ label, children }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default function AutonomousAgentsPage() {
  const [enabled, setEnabled] = useState(null); // null = not yet known
  const [runs, setRuns] = useState([]);
  const [openRunId, setOpenRunId] = useState(null);
  const [openRun, setOpenRun] = useState(null);
  const [busy, setBusy] = useState(false);

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
    } catch {
      notifyError("Could not record that decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aap">
      <header className="aap-head">
        <h1 className="aap-title">Autonomous Agents</h1>
        <p className="aap-lede">
          An agent that runs on a schedule, with nobody signed in, and authenticates as
          itself.
        </p>
      </header>

      {/* ── What this is ───────────────────────────────────────────── */}
      <section className="aap-card aap-explain">
        <h2 className="aap-h2">Worker agents and autonomous agents</h2>
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
          client-credentials grant: the token's subject is the <em>agent</em>, and there is
          no <code>act</code> claim, because nobody delegated anything. Nothing bounds it to
          a person's entitlements and nobody is present to consent.
        </p>

        <div className="aap-compare">
          <div className="aap-compare-col aap-compare-col--worker">
            <h3 className="aap-h3">Worker agent</h3>
            <ul>
              <li>Fired by a user turn</li>
              <li><code>sub</code> = the user, <code>act</code> = the agent</li>
              <li>Bounded by that user's entitlements</li>
              <li>Asks the user in-session</li>
              <li>Ends when the session ends</li>
            </ul>
          </div>
          <div className="aap-compare-col aap-compare-col--auto">
            <h3 className="aap-h3">Autonomous agent</h3>
            <ul>
              <li>Fired by a schedule or an event</li>
              <li><code>sub</code> = the agent, no <code>act</code> claim</li>
              <li>Bounded by a <strong>standing mandate</strong></li>
              <li>Asks an absent human over CIBA</li>
              <li>Only stops when revoked — explicitly</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Why it matters ─────────────────────────────────────────── */}
      <section className="aap-card aap-explain">
        <h2 className="aap-h2">Why the distinction is the point</h2>
        <p className="aap-body">
          The question a security team actually asks is not "how clever is this agent" but{" "}
          <strong>"was a human present when the token was minted?"</strong> Everything that
          matters follows from the answer — what bounds it, who approves an exception, and
          what "stop it" has to mean.
        </p>
        <ul className="aap-points">
          <li>
            <strong>The mandate is the consent.</strong> Nobody can approve at 02:00, so the
            ceiling is granted ahead of time, in the agent's declaration — and enforced by
            PingOne Authorize, not by the agent's own code.
          </li>
          <li>
            <strong>An unevaluable request is refused, not escalated.</strong> An agent with
            no declared mandate is denied outright. Asking a human to approve something no
            policy could reason about just moves it past a rubber stamp.
          </li>
          <li>
            <strong>Stopping it means cancelling the schedule.</strong> Blocking the next
            tool call is not containment — the cron keeps firing and the agent keeps waking
            up and authenticating. The kill cancels the schedule, and survives a restart.
          </li>
        </ul>
      </section>

      {/* ── Use cases ──────────────────────────────────────────────── */}
      <section className="aap-card aap-explain">
        <h2 className="aap-h2">When you would use one</h2>
        <p className="aap-body">
          Anywhere the work has to happen whether or not somebody is at a keyboard — and
          where you would be uncomfortable handing a service account a blank cheque.
        </p>
        <div className="aap-uses">
          <div className="aap-use">
            <h3 className="aap-h3">Nightly Fraud Watch</h3>
            <p>
              Scans overnight transactions for anything over a threshold and records what it
              found. <strong>Read only</strong> — it moves nothing, so it can never exceed a
              mandate and never has to ask. This is the one that proves an agent can run
              unattended at all.
            </p>
          </div>
          <div className="aap-use">
            <h3 className="aap-h3">Balance Sweep</h3>
            <p>
              Moves surplus out of checking on a schedule. <strong>It can spend</strong>, so
              it is the one with something to ask about: within its mandate it sweeps
              silently, over it the run parks and CIBA goes to the account owner, and past
              the absolute limit it is refused with no approval on offer.
            </p>
          </div>
          <div className="aap-use">
            <h3 className="aap-h3">The same shape elsewhere</h3>
            <p>
              Reconciliation that must clear before the books open, an access review that
              expires whether or not the reviewer logs in, a supplier feed that reprices
              overnight, a patient-record sweep that flags gaps before a clinic opens.
            </p>
          </div>
        </div>
      </section>

      {/* ── The switch ─────────────────────────────────────────────── */}
      <section className="aap-card">
        <div className="aap-toggle-row">
          <div>
            <h2 className="aap-h2">Autonomous agents</h2>
            <p className="aap-sub">
              <code>ff_autonomous_agents</code> —{" "}
              {enabled === null
                ? "checking…"
                : enabled
                  ? "on: the nightly jobs are scheduled and runs can be started."
                  : "off: nothing is scheduled and no run can be started."}
            </p>
          </div>
          <button
            type="button"
            className={`aap-switch ${enabled ? "aap-switch--on" : ""}`}
            onClick={toggle}
            disabled={busy || enabled === null}
            aria-pressed={Boolean(enabled)}
          >
            <span className="aap-switch-knob" />
            <span className="aap-switch-label">{enabled ? "On" : "Off"}</span>
          </button>
        </div>
      </section>

      {/* ── History ────────────────────────────────────────────────── */}
      {enabled ? (
        <section className="aap-card">
          <div className="aap-runs-head">
            <h2 className="aap-h2">Run history</h2>
            <div className="aap-btnrow">
              <button type="button" className="aap-btn" onClick={() => runNow("fraud-watch")} disabled={busy}>
                Run fraud watch
              </button>
              <button type="button" className="aap-btn" onClick={() => runNow("balance-sweep")} disabled={busy}>
                Run balance sweep
              </button>
            </div>
          </div>
          <p className="aap-sub">
            Fraud watch runs at 02:00, balance sweep at 06:00. Nobody watches a demo at
            02:00, so start one now. <strong>Open a run</strong> to see its full record and
            replay the token chain it produced.
          </p>

          {!runs.length ? (
            <p className="aap-empty">No unattended runs yet.</p>
          ) : (
            <ul className="aap-list">
              {runs.map((run) => {
                const isOpen = openRunId === run.runId;
                return (
                  <li key={run.runId} className={`aap-row aap-row--${run.status}`}>
                    <button
                      type="button"
                      className="aap-open"
                      onClick={() => open(run.runId)}
                      aria-expanded={isOpen}
                    >
                      <span className="aap-chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                      <span className="aap-job">{run.job}</span>
                      <span className={`aap-status aap-status--${run.status}`}>
                        {STATUS_COPY[run.status] || run.status}
                      </span>
                      <span className="aap-when">{new Date(run.startedAt).toLocaleString()}</span>
                      <span className="aap-desc">{run.summary || describeRun(run)}</span>
                    </button>

                    {isOpen ? (
                      <div className="aap-detail">
                        {!openRun ? (
                          <p className="aap-empty">Loading the run…</p>
                        ) : (
                          <>
                            <dl className="aap-kv">
                              <Row label="Agent">{openRun.agent}</Row>
                              <Row label="Fired by">{openRun.trigger}</Row>
                              <Row label="Started">{new Date(openRun.startedAt).toLocaleString()}</Row>
                              <Row label="Outcome">{STATUS_COPY[openRun.status] || openRun.status}</Row>
                              <Row label="What it looked at">
                                {openRun.scanned ? `${openRun.scanned} record(s)` : null}
                              </Row>
                              <Row label="Standing mandate">
                                {openRun.mandate
                                  ? `${openRun.mandate.maxAmount} per ${openRun.mandate.window} (${openRun.mandate.source})`
                                  : openRun.job === "balance-sweep" ? "none declared — refused" : null}
                              </Row>
                              <Row label="Wanted to move">
                                {openRun.proposal
                                  ? `${openRun.proposal.amount} from ${openRun.proposal.fromName}`
                                  : null}
                              </Row>
                              <Row label="Authenticated as">
                                {openRun.identity
                                  ? (openRun.identity.ownIdentity
                                    ? "its own PingOne registration"
                                    : "a SHARED client — not its own registration")
                                  : null}
                              </Row>
                              <Row label="Policy said">
                                {openRun.decision
                                  ? `${openRun.decision.decision} · ${openRun.decision.code || "no code"}`
                                  : null}
                              </Row>
                              <Row label="Error">{openRun.error}</Row>
                            </dl>

                            {openRun.identity && !openRun.identity.ownIdentity ? (
                              <p className="aap-warn">
                                <strong>This run did not use its own identity.</strong>{" "}
                                {openRun.identity.reason}. The token chain below shows the client
                                that actually authenticated, not the agent named above.
                              </p>
                            ) : null}

                            {openRun.findings?.length ? (
                              <div className="aap-findings">
                                <h3 className="aap-h3">Findings</h3>
                                <ul>
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
                              <div className="aap-parked">
                                <p className="aap-parked-head">Waiting on the account owner</p>
                                <p className="aap-parked-body">
                                  Over the standing mandate, so the agent cannot do this on its own.
                                  CIBA sent to {openRun.pending?.loginHint} — simulated, so it also
                                  self-approves after a minute.
                                </p>
                                <div className="aap-btnrow">
                                  <button type="button" className="aap-btn" onClick={() => decide(openRun.runId, "approve")} disabled={busy}>
                                    Approve
                                  </button>
                                  <button type="button" className="aap-btn aap-btn--deny" onClick={() => decide(openRun.runId, "deny")} disabled={busy}>
                                    Decline
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            <div className="aap-reel">
                              <h3 className="aap-h3">Token chain</h3>
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
                                <p className="aap-empty">
                                  This run captured no token events, so there is nothing to replay.
                                </p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {enabled === false ? (
        <section className="aap-card">
          <p className="aap-empty">
            Turn the switch on to schedule the nightly jobs and start a run. Nothing is
            scheduled while it is off, and no run can be started.
          </p>
        </section>
      ) : null}
    </div>
  );
}
