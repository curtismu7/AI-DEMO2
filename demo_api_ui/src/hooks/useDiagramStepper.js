import { useCallback, useEffect, useState } from "react";
import { DEFAULT_STEP_MS } from "../components/diagram";

/**
 * Step state for a React Flow diagram that walks its arrows in order. step === -1 means the walkthrough is off and the diagram looks as it
 * always did; 0..total-1 is the arrow in focus.
 *
 * The shape matches DiagramControls: Simulate starts it playing, Pause/Resume
 * toggle auto-advance, Prev/Next work while paused, Stop returns to off.
 */
export function useDiagramStepper(total) {
  const [step, setStep] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const last = total - 1;

  useEffect(() => {
    if (step < 0 || paused) return undefined;
    if (step >= last) {
      setPaused(true);
      return undefined;
    }
    const id = setTimeout(() => setStep((s) => s + 1), stepMs);
    return () => clearTimeout(id);
  }, [step, paused, stepMs, last]);

  useEffect(() => {
    if (step > last) setStep(-1);
  }, [step, last]);

  const simulate = useCallback(() => {
    if (total < 1) return;
    setPaused(false);
    setStep(0);
  }, [total]);
  const resume = useCallback(() => {
    if (step >= last) setStep(0);
    setPaused(false);
  }, [step, last]);
  const next = useCallback(() => setStep((s) => Math.min(s + 1, last)), [last]);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);
  const pause = useCallback(() => setPaused(true), []);
  const stop = useCallback(() => {
    setStep(-1);
    setPaused(false);
  }, []);

  return {
    step,
    total,
    active: step >= 0,
    paused,
    stepMs,
    setStepMs,
    simulate,
    resume,
    next,
    prev,
    pause,
    stop,
  };
}

/**
 * React Flow edges for a walkthrough: the edge in focus is accented and animated,
 * edges not reached yet fade to dashed. step < 0 returns the edges untouched.
 */
export function stepEdges(edges, step) {
  if (step < 0) return edges;
  return edges.map((e, i) => {
    if (i === step) {
      return { ...e, animated: true, style: { ...e.style, stroke: "var(--th-status-info)", strokeWidth: 3.5 } };
    }
    if (i > step) return { ...e, style: { ...e.style, opacity: 0.3, strokeDasharray: "5 4" } };
    return e;
  });
}

/** "Source → Target: label" per edge; `names` maps node id to display text. Edges are objects or [src, tgt, label] tuples. */
export function edgeCaptions(edges, names) {
  return edges.map((e) => {
    const [source, target, label] = Array.isArray(e) ? e : [e.source, e.target, e.label ?? e.data?.label];
    return `${names[source] || source} → ${names[target] || target}${label ? `: ${label}` : ""}`;
  });
}
