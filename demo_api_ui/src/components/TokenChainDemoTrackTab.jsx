// Guided Demo Track — live tab content (mounted via TokenChainTraceRail).
// Polls /api/demo-track while mounted; slots fill themselves from real runs.
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import "./TokenChainDemoTrackTab.css";

const POLL_MS = 5000;

/**
 * Mini token-chain strip for a filled slot (spec surface-2 polish). Verdict-driven
 * summary of the enforcement chain: a PERMIT reaches the tool; DENY/BLOCKED stops
 * at P1AZ with the tool struck through; HITL/STEP_UP stops at the challenge.
 */
function ChainStrip({ stamp }) {
  if (!stamp) return null;
  const permit = stamp.verdict === "PERMIT";
  const tool = stamp.via || "tool";
  const p1azLabel = permit ? "P1AZ PERMIT" : `P1AZ ${stamp.verdict} ${stamp.verdict === "HITL" || stamp.verdict === "STEP_UP" ? "" : "✕"}`.trim();
  return (
    <div className="tct-chain">
      <span className="tct-cn tct-cn--ok">user token ✓</span><span className="tct-ca">›</span>
      <span className="tct-cn tct-cn--ok">RFC 8693 · act ✓</span><span className="tct-ca">›</span>
      <span className={`tct-cn ${permit ? "tct-cn--ok" : "tct-cn--deny"}`}>{p1azLabel}</span><span className="tct-ca">›</span>
      {permit
        ? <span className="tct-cn tct-cn--ok">{tool} ✓</span>
        : <span className="tct-cn tct-cn--skip">{tool} — never called</span>}
    </div>
  );
}

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
  // "idle" | "busy" | "done" | "failed" — drives the Start-new-run button's
  // visible feedback (a fresh empty run looks identical to the previous one,
  // so without this the click appears to do nothing).
  const [runState, setRunState] = useState("idle");
  const runFlashRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/demo-track");
      setState(res.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      clearInterval(t);
      if (runFlashRef.current) clearTimeout(runFlashRef.current);
    };
  }, [load]);

  const setActiveStep = useCallback(async (stepId) => {
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

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
            {track.gauntletSims.map(g => {
              const tile = run.gauntlet[g.sim];
              return (
                <span key={g.sim} className={`tct-tile${tile?.blocked ? " tct-tile--blocked" : ""}`} title={tile?.reason || ""}>
                  {g.label}{tile?.blocked ? " ✓" : ""}
                  {tile?.errorCode ? <span className="tct-tile-code">{tile.errorCode}</span> : null}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="tct-slots">
            {step.slots.green && <div className="tct-slot-row"><span className="tct-tag tct-tag--g">GREEN</span>{slotBadge(green, step.slots.green)}</div>}
            {green?.reason && <div className="tct-reason tct-reason--g">{green.reason}</div>}
            {green && <ChainStrip stamp={green} />}
            {step.slots.red && <div className="tct-slot-row"><span className="tct-tag tct-tag--r">RED</span>{slotBadge(red, step.slots.red)}</div>}
            {red?.reason && (
              <div className="tct-reason tct-reason--r">
                {red.errorCode ? <span className="tct-reason-code">{red.errorCode}</span> : null}
                {red.reason}
              </div>
            )}
            {red && <ChainStrip stamp={red} />}
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
        <button
          type="button"
          className={`tct-newrun${runState === "failed" ? " tct-newrun--failed" : ""}`}
          onClick={startRun}
          disabled={runState === "busy"}
        >
          {runState === "busy" ? "Starting…"
            : runState === "done" ? "✓ New run started"
            : runState === "failed" ? "✕ Failed — retry"
            : "Start new run"}
        </button>
        <a className="tct-open-page" href="/demo-track">Open full track page ↗</a>
      </div>
      <div className="tct-act">ACT 1 · THE CUSTOMER AGENT</div>
      {track.steps.filter(s => s.act === 1).map(renderStep)}
      <div className="tct-act">ACT 2 · SAME RAILS GOVERN THE ADMINS</div>
      {track.steps.filter(s => s.act === 2).map(renderStep)}
    </div>
  );
}
