// Live lifeline sequence diagram for the dashboard — the Quick Config
// "Sequence view" toggle swaps this in for the movie reel
// (ReelDock/TokenChainFilmstrip). Same data source as the reel
// (tokenChainTraceStore), same derivation helpers (buildTraceSteps via
// getState()) — this only adds a lifeline renderer on top, via
// deriveLifelineSteps. Rendering technique (participant boxes, dashed
// lifelines, arrows with markers) follows SequenceDiagramPage's proven SVG
// approach — including its zoom pattern, reused as-is since this diagram
// renders full-width/stacked (Focus Mode) rather than in a resizable side
// column, so a scale control is the right "make it bigger" affordance, not
// a width-divider drag. Only lanes touched by the current trace so far are
// shown, not a fixed 10-actor cast.
//
// Clicking a step calls onSelectStep(step) so the parent (dashboard) can
// render StepDetailPanel — the same narrative/RFC/request-response/JSON-Form
// detail the reel already shows for this exact step shape — in its own
// full-width row below the diagram.
//
// Color identity: 11 lanes is past a safe categorical hue count, so lanes
// are grouped into 5 validated hue families (see SequenceReelDiagram.css) —
// each lane keeps its own shade, but a family reads as one color group.
// Status (active/done/error) is a SEPARATE encoding layered on top (motion,
// dash, weight) — it never overrides the lane's hue, or "each step is a
// different color" would collapse back into "each status is a color".
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { deriveLifelineSteps, deriveLifelineParticipants } from "../services/tokenChainTrace/deriveLifelineSteps";
import "./SequenceReelDiagram.css";

const COL_WIDTH = 130;
const COL_MARGIN = 70;
const ROW_HEIGHT = 56;
const TOP_PAD = 60;
const BOTTOM_PAD = 30;

const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 130;

// Narration pace for slow mode — deliberately slow, this is for talking over
// a live crowd, not for watching the data arrive.
const SLOW_REVEAL_MS = 2600;
const SLOW_SPEED_OPTIONS = [
  { value: 1000, label: "1s (fast)" },
  { value: 1500, label: "1.5s" },
  { value: 2600, label: "2.6s (default)" },
  { value: 4000, label: "4s" },
  { value: 6000, label: "6s (slow)" },
];

function laneClass(lane) {
  return `srd-lane-${String(lane || "").toLowerCase()}`;
}

