// Guided Demo Track — live tab content for TokenChainDisplay.
// Polls /api/demo-track while mounted; slots fill themselves from real runs.
import React, { useCallback, useEffect, useState } from "react";
import "./TokenChainDemoTrackTab.css";

const POLL_MS = 5000;

function slotBadge(stamp, slot) {
  if (!stamp) return <span className="tct-slot tct-slot--empty">{slot?.chipText || slot?.label || "pending"}</span>;
  const cls = stamp.verdict === "PERMIT" ? "tct-slot--green" : "tct-slot--red";
  const mark = stamp.verdict === "PERMIT" ? "✓" : "✕";
  const time = stamp.at ? new Date(stamp.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <span className={`tct-slot ${cls}`}>
      {stamp.verdict} {mark} {time}
      {stamp.decisionId ? <span className="tct-decision"> · {stamp.decisionId}</span> : null}
    </span>
  );
}

export default function TokenChainDemoTrackTab() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/demo-track", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
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

  const setActiveStep = useCallback(async (stepId) => {
    try {
      await fetch("/api/demo-track/active-step", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  const startRun = useCallback(async () => {
    try {
      await fetch("/api/demo-track/runs", { method: "POST", credentials: "include" });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  if (error) return <div className="tct-error">Demo Track unavailable — {error}</div>;
  if (!state) return <div className="tct-loading">Loading demo track…</div>;

  const { track, run } = state;
  const gauntletTotal = track.gauntletSims.length;
  const gauntletBlocked = track.gauntletSims.filter(g => run.gauntlet[g.sim]?.blocked).length;
  const filled = Object.keys(run.slots).length;

  const renderStep = (step) => {
    const green = run.slots[`${step.stepId}:green`];
    const red = run.slots[`${step.stepId}:red`];
    const isActive = run.activeStepId === step.stepId;
    const isGauntlet = step.stepId === "attack-gauntlet";
    const complete = isGauntlet ? gauntletBlocked === gauntletTotal : Boolean((step.slots.green ? green : true) && (step.slots.red ? red : true));
    return (
      <div key={step.stepId} className={`tct-step${isActive ? " tct-step--active" : ""}${complete ? " tct-step--done" : ""}`}>
        <button type="button" className="tct-step-head" onClick={() => setActiveStep(step.stepId)}>
          <span className="tct-step-title">{step.title}</span>
          <span className="tct-step-ucs">{step.ucIds.join(" · ")}</span>
        </button>
        {isGauntlet ? (
          <div className="tct-gauntlet">
            <span className="tct-gauntlet-score">{gauntletBlocked} / {gauntletTotal} blocked</span>
            {track.gauntletSims.map(g => (
              <span key={g.sim} className={`tct-tile${run.gauntlet[g.sim]?.blocked ? " tct-tile--blocked" : ""}`}>
                {g.label}{run.gauntlet[g.sim]?.blocked ? " ✓" : ""}
              </span>
            ))}
          </div>
        ) : (
          <div className="tct-slots">
            {step.slots.green && <div className="tct-slot-row"><span className="tct-tag tct-tag--g">GREEN</span>{slotBadge(green, step.slots.green)}</div>}
            {step.slots.red && <div className="tct-slot-row"><span className="tct-tag tct-tag--r">RED</span>{slotBadge(red, step.slots.red)}</div>}
          </div>
        )}
        {complete && (
          <div className="tct-proved">
            <h5>STEP PROVED</h5>
            {step.proved.green && <div className="tct-proved-line"><span className="tct-mark-g">✓</span> {step.proved.green}</div>}
            {step.proved.red && <div className="tct-proved-line"><span className="tct-mark-r">✕</span> {step.proved.red}</div>}
            <div className="tct-say">SAY THIS: {step.proved.sayThis}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tct-root">
      <div className="tct-toolbar">
        <span className="tct-score">{filled} slots filled · gauntlet {gauntletBlocked}/{gauntletTotal}</span>
        <button type="button" className="tct-newrun" onClick={startRun}>Start new run</button>
        <a className="tct-open-page" href="/demo-track">Open full track page ↗</a>
      </div>
      <div className="tct-act">ACT 1 · THE CUSTOMER AGENT</div>
      {track.steps.filter(s => s.act === 1).map(renderStep)}
      <div className="tct-act">ACT 2 · SAME RAILS GOVERN THE ADMINS</div>
      {track.steps.filter(s => s.act === 2).map(renderStep)}
    </div>
  );
}
