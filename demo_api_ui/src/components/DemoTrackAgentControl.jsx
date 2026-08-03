// Demo Track header control — shared by the floating and embedded agent
// (both are BankingAgent). Button shows the active step position; the picker
// is a DraggableModal per the standing modal rule.
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import DraggableModal from "./DraggableModal";
import "./DemoTrackAgentControl.css";

const POLL_MS = 5000;
const ACT_LABELS = { 1: "ACT 1 · THE CUSTOMER AGENT", 2: "ACT 2 · SAME RAILS GOVERN THE ADMINS" };

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet?.[g.sim]?.blocked);
  }
  const green = !step.slots.green || run.slots[`${step.stepId}:green`];
  const red = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(green && red);
}

export default function DemoTrackAgentControl({ onPickStep, onStepComplete }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  // Picked-step completion watch: fire onStepComplete once per (run, step) when
  // the picked step's slots fill from real runs.
  const pickedRef = useRef(null); // stepId | null
  const firedRef = useRef(new Set()); // `${runId}:${stepId}`
  const onStepCompleteRef = useRef(onStepComplete);
  onStepCompleteRef.current = onStepComplete;

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/demo-track");
      setState(res.data);
      const { track, run } = res.data || {};
      const pickedId = pickedRef.current;
      if (track && run && pickedId) {
        const steps = track.steps;
        const i = steps.findIndex((s) => s.stepId === pickedId);
        const step = steps[i];
        const key = `${run.runId}:${pickedId}`;
        if (step && !firedRef.current.has(key) && stepComplete(step, run, track.gauntletSims)) {
          firedRef.current.add(key);
          const nextStep = steps[i + 1] || null;
          onStepCompleteRef.current?.({
            step, index: i, total: steps.length,
            next: nextStep ? { step: nextStep, index: i + 1, total: steps.length } : null,
          });
        }
      }
    } catch { /* header control is best-effort; next poll retries */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const pick = useCallback(async (step, index, total) => {
    setOpen(false);
    pickedRef.current = step.stepId;
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId: step.stepId });
    } catch { /* still hand off — chips work without server ack */ }
    onPickStep?.({ step, index, total });
    load();
  }, [onPickStep, load]);

  if (!state) return null;
  const { track, run } = state;
  const { steps, gauntletSims } = track;
  const activeIdx = Math.max(0, steps.findIndex((s) => s.stepId === run.activeStepId));

  return (
    <>
      <button type="button" className="dta-trigger" onClick={() => setOpen(true)}>
        Demo Track: <b>Step {activeIdx + 1} of {steps.length}</b> ▾
      </button>
      {open && (
        <DraggableModal
          isOpen={open}
          title="Guided Demo Track"
          onClose={() => setOpen(false)}
          defaultWidth={340}
          defaultHeight={520}
        >
          <div className="dta-menu">
            {[1, 2].map((act) => (
              <React.Fragment key={act}>
                <div className="dta-act">{ACT_LABELS[act]}</div>
                {steps.filter((s) => s.act === act).map((s) => {
                  const i = steps.indexOf(s);
                  const done = stepComplete(s, run, gauntletSims);
                  const current = run.activeStepId === s.stepId;
                  return (
                    <button
                      key={s.stepId}
                      type="button"
                      className={`dta-item${done ? " dta-item--done" : ""}${current ? " dta-item--current" : ""}`}
                      onClick={() => pick(s, i, steps.length)}
                    >
                      <span className="dta-n">{done ? "✓" : i + 1}</span>
                      <span className="dta-title">{s.title}</span>
                      <span className="dta-ucs">{s.ucIds.join("·")}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
            <a className="dta-foot" href="/demo-track">Open full track page ↗</a>
          </div>
        </DraggableModal>
      )}
    </>
  );
}
