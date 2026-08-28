// AgentOnboardingSubwayPage.jsx — subway-map + story-card walkthrough of
// Tarun Madiraju's onboarding architecture. A second, additive view of the
// same FLOWS data as AgentOnboardingFlowDiagram.jsx (the box+arrow diagram) —
// not a replacement. Design picked from 3 reviewed directions (dark subway
// pipeline for orientation, story-card Back/Continue/Play controls for
// pacing — see docs/superpowers/specs for the earlier box+arrow spec; this
// page's rationale is captured in its own commit message).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import TokenStepIndicator from "./TokenStepIndicator";
import { FLOWS, FLOW_ORDER } from "../data/agentOnboardingFlows";
import { STATION_LABELS, collapseStations } from "../data/agentOnboardingStations";
import "./AgentOnboardingSubwayPage.css";

const PLAY_INTERVAL_MS = 2200;

function useFlowSteps(flowKey, story) {
  return useMemo(() => {
    const flow = FLOWS[flowKey];
    return flowKey === "admin" ? flow.stories[story].steps : flow.steps;
  }, [flowKey, story]);
}

export default function AgentOnboardingSubwayPage() {
  const [flowKey, setFlowKey] = useState(FLOW_ORDER[0]);
  const [story, setStory] = useState("browserDevice");
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  const steps = useFlowSteps(flowKey, story);
  const { slots, slotForStep } = useMemo(() => collapseStations(steps), [steps]);
  const currentSlot = slotForStep[stepIndex];
  const step = steps[stepIndex];

  const selectFlow = useCallback((key, subStory) => {
    setPlaying(false);
    setFlowKey(key);
    if (subStory) setStory(subStory);
    setStepIndex(0);
  }, []);

  const onPrev = useCallback(() => {
    setPlaying(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);
  const onNext = useCallback(() => {
    setPlaying(false);
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }, [steps.length]);
  const onPlayToggle = useCallback(() => setPlaying((p) => !p), []);

  useEffect(() => {
    if (!playing) return undefined;
    if (stepIndex >= steps.length - 1) {
      setPlaying(false);
      return undefined;
    }
    timerRef.current = setTimeout(() => {
      setStepIndex((i) => Math.min(steps.length - 1, i + 1));
    }, PLAY_INTERVAL_MS);
    return () => clearTimeout(timerRef.current);
  }, [playing, stepIndex, steps.length]);

  const outcome = flowKey === "admin" ? FLOWS.admin.stories[story].outcome : FLOWS[flowKey].outcome;
  const persona = FLOWS[flowKey].persona;

  return (
    <div className="aos-page">
      <div className="aos-hero">
        <h1>Enterprise AI Onboarding — Subway Map</h1>
        <p className="aos-sub">
          Same onboarding flows as the box+arrow diagram, oriented as a pipeline —
          walk one persona's journey station by station.
        </p>
      </div>

      <div className="aos-flow-tabs" role="tablist" aria-label="Onboarding flow">
        {FLOW_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={flowKey === key}
            className={`aos-flow-tab${flowKey === key ? " active" : ""}`}
            onClick={() => selectFlow(key)}
          >
            {FLOWS[key].label}
          </button>
        ))}
      </div>

      {flowKey === "admin" && (
        <div className="aos-story-tabs" role="tablist" aria-label="Discovery story">
          {Object.entries(FLOWS.admin.stories).map(([key, s]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={story === key}
              className={`aos-story-tab${story === key ? " active" : ""}`}
              onClick={() => selectFlow("admin", key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="aos-persona">Persona: {persona}</p>

      <div className="aos-line-wrap">
        <div className="aos-line-track" />
        <div
          className="aos-line-fill"
          style={{ width: `${slots.length <= 1 ? 100 : (currentSlot / (slots.length - 1)) * 100}%` }}
        />
        <div className="aos-stations">
          {slots.map((key, i) => (
            <div
              key={key + i}
              className={`aos-station${i < currentSlot ? " done" : ""}${i === currentSlot ? " current" : ""}`}
            >
              <div className="aos-dot" />
              <div className="aos-lbl">{STATION_LABELS[key]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="aos-card">
        <div className="aos-eyebrow">
          <TokenStepIndicator
            currentStep={stepIndex + 1}
            totalSteps={steps.length}
            compact={true}
            showLabel={true}
          />
          <span style={{ marginLeft: '12px', color: '#64748b', fontSize: '0.9rem' }}>
            {STATION_LABELS[step.activeCardKeys[0]]}
          </span>
        </div>
        <h2>{step.title}</h2>
        <p>{step.narrative}</p>
      </div>

      {stepIndex === steps.length - 1 && (
        <div className="aos-outcome">
          <strong>Outcome:</strong> {outcome}
        </div>
      )}

      <div className="aos-ctrls">
        <button type="button" className="aos-btn-pill" onClick={onPrev} disabled={stepIndex === 0}>
          ← Back
        </button>
        <button
          type="button"
          className={`aos-btn-icon${playing ? " playing" : ""}`}
          onClick={onPlayToggle}
          title="Autoplay"
        >
          {playing ? "||" : "▶"}
        </button>
        <button type="button" className="aos-btn-pill primary" onClick={onNext} disabled={stepIndex === steps.length - 1}>
          {stepIndex === steps.length - 1 ? "Done ✓" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
