// DigitalWorkerRunPanel — the unattended half of the Digital Worker page.
//
// The diagram above it (DigitalWorkerPage) is what a digital worker IS; this
// panel is what one DOES with nobody watching: it arms itself, fires a job on
// its own schedule, and replays the token chain of a run that happened with no
// browser present. It reuses the Autonomous Agents feature end to end — same
// endpoints, same replay path — because an unattended run IS an autonomous
// run; the page is a different lens on the same capability, not a new one.
//
// All run-list and run-fire calls happen only when enabled === true: everything
// under the flag gate 403s otherwise, so the panel simply doesn't call it.
import React, { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";

const FLAG_URL = "/api/autonomous-runs/flag";
const LIST_URL = "/api/autonomous-runs?limit=5";
const JOBS = ["balance-sweep", "fraud-watch"];

export default function DigitalWorkerRunPanel() {
  const [enabled, setEnabled] = useState(null); // null = not yet known
  const [armExpiresInMs, setArmExpiresInMs] = useState(null);
  const [job, setJob] = useState("balance-sweep");
  const [runs, setRuns] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiClient.get(LIST_URL);
      setRuns(res.data?.runs || []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(FLAG_URL)
      .then((res) => {
        if (cancelled) return;
        const on = Boolean(res.data?.enabled);
        setEnabled(on);
        if (on) loadRuns();
      })
      .catch(() => {
        // 403 feature_disabled and every other failure read the same to a
        // visitor: the worker is not armed here.
        if (!cancelled) setEnabled(false);
      });
    return () => { cancelled = true; };
  }, [loadRuns]);

  async function toggleArm() {
    const next = !enabled;
    setBusy(true);
    try {
      const res = await apiClient.post(FLAG_URL, { enabled: next });
      const on = Boolean(res.data?.enabled);
      setEnabled(on);
      setArmExpiresInMs(res.data?.armExpiresInMs ?? null);
      notifySuccess(on ? "Digital worker armed" : "Digital worker disarmed");
      if (on) loadRuns();
      else { setRuns([]); setLatestRun(null); }
    } catch {
      notifyError("Could not change the setting");
    } finally {
      setBusy(false);
    }
  }

  async function fire() {
    setBusy(true);
    try {
      const res = await apiClient.post("/api/autonomous-runs/run", { job });
      const run = res.data?.run;
      if (run) {
        setLatestRun(run);
        // replayUnattendedRun returns false when the run captured no token
        // events — then there is no reel to show and latestRun stays hidden
        // behind its guard below.
        replayUnattendedRun(run);
      } else {
        // Server refused because the arm window elapsed or the mandate was
        // revoked: report it as what it is and drop back to the armed-off UI.
        notifyError("Worker auto-disarmed");
        setNotice("The worker auto-disarmed — its arming window elapsed or its mandate was revoked.");
        setEnabled(false);
        setArmExpiresInMs(null);
        setRuns([]);
        setLatestRun(null);
      }
    } catch {
      notifyError("Could not start a run");
    } finally {
      setBusy(false);
    }
  }

  /** Open a run from the list: fetch the full record and replay its chain. */
  async function openRun(runId) {
    setBusy(true);
    try {
      const res = await apiClient.get(`/api/autonomous-runs/${runId}`);
      const run = res.data?.run;
      if (run) {
        setLatestRun(run);
        replayUnattendedRun(run);
      }
    } catch {
      notifyError("Could not load that run");
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
      setLatestRun(run);
      replayUnattendedRun(run);
      await loadRuns();
    } catch {
      // Someone else answered (or the window expired) while we sat here: refetch
      // the list so the panel shows what the server actually holds.
      notifyError("Could not record that decision");
      await loadRuns();
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  return (
    <section className="dw-run">
      <h2 className="dw-run__title">Unattended: the worker starts itself</h2>

      <div className="dw-run__arm">
        <label className="dw-run__arm-row">
          <input
            type="checkbox"
            role="switch"
            aria-label="Arm the worker"
            checked={Boolean(enabled)}
            disabled={busy}
            onChange={toggleArm}
          />
          <span>Arm the worker (it authenticates as itself, on its own schedule)</span>
        </label>
        {enabled && armExpiresInMs ? (
          <p className="dw-run__ttl">auto-disarms in {Math.round(armExpiresInMs / 60000)} min</p>
        ) : null}
        {notice ? <p className="dw-run__notice" role="status">{notice}</p> : null}
      </div>

      {enabled ? (
        <>
          <div className="dw-run__fire">
            <label className="dw-run__job">
              <span>Job</span>
              <select aria-label="Job" value={job} onChange={(e) => setJob(e.target.value)}>
                {JOBS.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </label>
            <button className="dw-run__fire-btn" type="button" disabled={busy} onClick={fire}>
              Fire without a human turn
            </button>
          </div>

          {latestRun && Array.isArray(latestRun.tokenEvents) && latestRun.tokenEvents.length ? (
            <div className="dw-run__reel">
              <TokenChainFilmstrip />
            </div>
          ) : null}

          {latestRun?.status === "parked" ? (
            <div className="dw-run__decide">
              <p>Over the standing mandate — waiting on an absent human's approval.</p>
              <button type="button" disabled={busy} onClick={() => decide(latestRun.runId, "approve")}>Approve</button>
              <button type="button" disabled={busy} onClick={() => decide(latestRun.runId, "deny")}>Deny</button>
            </div>
          ) : null}

          {runs.length ? (
            <ul className="dw-run__list">
              {runs.map((r) => (
                <li key={r.runId} className="dw-run__list-item">
                  <button type="button" className="dw-run__list-btn" onClick={() => openRun(r.runId)}>
                    {r.job} — {describeRun(r)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
