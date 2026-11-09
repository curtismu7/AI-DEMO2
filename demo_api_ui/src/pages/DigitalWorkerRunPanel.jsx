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
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { replayUnattendedRun, describeRun } from "../services/tokenChainTrace/replayUnattendedRun";
import { notifyError, notifySuccess } from "../utils/appToast";
import DigitalWorkerSignIn from "./DigitalWorkerSignIn";
import { StatusChip, KvList } from "../components/pingUi";

const FLAG_URL = "/api/autonomous-runs/flag";
const LIST_URL = "/api/autonomous-runs?limit=5";
const JOBS = ["balance-sweep", "fraud-watch"];

// The word and tone for a run record's status. Green only for what the server recorded as finished; a run the
// page has not seen finish is never green. An unknown status shows its own word, neutral.
const RUN_CHIPS = {
  completed: { tone: "ok", word: "Completed" },
  parked: { tone: "warn", word: "Awaiting approval" },
  denied: { tone: "neutral", word: "Declined" },
  expired: { tone: "neutral", word: "Expired" },
  failed: { tone: "danger", word: "Failed" },
};
const runChip = (run) => RUN_CHIPS[run?.status] || { tone: "neutral", word: run?.status ? String(run.status) : "Recorded" };

// P9 "exactly one primary per view", per state (see DigitalWorkerPage for the whole page):
//   not armed        -> none (the Arm switch is the one control; a switch is not a button)
//   armed            -> "Fire without a human turn"
//   run parked       -> "Ask for approval on the phone" (or "Approve" when there is no amount); Fire becomes a secondary
//   signed out       -> "Sign in" (DigitalWorkerSignIn)
//   consent card open (consentOpen) -> the card owns the primary ("Open mock phone", then "Close"); Fire, Ask and Approve are secondaries
// Every control that is busy takes aria-disabled, not disabled, so keyboard focus stays where it is; the handler
// ignores the press. When a decision removes the buttons that held focus, focus moves to the "Latest run" region.

