// Guided Demo Track — standalone presenter page (spec surface 1).
// Live view polls /api/demo-track; the run picker swaps in an archived
// run from /api/demo-track/runs as a static snapshot (no polling, no mutation).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
import "./DemoTrackPage.css";

const POLL_MS = 5000;
const ACT_META = {
  1: { label: "ACT 1 — THE CUSTOMER AGENT", tagline: "One user, one agent, real money — prove every action is governed." },
  2: { label: "ACT 2 — SAME RAILS GOVERN THE ADMINS", tagline: "The AI that manages your identity platform is itself governed by it." },
};

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet?.[g.sim]?.blocked);
  }
  const green = !step.slots.green || run.slots[`${step.stepId}:green`];
  const red = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(green && red);
}

function SlotRow({ tag, slot, stamp, prompt, onRun, runStatus, canRun }) {
  const verdictCls =
    stamp && (stamp.verdict === "PERMIT" ? "dtp-verdict--permit" : stamp.verdict === "STEP_UP" ? "dtp-verdict--stepup" : "dtp-verdict--deny");
  return (
    <div className="dtp-run-row">
      <span className={`dtp-run-tag dtp-run-tag--${tag === "GREEN" ? "g" : "r"}`}>{tag}</span>
      <span className="dtp-chip">{prompt || slot.chipText || slot.label}</span>
      {stamp ? (
        <span className={`dtp-verdict ${verdictCls}`}>
          {stamp.verdict} {stamp.verdict === "PERMIT" ? "✓" : "✕"} {fmtTime(stamp.at)}
          {stamp.decisionId ? ` · ${stamp.decisionId}` : ""}
        </span>
      ) : runStatus === "error" ? (
        <span className="dtp-run-note dtp-run-note--error">✕ run failed — check the agent</span>
      ) : (
        <span className="dtp-run-note">waiting for a matching run</span>
      )}
      {canRun && (
        <button
          type="button"
          className="dtp-run-btn"
          onClick={onRun}
          disabled={runStatus === "running"}
        >
          {runStatus === "running" ? "Running…" : stamp ? "Run again" : "Run"}
        </button>
      )}
    </div>
  );
}

