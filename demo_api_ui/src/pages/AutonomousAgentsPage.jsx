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

  async function runNow() {
    setBusy(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/run");
      if (res.data?.run) {
        notifySuccess("Run finished");
        loadRuns();
      }
    } catch {
      notifyError("Could not start a run");
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
            <button type="button" className="aap-btn" onClick={runNow} disabled={busy}>
              Run now
            </button>
          </div>
          <p className="aap-sub">
            The job runs at 02:00. "Run now" fires one immediately — nobody watches a demo at 02:00.
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
                    <span className="aap-desc">{describeRun(run)}</span>
                    <span className="aap-trigger">{run.trigger}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
