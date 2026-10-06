// Pick a run that happened with nobody watching and replay it into the Token
// Chain rail. Without this the rail can only ever show runs a browser drove,
// which is every run except the ones this panel exists for.
import React, { useEffect, useState } from "react";
import DraggableModal from "./DraggableModal";
import apiClient from "../services/apiClient";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./UnattendedRunsPanel.css";
import InlineSpinner from './shared/InlineSpinner';

export default function UnattendedRunsPanel({ isOpen, onClose }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [arming, setArming] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setDisabled(false);
    apiClient
      .get("/api/autonomous-runs")
      .then((res) => {
        if (!cancelled) setRuns(res.data?.runs || []);
      })
      .catch((err) => {
        if (cancelled) return;
        // 403 here is the feature flag being off, not a failure — say so
        // instead of showing an empty list that reads as "it ran and found
        // nothing".
        if (err?.response?.status === 403) setDisabled(true);
        else notifyError("Could not load unattended runs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  async function replay(runId) {
    try {
      const res = await apiClient.get(`/api/autonomous-runs/${runId}`);
      if (replayUnattendedRun(res.data?.run)) onClose();
      else notifyError("That run captured no token events to replay");
    } catch {
      notifyError("Could not load that run");
    }
  }

  async function runNow() {
    setLoading(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/run");
      const run = res.data?.run;
      if (run) {
        setRuns((prev) => [{ ...run, tokenEventCount: (run.tokenEvents || []).length }, ...prev]);
        notifySuccess(
          run.status === "completed"
            ? "Run completed — open it to replay the token chain"
            : run.status === "parked"
              ? "Over mandate — the run is waiting on approval"
              : run.status === "denied"
                ? "Refused by policy — nothing moved"
                : `Run ${run.status}`,
        );
      } else {
        notifyError("The run returned no result");
      }
    } catch {
      notifyError("Could not start a run");
    } finally {
      setLoading(false);
    }
  }

  // The demo user should not have to go find the flag toggle — enabling from
  // here flips ff_autonomous_agents via the same public route the Autonomous
  // Agents page uses, then fires a run so the demo shows the whole story.
  async function enableAndRun() {
    setArming(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/flag", { enabled: true });
      const expiresIn = res.data?.armExpiresInMs;
      notifySuccess(
        typeof expiresIn === "number"
          ? `Autonomous agents on — auto-disarms in ${Math.round(expiresIn / 60000)} min`
          : "Autonomous agents on",
      );
      setDisabled(false);
      await runNow();
    } catch {
      notifyError("Could not turn on autonomous agents");
    } finally {
      setArming(false);
    }
  }

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Unattended runs"
      defaultWidth={560}
      defaultHeight={460}
      storageKey="unattended-runs-panel"
      // Above Quick Config's floating panel (z-index 100061) — this modal is
      // opened FROM Quick Config, so it must land in front of it.
      zIndex={100070}
    >
      {/* dm-scroll: `dm-body` is bare by contract — no padding, no scroll. */}
      <div className="dm-scroll uarp">
        {disabled ? (
          <div className="uarp-disabled">
            <p className="uarp-empty">
              Autonomous agents are switched off. Turn on <code>ff_autonomous_agents</code> to
              let a scheduled run happen.
            </p>
            <button
              type="button"
              className="uarp-run"
              onClick={enableAndRun}
              disabled={arming}
            >
              {arming ? "Turning on…" : "Turn on and run now"}
            </button>
          </div>
        ) : (
          <>
            <div className="uarp-head">
              <p className="uarp-lede">
                These ran on a schedule with nobody signed in. Open one to see its token chain.
              </p>
              <button type="button" className="uarp-run" onClick={runNow} disabled={loading}>
                Run now
              </button>
            </div>

            {loading && !runs.length ? <p className="uarp-empty"><InlineSpinner label="Loading…" /></p> : null}
            {!loading && !runs.length ? (
              <p className="uarp-empty">No unattended runs yet. The job runs at 02:00, or start one now.</p>
            ) : null}

            <ul className="uarp-list">
              {runs.map((run) => (
                <li key={run.runId} className={`uarp-row uarp-row--${run.status}`}>
                  <button type="button" className="uarp-open" onClick={() => replay(run.runId)}>
                    <span className="uarp-job">{run.job}</span>
                    <span className="uarp-when">{new Date(run.startedAt).toLocaleString()}</span>
                    <span className="uarp-desc">
                      {run.status} · {describeRun(run)}
                      {/* Results — what the agent actually found/did, inline so
                          the row is evidence, not just a label to click. */}
                      {run.findings?.length ? (
                        <span className="uarp-findings">
                          {run.findings.map((f, i) => (
                            <span key={f.transactionId || i} className="uarp-finding">
                              {f.amount != null ? `${f.amount} — ` : ""}
                              {f.description || f.fromName || f.transactionId}
                              {f.reason ? ` (${f.reason})` : ""}
                              {f.executed ? " — moved" : ""}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="uarp-trigger">{run.trigger}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </DraggableModal>
  );
}
