// Pick a run that happened with nobody watching and replay it into the Token
// Chain rail. Without this the rail can only ever show runs a browser drove,
// which is every run except the ones this panel exists for.
import React, { useEffect, useState } from "react";
import DraggableModal from "./DraggableModal";
import apiClient from "../services/apiClient";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError } from "../utils/appToast";
import "./UnattendedRunsPanel.css";

export default function UnattendedRunsPanel({ isOpen, onClose }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);

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
      if (run) setRuns((prev) => [{ ...run, tokenEventCount: (run.tokenEvents || []).length }, ...prev]);
    } catch {
      notifyError("Could not start a run");
    } finally {
      setLoading(false);
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
    >
      <div className="uarp">
        {disabled ? (
          <p className="uarp-empty">
            Autonomous agents are switched off. Turn on <code>ff_autonomous_agents</code> to
            let a scheduled run happen.
          </p>
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

            {loading && !runs.length ? <p className="uarp-empty">Loading…</p> : null}
            {!loading && !runs.length ? (
              <p className="uarp-empty">No unattended runs yet. The job runs at 02:00, or start one now.</p>
            ) : null}

            <ul className="uarp-list">
              {runs.map((run) => (
                <li key={run.runId} className={`uarp-row uarp-row--${run.status}`}>
                  <button type="button" className="uarp-open" onClick={() => replay(run.runId)}>
                    <span className="uarp-job">{run.job}</span>
                    <span className="uarp-when">{new Date(run.startedAt).toLocaleString()}</span>
                    <span className="uarp-desc">{describeRun(run)}</span>
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
