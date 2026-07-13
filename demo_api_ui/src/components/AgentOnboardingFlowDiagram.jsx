// AgentOnboardingFlowDiagram.jsx
// Step-through walkthrough of Tarun Madiraju's "Enterprise AI Onboarding &
// Governance Architecture" — a proposed target-state design, not a live trace.
// Card/lane visual language reused from AgentGuardrailsDiagram.jsx; step
// control bar adapted from TokenChainTraceRail's step-list interaction model.
// Spec: docs/superpowers/specs/2026-07-12-agent-onboarding-flow-diagram-design.md
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import FloatingPanel from "./FloatingPanel";
import EditableSticky from "./EditableSticky";
import TokenStepIndicator from "./TokenStepIndicator";
import { ROWS, LEGEND, FLOWS, FLOW_ORDER } from "../data/agentOnboardingFlows";
import "./AgentOnboardingFlowDiagram.css";

const PLAY_INTERVAL_MS = 2500;

function boxClass(key, activeKeys, visitedKeys, extra = "") {
  const isActive = activeKeys.has(key);
  const isVisited = !isActive && visitedKeys.has(key);
  return `aof-box${isActive ? " aof-active-card" : ""}${isVisited ? " aof-visited-card" : ""}${
    extra ? ` ${extra}` : ""
  }`;
}

function LegendBadge({ num }) {
  if (!num) return null;
  return <span className={`aof-legend-badge aof-legend-badge--${num}`}>{num}</span>;
}

