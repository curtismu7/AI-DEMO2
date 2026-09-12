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
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { deriveLifelineSteps, deriveLifelineParticipants } from "../services/tokenChainTrace/deriveLifelineSteps";
import "./SequenceReelDiagram.css";

const COL_WIDTH = 130;
const COL_MARGIN = 70;
const ROW_HEIGHT = 30;
const TOP_PAD = 60;
const BOTTOM_PAD = 30;

const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 130;

export default function SequenceReelDiagram({ onSelectStep, selectedStepId }) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const [zoomLevel, setZoomLevel] = useState(ZOOM_DEFAULT);
  const handleZoom = useCallback(
    (delta) => setZoomLevel((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + delta))),
    [],
  );
  const resetZoom = useCallback(() => setZoomLevel(ZOOM_DEFAULT), []);

  const lifelineSteps = useMemo(() => deriveLifelineSteps(snap.steps), [snap.steps]);
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
                <rect x={x - 52} y="12" width="104" height="26" rx="5" className="srd-actor-box" />
                <text x={x} y="30" textAnchor="middle" className="srd-actor-label">
                  {lane}
                </text>
                <line x1={x} y1="38" x2={x} y2={height - BOTTOM_PAD + 10} className="srd-lifeline" />
              </g>
            );
          })}
          {lifelineSteps.map((step, idx) => {
            const y = TOP_PAD + idx * ROW_HEIGHT;
            const statusClass = `srd-status-${step.status || "pending"}`;
            const isSelected = step.id === selectedStepId;
            const groupClass = `${statusClass}${isSelected ? " srd-selected" : ""}`;
            if (step.type === "note") {
              const x = colX(step.lane);
              return (
                <g
                  key={step.id}
                  className={groupClass}
                  onClick={() => selectStep(step.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectStep(step.id)}
                >
                  <rect x={x - 58} y={y - 12} width="116" height="22" rx="5" className="srd-note-box" />
                  <text x={x} y={y + 4} textAnchor="middle" className="srd-note-label">
                    {step.label}
                  </text>
                </g>
              );
            }
            const fromX = colX(step.from);
            const toX = colX(step.to);
            return (
              <g
                key={step.id}
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
                  markerEnd="url(#srd-arrowhead)"
                />
                <text x={(fromX + toX) / 2} y={y - 5} textAnchor="middle" className="srd-arrow-label">
                  {step.label}
                </text>
              </g>
            );
          })}
          <defs>
            <marker
              id="srd-arrowhead"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,7 L8,3.5 z" className="srd-arrowhead-fill" />
            </marker>
          </defs>
        </svg>
      </div>
    </div>
  );
}
