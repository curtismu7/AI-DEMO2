// Live lifeline sequence diagram for the dashboard's right column — the
// Quick Config "Sequence view" toggle swaps this in for the movie reel
// (ReelDock/TokenChainFilmstrip). Same data source as the reel
// (tokenChainTraceStore), same derivation helpers (buildTraceSteps via
// getState()) — this only adds a lifeline renderer on top, via
// deriveLifelineSteps. Rendering technique (participant boxes, dashed
// lifelines, arrows with markers) follows SequenceDiagramPage's proven SVG
// approach, scaled down for a narrow column and only showing lanes touched
// by the current trace so far, rather than a fixed 10-actor cast.
import React, { useState, useEffect, useMemo } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { deriveLifelineSteps, deriveLifelineParticipants } from "../services/tokenChainTrace/deriveLifelineSteps";
import "./SequenceReelDiagram.css";

const COL_WIDTH = 90;
const COL_MARGIN = 50;
const ROW_HEIGHT = 22;
const TOP_PAD = 50;
const BOTTOM_PAD = 30;

export default function SequenceReelDiagram() {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const lifelineSteps = useMemo(() => deriveLifelineSteps(snap.steps), [snap.steps]);
  const participants = useMemo(() => deriveLifelineParticipants(lifelineSteps), [lifelineSteps]);

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
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="srd-svg"
        role="img"
        aria-label="Live sequence diagram of this session's token chain"
      >
        {participants.map((lane) => {
          const x = colX(lane);
          return (
            <g key={lane}>
              <rect x={x - 38} y="8" width="76" height="20" rx="4" className="srd-actor-box" />
              <text x={x} y="22" textAnchor="middle" className="srd-actor-label">
                {lane}
              </text>
              <line x1={x} y1="28" x2={x} y2={height - BOTTOM_PAD + 10} className="srd-lifeline" />
            </g>
          );
        })}
        {lifelineSteps.map((step, idx) => {
          const y = TOP_PAD + idx * ROW_HEIGHT;
          const statusClass = `srd-status-${step.status || "pending"}`;
          if (step.type === "note") {
            const x = colX(step.lane);
            return (
              <g key={step.id} className={statusClass}>
                <rect x={x - 44} y={y - 10} width="88" height="18" rx="4" className="srd-note-box" />
                <text x={x} y={y + 3} textAnchor="middle" className="srd-note-label">
                  {step.label}
                </text>
              </g>
            );
          }
          const fromX = colX(step.from);
          const toX = colX(step.to);
          return (
            <g key={step.id} className={statusClass}>
              <line
                x1={fromX}
                y1={y}
                x2={toX}
                y2={y}
                className="srd-arrow"
                markerEnd="url(#srd-arrowhead)"
              />
              <text x={(fromX + toX) / 2} y={y - 4} textAnchor="middle" className="srd-arrow-label">
                {step.label}
              </text>
            </g>
          );
        })}
        <defs>
          <marker
            id="srd-arrowhead"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L7,3 z" className="srd-arrowhead-fill" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
