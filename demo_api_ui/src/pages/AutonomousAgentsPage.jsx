// Autonomous Agents — the runs that happened with nobody signed in.
//
// Public by explicit decision (auth-requirements.json), including the feature
// toggle, so the page can be opened and driven without a session.
import React, { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./AutonomousAgentsPage.css";

export default function AutonomousAgentsPage() {
  const [enabled, setEnabled] = useState(null); // null = not yet known
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/autonomous-runs");
      setRuns(res.data?.runs || []);
    } catch {
      // 403 here means the feature is off, which the flag state already says.
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
      else setRuns([]);
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
            : "Run finished",
        );
        loadRuns();
      }
    } catch {
      notifyError("Could not start a run");
    } finally {
      setBusy(false);
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
      loadRuns();
    } catch {
      notifyError("Could not record that decision");
    } finally {
      setBusy(false);
    }
  }

  async function replay(runId) {
    try {
      const res = await apiClient.get(`/api/autonomous-runs/${runId}`);
      if (replayUnattendedRun(res.data?.run)) {
        notifySuccess("Loaded into the Token Chain — open the agent to see it");
      } else {
        notifyError("That run captured no token events to replay");
      }
    } catch {
      notifyError("Could not load that run");
    }
  }

  return (
    <div className="aap">
      <header className="aap-head">
        <h1 className="aap-title">Autonomous Agents</h1>
        <p className="aap-lede">
          These agents run on a schedule with nobody signed in. They authenticate as
          themselves — the token's subject is the agent, and it carries no <code>act</code> claim,
          because there is no user to delegate from.
        </p>
      </header>

      <section className="aap-card">
        <div className="aap-toggle-row">
          <div>
            <h2 className="aap-h2">Autonomous agents</h2>
            <p className="aap-sub">
              <code>ff_autonomous_agents</code> —{" "}
              {enabled === null
                ? "checking…"
                : enabled
                  ? "on: the nightly job is scheduled and runs can be started."
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

      {enabled ? (
        <section className="aap-card">
          <div className="aap-runs-head">
            <h2 className="aap-h2">Runs</h2>
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
            Fraud watch reads only and runs at 02:00. Balance sweep can move money and runs at 06:00 —
            if what it wants to move is over the agent's standing mandate, the run parks and asks the
            account owner instead. Nobody watches a demo at 02:00, so run one now.
          </p>

          {!runs.length ? (
            <p className="aap-empty">No unattended runs yet.</p>
          ) : (
            <ul className="aap-list">
              {runs.map((run) => (
                <li key={run.runId} className={`aap-row aap-row--${run.status}`}>
                  <button type="button" className="aap-open" onClick={() => replay(run.runId)}>
                    <span className="aap-job">{run.job}</span>
                    <span className="aap-when">{new Date(run.startedAt).toLocaleString()}</span>
                    <span className="aap-desc">{run.summary || describeRun(run)}</span>
                    <span className="aap-trigger">{run.trigger}</span>
                  </button>

                  {run.status === "parked" ? (
                    <div className="aap-parked">
                      <p className="aap-parked-head">Waiting on the account owner</p>
                      <p className="aap-parked-body">
                        The agent wants to move {run.proposal?.amount} from {run.proposal?.fromName}.
                        Its standing mandate is {run.mandate?.maxAmount} per {run.mandate?.window},
                        so it cannot do this on its own.
                      </p>
                      {run.mandate?.maxAmount ? (
                        <div className="aap-gauge">
                          <div className="aap-gauge-head">
                            <span>Against the mandate</span>
                            <b>
                              {run.proposal?.amount} of {run.mandate.maxAmount}
                            </b>
                          </div>
                          <div className="aap-gauge-track">
                            <div className="aap-gauge-fill" />
                          </div>
                        </div>
                      ) : null}
                      <p className="aap-parked-sub">
                        CIBA sent to {run.pending?.loginHint} — simulated, so it also
                        self-approves after a minute.
                      </p>
                      <div className="aap-btnrow">
                        <button
                          type="button"
                          className="aap-btn"
                          onClick={() => decide(run.runId, "approve")}
                          disabled={busy}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="aap-btn aap-btn--deny"
                          onClick={() => decide(run.runId, "deny")}
                          disabled={busy}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