function Box({ box, activeKeys, visitedKeys, className = "" }) {
  return (
    <article className={boxClass(box.key, activeKeys, visitedKeys, className)} aria-current={activeKeys.has(box.key) ? "true" : undefined}>
      <div className="aof-box-head">
        <LegendBadge num={box.legendNum} />
        <div>
          <h3>{box.title}</h3>
          {box.subtitle && <p className="aof-box-subtitle">{box.subtitle}</p>}
        </div>
      </div>
      {box.tags && (
        <div className="aof-box-tags">
          {box.tags.map((t) => (
            <span key={t} className="aof-box-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {box.columns && Array.isArray(box.columns) && typeof box.columns[0] === "string" && (
        <div className="aof-box-tags">
          {box.columns.map((c) => (
            <span key={c} className="aof-box-tag aof-box-tag--col">
              {c}
            </span>
          ))}
        </div>
      )}
      {box.columns && Array.isArray(box.columns) && typeof box.columns[0] === "object" && (
        <div className="aof-box-columns">
          {box.columns.map((col) => (
            <div key={col.heading} className="aof-box-col">
              <div className="aof-box-col-heading">{col.heading}</div>
              <ul>
                {col.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {box.bullets && (
        <ul className="aof-box-bullets">
          {box.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {box.note && (
        <EditableSticky
          id={`box-${box.key}`}
          defaultText={box.note}
          rotate={-1.5}
          className="sticky--tan aof-box-sticky"
        />
      )}
    </article>
  );
}

function DiagramRow({ row, activeKeys, visitedKeys, isLast }) {
  return (
    <div className="aof-row-wrap">
      <div className="aof-row-with-sticky">
      <div className={`aof-row aof-row--${row.kind}`}>
        {row.kind === "triple" && (
          <div className="aof-row-triple">
            {row.boxes.map((box) => (
              <Box key={box.key} box={box} activeKeys={activeKeys} visitedKeys={visitedKeys} />
            ))}
          </div>
        )}

        {row.kind === "single" && (
          <Box box={row.box} activeKeys={activeKeys} visitedKeys={visitedKeys} className="aof-box--wide" />
        )}

        {row.kind === "orchestration" && (
          <div className={boxClass(row.box.key, activeKeys, visitedKeys, "aof-orchestration")}>
            <div className="aof-orchestration-label">
              <LegendBadge num={row.box.legendNum} />
              {row.label}
            </div>
            <div className="aof-orchestration-items">
              {row.box.items.map((item, i) => (
                <React.Fragment key={item}>
                  {i > 0 && <span className="aof-orchestration-arrow">→</span>}
                  <span className="aof-orchestration-item">{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {row.kind === "split" && (
          <div className="aof-row-split">
            <div className="aof-row-split-left">
              {row.left.map((box) => (
                <Box key={box.key} box={box} activeKeys={activeKeys} visitedKeys={visitedKeys} />
              ))}
            </div>
            <Box box={row.right} activeKeys={activeKeys} visitedKeys={visitedKeys} className="aof-box--wide" />
          </div>
        )}
      </div>

      {row.note && (
        <EditableSticky id={`row-${row.id}`} defaultText={row.note} rotate={row.id.length % 2 === 0 ? 1.5 : -1.5} className="aof-row-sticky" />
      )}
      </div>
      {!isLast && (
        <div className="aof-row-connector" aria-hidden="true">
          <span className="aof-row-connector-line" />
          <span className="aof-row-connector-chevron">▾</span>
        </div>
      )}
    </div>
  );
}

function useFlowSteps(flowKey, story) {
  return useMemo(() => {
    const flow = FLOWS[flowKey];
    if (flowKey === "admin") return flow.stories[story].steps;
    return flow.steps;
  }, [flowKey, story]);
}

function StepControls({ stepIndex, total, playing, onPrev, onNext, onPlayToggle, onReset }) {
  return (
    <div className="aof-controls" role="group" aria-label="Step controls">
      <button type="button" className="aof-ctrl-btn" onClick={onPrev} disabled={stepIndex === 0}>
        Prev
      </button>
      <button type="button" className="aof-ctrl-btn aof-ctrl-btn--primary" onClick={onPlayToggle}>
        {playing ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        className="aof-ctrl-btn"
        onClick={onNext}
        disabled={stepIndex === total - 1}
      >
        Next
      </button>
      <button type="button" className="aof-ctrl-btn aof-ctrl-btn--ghost" onClick={onReset}>
        Reset
      </button>
      <div className="aof-step-count">
        <TokenStepIndicator
          currentStep={stepIndex + 1}
          totalSteps={total}
          compact={true}
          showLabel={true}
        />
      </div>
    </div>
  );
}

export default function AgentOnboardingFlowDiagram() {
  const [flowKey, setFlowKey] = useState(FLOW_ORDER[0]);
  const [story, setStory] = useState("browserDevice");
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  const steps = useFlowSteps(flowKey, story);
  const step = steps[stepIndex];
  const visitedKeys = useMemo(() => {
    const keys = new Set();
    for (let i = 0; i < stepIndex; i += 1) {
      steps[i].activeCardKeys.forEach((k) => keys.add(k));
    }
    return keys;
  }, [steps, stepIndex]);
  const activeKeys = useMemo(() => new Set(step.activeCardKeys), [step]);

  const resetToFlow = useCallback((nextFlowKey, nextStory) => {
    setFlowKey(nextFlowKey);
    if (nextStory) setStory(nextStory);
    setStepIndex(0);
    setPlaying(false);
  }, []);

  const onPrev = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);
  const onNext = useCallback(
    () => setStepIndex((i) => Math.min(steps.length - 1, i + 1)),
    [steps.length],
  );
  const onReset = useCallback(() => {
    setStepIndex(0);
    setPlaying(false);
  }, []);
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

  const outcome =
    flowKey === "admin" ? FLOWS.admin.stories[story].outcome : FLOWS[flowKey].outcome;
  const persona = FLOWS[flowKey].persona;

  return (
    <div className="aof-page">
      <section className="aof-hero">
        <span className="aof-eyebrow">Proposed architecture — T. Madiraju</span>
        <h1>Enterprise AI Onboarding &amp; Governance Architecture</h1>
        <p className="aof-subhead">
          Illustrative walkthrough of a target-state design: any AI agent should
          automatically become a managed enterprise identity, with governance,
          privileges, and security applied throughout its lifecycle. This is a
          scripted walkthrough, not a live trace — most of the components shown
          here are not yet built in this demo.
        </p>
        <a
          className="learning-hub__weblink"
          href="https://curtismu7.github.io/llama-vscode-setup-guide/learning/agent-onboarding-flow.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            width: "fit-content",
            padding: "8px 14px",
            borderRadius: 999,
            background: "#f0eefb",
            border: "1px solid #ddd5fb",
            color: "#5b3fd6",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Share this diagram on the web — open the public page ↗
        </a>
      </section>

      <FloatingPanel
        title="Agent Onboarding Flow — Step Through"
        defaultWidth={1280}
        defaultHeight={840}
        defaultX={20}
        defaultY={20}
        minWidth={620}
        minHeight={420}
        className="aof-floating-panel"
      >
        <div className="aof-root">
          <div className="aof-flow-tabs" role="tablist" aria-label="Onboarding flow">
            {FLOW_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={flowKey === key}
                className={`aof-flow-tab${flowKey === key ? " active" : ""}`}
                onClick={() => resetToFlow(key)}
              >
                {FLOWS[key].label}
              </button>
            ))}
          </div>

          {flowKey === "admin" && (
            <div className="aof-story-tabs" role="tablist" aria-label="Discovery story">
              {Object.entries(FLOWS.admin.stories).map(([key, s]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={story === key}
                  className={`aof-story-tab${story === key ? " active" : ""}`}
                  onClick={() => resetToFlow("admin", key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <p className="aof-persona">Persona: {persona}</p>

          <section className="aof-diagram" aria-label="Onboarding architecture diagram">
            {ROWS.map((row, i) => (
              <DiagramRow
                key={row.id}
                row={row}
                activeKeys={activeKeys}
                visitedKeys={visitedKeys}
                isLast={i === ROWS.length - 1}
              />
            ))}
          </section>

          <div className="aof-legend" aria-label="Flow step legend">
            <span className="aof-legend-title">Legend</span>
            {LEGEND.map((l) => (
              <span key={l.num} className="aof-legend-entry">
                <span className={`aof-legend-badge aof-legend-badge--${l.num}`}>{l.num}</span>
                {l.label}
              </span>
            ))}
          </div>

          <StepControls
            stepIndex={stepIndex}
            total={steps.length}
            playing={playing}
            onPrev={onPrev}
            onNext={onNext}
            onPlayToggle={onPlayToggle}
            onReset={onReset}
          />

          <div className="aof-step-detail">
            <h4>
              {stepIndex + 1}. {step.title}
            </h4>
            <p>{step.narrative}</p>
          </div>

          {stepIndex === steps.length - 1 && (
            <div className="aof-outcome">
              <strong>Outcome:</strong> {outcome}
            </div>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
}