export default function SequenceReelDiagram({ onSelectStep, selectedStepId, slowMode, onToggleSlowMode }) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const [zoomLevel, setZoomLevel] = useState(ZOOM_DEFAULT);
  const handleZoom = useCallback(
    (delta) => setZoomLevel((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + delta))),
    [],
  );
  const resetZoom = useCallback(() => setZoomLevel(ZOOM_DEFAULT), []);

  const [slowRevealMs, setSlowRevealMs] = useState(SLOW_REVEAL_MS);

  const allLifelineSteps = useMemo(() => deriveLifelineSteps(snap.steps), [snap.steps]);

  // Slow mode: reveal one step at a time on a timer instead of the full set
  // arriving instantly. Real steps keep arriving at full speed underneath —
  // this only paces what's drawn.
  const [revealedCount, setRevealedCount] = useState(allLifelineSteps.length);
  useEffect(() => {
    if (!slowMode) {
      setRevealedCount(allLifelineSteps.length);
      return;
    }
    setRevealedCount((prev) => (prev > allLifelineSteps.length ? 0 : prev));
  }, [slowMode, allLifelineSteps.length]);
  useEffect(() => {
    if (!slowMode || revealedCount >= allLifelineSteps.length) return;
    const timer = setTimeout(() => setRevealedCount((prev) => prev + 1), slowRevealMs);
    return () => clearTimeout(timer);
  }, [slowMode, revealedCount, allLifelineSteps.length, slowRevealMs]);

  const lifelineSteps = slowMode ? allLifelineSteps.slice(0, revealedCount) : allLifelineSteps;
  const participants = useMemo(() => deriveLifelineParticipants(lifelineSteps), [lifelineSteps]);

  const stepsById = useMemo(() => {
    const map = new Map();
    for (const step of snap.steps || []) map.set(step.id, step);
    return map;
  }, [snap.steps]);

  const selectStep = useCallback(
    (id) => {
      if (typeof onSelectStep !== "function") return;
      const fullStep = stepsById.get(id);
      if (fullStep) onSelectStep(fullStep);
    },
    [onSelectStep, stepsById],
  );

  // Keep the currently-executing step in view as the diagram grows — the
  // whole point of a live narration surface is that the audience never has
  // to hunt for where things are. Falls back to the newest step when
  // nothing is explicitly "active" (e.g. the run just finished).
  const activeStepRef = useRef(null);
  const activeStepId = useMemo(() => {
    const active = [...lifelineSteps].reverse().find((s) => s.status === "active");
    return active ? active.id : lifelineSteps[lifelineSteps.length - 1]?.id;
  }, [lifelineSteps]);
  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeStepId]);

  if (!lifelineSteps.length) {
    return (
      <div className="srd-empty">
        Run an agent request to populate the sequence diagram.
      </div>
    );
  }

  const colX = (lane) => COL_MARGIN + participants.indexOf(lane) * COL_WIDTH;
  const width = COL_MARGIN * 2 + Math.max(participants.length - 1, 0) * COL_WIDTH;
  const height = TOP_PAD + lifelineSteps.length * ROW_HEIGHT + BOTTOM_PAD;

  return (
    <div className="srd-root">
      <div className="srd-toolbar">
        <button type="button" className="srd-zoom-btn" onClick={() => handleZoom(-ZOOM_STEP)} title="Zoom out">
          −
        </button>
        <button type="button" className="srd-zoom-reset" onClick={resetZoom} title="Reset zoom">
          {zoomLevel}%
        </button>
        <button type="button" className="srd-zoom-btn" onClick={() => handleZoom(ZOOM_STEP)} title="Zoom in">
          +
        </button>
        {onToggleSlowMode && (
          <button
            type="button"
            className={`srd-slow-btn ${slowMode ? "srd-slow-btn--active" : ""}`}
            onClick={onToggleSlowMode}
            title={slowMode ? "Turn off slow mode" : "Turn on slow mode for narration"}
          >
            Slow
          </button>
        )}
        {slowMode && (
          <>
            <select
              className="srd-speed-select"
              value={slowRevealMs}
              onChange={(e) => setSlowRevealMs(Number(e.target.value))}
              title="Adjust pace of step revelation"
            >
              {SLOW_SPEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="srd-slow-badge" title="Steps are revealing slowly for narration">
              Slow mode — {Math.min(revealedCount, allLifelineSteps.length)}/{allLifelineSteps.length}
            </span>
          </>
        )}
      </div>
      <div className="srd-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="srd-svg"
          style={{ width: `${(width * zoomLevel) / 100}px` }}
          role="img"
          aria-label="Live sequence diagram of this session's token chain"
        >
          {participants.map((lane) => {
            const x = colX(lane);
            return (
              <g key={lane}>
                <rect x={x - 68} y="8" width="136" height="34" rx="5" className="srd-actor-box" />
                <text x={x} y="31" textAnchor="middle" className="srd-actor-label">
                  {lane}
                </text>
                <line x1={x} y1="42" x2={x} y2={height - BOTTOM_PAD + 10} className="srd-lifeline" />
              </g>
            );
          })}
          {lifelineSteps.map((step, idx) => {
            const y = TOP_PAD + idx * ROW_HEIGHT;
            const statusClass = `srd-status-${step.status || "pending"}`;
            const isSelected = step.id === selectedStepId;
            const isActive = step.status === "active";
            const stepLaneClass = laneClass(step.type === "note" ? step.lane : step.to);
            const groupClass = `${statusClass} ${stepLaneClass}${isSelected ? " srd-selected" : ""}`;
            const setStepRef = (el) => {
              if (step.id === activeStepId) activeStepRef.current = el;
            };
            if (step.type === "note") {
              const x = colX(step.lane);
              return (
                <g
                  key={step.id}
                  ref={setStepRef}
                  className={groupClass}
                  onClick={() => selectStep(step.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectStep(step.id)}
                >
                  <rect x={x - 75} y={y - 14} width="150" height="28" rx="5" className="srd-note-box" />
                  <text x={x} y={y + 5} textAnchor="middle" className="srd-note-label">
                    {step.label}
                  </text>
                  {isActive && <circle cx={x} cy={y} r="6" className="srd-active-pulse" />}
                </g>
              );
            }
            const fromX = colX(step.from);
            const toX = colX(step.to);
            return (
              <g
                key={step.id}
                ref={setStepRef}
                className={groupClass}
                onClick={() => selectStep(step.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectStep(step.id)}
              >
                <line
                  x1={fromX}
                  y1={y}
                  x2={toX}
                  y2={y}
                  className="srd-arrow"
                  markerEnd={`url(#srd-arrowhead-${String(step.to || "").toLowerCase()})`}
                />
                <text x={(fromX + toX) / 2} y={y - 5} textAnchor="middle" className="srd-arrow-label">
                  {step.label}
                </text>
                {isActive && (
                  <circle r="4" className="srd-active-dot">
                    <animateMotion path={`M ${fromX},${y} L ${toX},${y}`} dur="1.4s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })}
          <defs>
            {["browser", "chat", "agent", "llm", "mcp", "gateway", "pingone", "authz", "bff", "api", "data"].map((lane) => (
              <marker
                key={lane}
                id={`srd-arrowhead-${lane}`}
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,7 L8,3.5 z" className={`srd-arrowhead-fill srd-lane-${lane}`} />
              </marker>
            ))}
          </defs>
        </svg>
      </div>
    </div>
  );
}