export default function DigitalWorkerRunPanel({ onAskConsent, consentOpen = false }) {
  const [enabled, setEnabled] = useState(null); // null = not yet known
  const [armExpiresInMs, setArmExpiresInMs] = useState(null);
  const [job, setJob] = useState("balance-sweep");
  const [runs, setRuns] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false); // the wall answered 401 to the flag read
  const resultRef = useRef(null);
  const [focusResult, setFocusResult] = useState(0);
  useEffect(() => {
    if (focusResult) resultRef.current?.focus();
  }, [focusResult]);

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
      .catch((err) => {
        if (cancelled) return;
        // 401: the wall wants a sign-in first. 403 feature_disabled and every other
        // failure read the same to a visitor: the worker is not armed here.
        if (err?.response?.status === 401) setNeedsSignIn(true);
        setEnabled(false);
      });
    return () => { cancelled = true; };
  }, [loadRuns]);

  async function toggleArm() {
    if (busy) return;
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
    if (busy) return;
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
        await loadRuns();
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
    } catch (err) {
      // A null run comes back as 403 feature_disabled: a real disarm mid-session
      // (arm TTL elapsed, another viewer disarmed, agent revoked) lands here,
      // so fall back to the same armed-off UI as the { run: null } branch.
      if (err?.response?.status === 403) {
        notifyError("Worker auto-disarmed");
        setNotice("The worker auto-disarmed — its arming window elapsed or its mandate was revoked.");
        setEnabled(false);
        setArmExpiresInMs(null);
        setRuns([]);
        setLatestRun(null);
      } else {
        notifyError("Could not start a run");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Open a run from the list: fetch the full record and replay its chain. */
  async function openRun(runId) {
    if (busy) return;
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
            : run?.status === "expired"
              ? "The approval request had already expired"
              : run?.status === "failed"
                ? "Approved, but the worker's action failed"
                : "Approval recorded",
      );
      setLatestRun(run);
      replayUnattendedRun(run);
      setFocusResult((n) => n + 1); // the Approve / Deny buttons that held focus are about to go
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

  // Put the transfer the worker is holding on the consent phone; the human's tap decides the run. Anything
  // other than a tap (expired, cancelled, signed out, busy, error) leaves the run parked for another try.
  async function askOnPhone(run) {
    const { amount, fromName } = run.proposal || {};
    const what = `${run.agent || "Worker"}: move $${amount} from ${fromName || "an account"}`;
    const answer = await onAskConsent({ amount, type: "transfer", description: what.slice(0, 80) }, what);
    if (answer === "approved") await decide(run.runId, "approve");
    else if (answer === "denied") await decide(run.runId, "deny");
  }

  if (enabled === null) return null;

  const parked = latestRun?.status === "parked";
  const lead = (on) => (on && !consentOpen ? "pu-btn pu-btn--primary" : "pu-btn");
  const hasChain = latestRun && Array.isArray(latestRun.tokenEvents) && latestRun.tokenEvents.length > 0;
  const canAskOnPhone = Boolean(onAskConsent) && Number(latestRun?.proposal?.amount) > 0;
  const press = (fn) => () => { if (!busy) fn(); };
  const aria = busy ? "true" : undefined;
  const chip = runChip(latestRun);

  return (
    <section className="dw-run" aria-labelledby="dw-run-h">
      <h3 id="dw-run-h" className="pu-h3">Unattended: the worker starts itself</h3>

      {needsSignIn ? <DigitalWorkerSignIn what="arm the worker" /> : (
        <div className="dw-run__arm">
          <p className="pu-status-line">
            <StatusChip tone={enabled ? "ok" : "neutral"}>{enabled ? "Armed" : "Not armed"}</StatusChip>
            <span>{enabled ? "The server reports the worker as armed." : "The worker is not armed, so it cannot run."}</span>
          </p>
          <label className="dw-run__arm-row">
            <input
              type="checkbox"
              role="switch"
              aria-label="Arm the worker"
              checked={Boolean(enabled)}
              aria-disabled={aria}
              onChange={press(toggleArm)}
            />
            <span>Arm the worker (it authenticates as itself, on its own schedule)</span>
          </label>
          {enabled && armExpiresInMs ? (
            <p className="pu-note dw-run__ttl">auto-disarms in {Math.round(armExpiresInMs / 60000)} min</p>
          ) : null}
          {notice ? <p className="pu-note dw-run__notice" role="status">{notice}</p> : null}
        </div>
      )}

      {enabled ? (
        <>
          <div className="dw-run__fire">
            <label className="pu-label dw-run__job">
              <span>Job</span>
              <select className="pu-select" aria-label="Job" value={job} onChange={(e) => setJob(e.target.value)}>
                {JOBS.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </label>
            <button className={lead(!parked)} type="button" aria-disabled={aria} onClick={press(fire)}>
              Fire without a human turn
            </button>
          </div>

          {latestRun ? (
            <div ref={resultRef} tabIndex={-1} role="region" aria-label="Latest run" className="dw-run__latest" data-testid="dw-latest-run">
              <p className="pu-status-line" role="status">
                <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
                <span>{latestRun.job} — {parked ? "held until a human decides" : describeRun(latestRun)}</span>
              </p>
              <KvList
                items={[
                  { label: "Run", value: String(latestRun.runId ?? "unknown"), mono: true },
                  ...(latestRun.agent ? [{ label: "Agent", value: latestRun.agent }] : []),
                  { label: "Token events", value: String(Array.isArray(latestRun.tokenEvents) ? latestRun.tokenEvents.length : 0) },
                ]}
              />
            </div>
          ) : null}

          {hasChain ? (
            <div className="dw-run__reel">
              <TokenChainFilmstrip />
            </div>
          ) : null}

          {parked ? (
            <div className="dw-run__decide">
              <p className="pu-note">Over the standing mandate — waiting on an absent human's approval.</p>
              <div className="pu-actions">
                {canAskOnPhone ? (
                  <button type="button" className={lead(true)} aria-disabled={aria} onClick={press(() => askOnPhone(latestRun))}>Ask for approval on the phone</button>
                ) : (
                  <>
                    <button type="button" className={lead(true)} aria-disabled={aria} onClick={press(() => decide(latestRun.runId, "approve"))}>Approve</button>
                    <button type="button" className="pu-btn" aria-disabled={aria} onClick={press(() => decide(latestRun.runId, "deny"))}>Deny</button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {runs.length ? (
            <ul className="dw-run__list" aria-label="Recent runs">
              {runs.map((r) => (
                <li key={r.runId} className="dw-run__list-item">
                  <button type="button" className="pu-btn dw-run__list-btn" aria-disabled={aria} onClick={press(() => openRun(r.runId))}>
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