export default function DemoTrackPage() {
  const [state, setState] = useState(null); // { track, run } (live)
  const [history, setHistory] = useState([]);
  const [viewRunId, setViewRunId] = useState("live");
  const [expanded, setExpanded] = useState(null); // stepId | null — manual expand overlay
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [stateRes, runsRes] = await Promise.all([
        apiClient.get("/api/demo-track"),
        apiClient.get("/api/demo-track/runs"),
      ]);
      setState(stateRes.data);
      setHistory(runsRes.data.runs || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const isLive = viewRunId === "live";
  const run = useMemo(() => {
    if (!state) return null;
    if (isLive) return state.run;
    return history.find((r) => r.runId === viewRunId) || state.run;
  }, [state, history, viewRunId, isLive]);

  // "idle" | "busy" | "done" | "failed" — visible feedback for Start new run
  // (a fresh empty run renders identically, so the click needs its own signal).
  const [runState, setRunState] = useState("idle");
  const runFlashRef = useRef(null);
  useEffect(() => () => { if (runFlashRef.current) clearTimeout(runFlashRef.current); }, []);

  const startRun = useCallback(async () => {
    setRunState("busy");
    try {
      await apiClient.post("/api/demo-track/runs");
      await load();
      setRunState("done");
    } catch {
      setRunState("failed");
    }
    if (runFlashRef.current) clearTimeout(runFlashRef.current);
    runFlashRef.current = setTimeout(() => setRunState("idle"), 1800);
  }, [load]);

  const onStepClick = useCallback(async (stepId) => {
    setExpanded((cur) => (cur === stepId ? null : stepId));
    if (!isLive) return;
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId });
      load();
    } catch { /* next poll recovers */ }
  }, [isLive, load]);

  // ── In-page runner: dispatch chips through the REAL agent, honoring the
  // active vertical. Chip text resolves from the per-vertical use-case catalog
  // (e.g. UC2 is "hand off to a specialist" in banking but "show my sensitive
  // patient records" in healthcare); sim-sourced red slots run attack sims.
  const [vertical, setVertical] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [slotRuns, setSlotRuns] = useState({}); // `${stepId}:${color}` -> "running" | "error"

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiClient.get("/api/verticals/me");
        const activeId = me.data?.activeId || "banking";
        if (cancelled) return;
        setVertical(activeId);
        const cat = await apiClient.get(`/api/use-cases?vertical=${encodeURIComponent(activeId)}`);
        if (!cancelled) setCatalog(cat.data?.useCases || []);
      } catch { /* runner degrades to config chip text */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Vertical-resolved prompt for a step's green chip: the catalog trigger of the
  // step's primary backing UC wins; config chipText is the fallback.
  const promptFor = useCallback((step, color, slot) => {
    if (color === "green") {
      const primary = step.ucIds?.[0];
      const uc = catalog.find((u) => u && (u.id === primary || u.useCaseId === step.stepId));
      if (uc?.trigger?.type === "chip" && uc.trigger.text) return uc.trigger.text;
    }
    return slot.chipText || null;
  }, [catalog]);

  const setSlotRun = useCallback((key, value) =>
    setSlotRuns((cur) => {
      const next = { ...cur };
      if (value) next[key] = value; else delete next[key];
      return next;
    }), []);

  const runSlot = useCallback(async (step, color, slot) => {
    const key = `${step.stepId}:${color}`;
    setSlotRun(key, "running");
    try {
      if (slot.source === "sim") {
        for (const sim of slot.match?.sims || []) {
          // Sequential on purpose: rapid-fire but ordered, like the launcher.
          // eslint-disable-next-line no-await-in-loop
          await apiClient.post("/api/demo/attack-sim/run", { sim });
        }
      } else {
        // Arm the flags this step needs (same contract as the launcher/dropdown).
        const flags = requiredFlagsForUseCase({ useCaseId: step.stepId, primaryTool: slot.match?.tools?.[0] || null });
        if (flags.length) {
          const updates = Object.fromEntries(flags.map((f) => [f, true]));
          await apiClient.patch("/api/admin/feature-flags", { updates }).catch(() => {});
        }
        const prompt = promptFor(step, color, slot);
        if (!prompt) throw new Error("no dispatchable chip for this slot");
        await apiClient.post("/api/agent/invoke", { prompt, forceHeuristic: true, vertical: vertical || "banking" });
      }
      setSlotRun(key, null);
    } catch {
      setSlotRun(key, "error");
    }
    load();
  }, [promptFor, vertical, load, setSlotRun]);

  if (error) return <div className="dtp-error">Demo Track unavailable — {error}</div>;
  if (!state || !run) return <div className="dtp-loading">Loading demo track…</div>;

  const { track } = state;
  const { steps, gauntletSims } = track;
  const gauntletBlocked = gauntletSims.filter((g) => run.gauntlet?.[g.sim]?.blocked).length;
  const allDone = steps.every((s) => stepComplete(s, run, gauntletSims));
  const doneCount = steps.filter((s) => stepComplete(s, run, gauntletSims)).length;

  const renderStep = (step, idx) => {
    const complete = stepComplete(step, run, gauntletSims);
    const isActive = isLive && run.activeStepId === step.stepId;
    const isOpen = expanded ? expanded === step.stepId : isActive;
    const green = run.slots[`${step.stepId}:green`];
    const red = run.slots[`${step.stepId}:red`];
    const isGauntlet = step.stepId === "attack-gauntlet";
    return (
      <div key={step.stepId} className={`dtp-step${complete ? " dtp-step--done" : ""}${isActive ? " dtp-step--active" : ""}`}>
        <button type="button" className="dtp-step-head" onClick={() => onStepClick(step.stepId)}>
          <span className="dtp-step-num">{complete ? "✓" : idx + 1}</span>
          <span className="dtp-step-title">{step.title}</span>
          <span className="dtp-step-cap">{step.capability}</span>
          <span className="dtp-step-ucs">{step.ucIds.join(" · ")}</span>
          {complete && <span className="dtp-step-status">PROVED</span>}
          <span className="dtp-chev">{isOpen ? "▾" : "▸"}</span>
        </button>
        {!isOpen && (
          <div className="dtp-collapsed-note">
            {step.slots.green && <span>✓ {green ? step.proved.green : step.slots.green.chipText}</span>}
            {step.slots.green && step.slots.red && <span> · </span>}
            {step.slots.red && <span>✕ {red ? step.proved.red : step.slots.red.chipText || step.slots.red.label}</span>}
          </div>
        )}
        {isOpen && (
          <div className="dtp-step-body">
            <div className="dtp-buyer-story">{step.buyerStory}</div>
            {isGauntlet ? (
              <>
                <div className="dtp-gauntlet-bar">
                  {isLive && step.slots.red && (
                    <button
                      type="button"
                      className="dtp-run-btn dtp-run-btn--gauntlet"
                      onClick={() => runSlot(step, "red", step.slots.red)}
                      disabled={slotRuns[`${step.stepId}:red`] === "running"}
                    >
                      {slotRuns[`${step.stepId}:red`] === "running" ? "Running attacks…" : "Run all 6 attacks"}
                    </button>
                  )}
                  <span className="dtp-gauntlet-score">{gauntletBlocked} / {gauntletSims.length} blocked</span>
                  {slotRuns[`${step.stepId}:red`] === "error" && (
                    <span className="dtp-run-note dtp-run-note--error">✕ a sim call failed</span>
                  )}
                </div>
                <div className="dtp-gauntlet">
                  {gauntletSims.map((g) => {
                    const tile = run.gauntlet?.[g.sim];
                    return (
                      <div key={g.sim} className="dtp-g-tile">
                        <div className="dtp-g-name">{g.label}</div>
                        <div className="dtp-g-uc">{g.ucId}</div>
                        <span className={`dtp-g-verdict${tile?.blocked ? " dtp-g-verdict--blocked" : ""}`}>
                          {tile?.blocked ? "BLOCKED ✓" : "pending"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {step.slots.green && (
                  <SlotRow
                    tag="GREEN" slot={step.slots.green} stamp={green}
                    prompt={promptFor(step, "green", step.slots.green)}
                    canRun={isLive && Boolean(promptFor(step, "green", step.slots.green))}
                    runStatus={slotRuns[`${step.stepId}:green`]}
                    onRun={() => runSlot(step, "green", step.slots.green)}
                  />
                )}
                {step.slots.red && (
                  <SlotRow
                    tag="RED" slot={step.slots.red} stamp={red}
                    prompt={step.slots.red.source === "sim" ? null : promptFor(step, "red", step.slots.red)}
                    canRun={isLive && (step.slots.red.source === "sim" || Boolean(step.slots.red.chipText))}
                    runStatus={slotRuns[`${step.stepId}:red`]}
                    onRun={() => runSlot(step, "red", step.slots.red)}
                  />
                )}
              </>
            )}
            {complete && (
              <div className="dtp-takeaway">
                <h4>WHAT THIS PROVED</h4>
                {step.proved.green && (
                  <div className="dtp-takeaway-line"><span className="dtp-mark dtp-mark--g">✓</span><span>{step.proved.green}</span></div>
                )}
                {step.proved.red && (
                  <div className="dtp-takeaway-line"><span className="dtp-mark dtp-mark--r">✕</span><span>{step.proved.red}</span></div>
                )}
                <div className="dtp-talk-track"><b>SAY THIS:</b> {step.proved.sayThis}</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="dtp-root">
      <div className="dtp-topbar">
        <div>
          <div className="dtp-brand">🔐 Guided Demo Track</div>
          <div className="dtp-subtitle">
            Two acts · {steps.length} steps · every step ends with a permit AND a deny
            {vertical && <span className="dtp-vertical-badge">Vertical: {vertical}</span>}
          </div>
        </div>
        <div className="dtp-progress">
          {steps.map((s, i) => {
            const complete = stepComplete(s, run, gauntletSims);
            const active = isLive && run.activeStepId === s.stepId;
            return (
              <span key={s.stepId} className={`dtp-dot${complete ? " dtp-dot--done" : ""}${active ? " dtp-dot--active" : ""}`}>
                {complete ? "✓" : i + 1}
              </span>
            );
          })}
        </div>
        <div className="dtp-controls">
          <label className="dtp-run-picker">
            Run
            <select aria-label="Run" value={viewRunId} onChange={(e) => setViewRunId(e.target.value)}>
              <option value="live">Live · started {fmtTime(state.run.startedAt)}</option>
              {history.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {new Date(r.startedAt).toLocaleString()} — {Object.keys(r.slots).length} slots
                </option>
              ))}
            </select>
          </label>
          {isLive && (
            <button
              type="button"
              className={`dtp-newrun${runState === "failed" ? " dtp-newrun--failed" : ""}`}
              onClick={startRun}
              disabled={runState === "busy"}
            >
              {runState === "busy" ? "Starting…"
                : runState === "done" ? "✓ New run started"
                : runState === "failed" ? "✕ Failed — retry"
                : "Start new run"}
            </button>
          )}
          {!isLive && <span className="dtp-history-badge">Viewing history — read-only</span>}
        </div>
      </div>

      <div className="dtp-wrap">
        {[1, 2].map((act) => (
          <React.Fragment key={act}>
            <div className="dtp-act-banner">
              <span className="dtp-act-label">{ACT_META[act].label}</span>
              <span className="dtp-act-tagline">{ACT_META[act].tagline}</span>
              <span className="dtp-act-rule" />
            </div>
            {steps.filter((s) => s.act === act).map((s) => renderStep(s, steps.indexOf(s)))}
          </React.Fragment>
        ))}

        {allDone ? (
          <div className="dtp-finish dtp-finish--done">
            <b>Track complete</b> — {steps.length} capabilities proved: {doneCount} permits and denials with decision evidence. Print this page as the leave-behind.
          </div>
        ) : (
          <div className="dtp-finish">
            {doneCount} of {steps.length} steps proved so far — run the remaining steps from the agent or the use-case launcher.
          </div>
        )}
      </div>
    </div>
  );
}
