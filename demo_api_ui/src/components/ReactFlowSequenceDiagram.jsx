/**
 * ReactFlowSequenceDiagram — SVG sequence-diagram view of the guided steps.
 *
 * Rendered from the same step data as the React Flow canvas, so the step
 * controls, scenario picker, and explanation panel drive both views.
 *
 *   - Participants as color-coded column headers (layer palette)
 *   - One row per step; arrows between consecutive nodes on the step's path
 *   - Active step highlighted, with an animated token dot traveling each
 *     active arrow (SVG animateMotion)
 */
import React, { useMemo } from "react";
import "./ReactFlowSequenceDiagram.css";

const PARTICIPANTS = [
  { id: "user", label: "User", color: "#7c3aed" },
  { id: "ui", label: "React UI", color: "#004687" },
  { id: "bff", label: "BFF", color: "#004687" },
  { id: "vault", label: "Vault", color: "#ca8a04" },
  { id: "pingone", label: "PingOne OIDC", color: "#7c3aed" },
  { id: "agent", label: "Agent", color: "#004687" },
  { id: "gateway", label: "MCP Gateway", color: "#0e7490" },
  { id: "authorize", label: "P1 Authorize", color: "#dc2626" },
  { id: "mcpserver", label: "MCP Server", color: "#0e7490" },
  { id: "resapi", label: "Booking API", color: "#15803d" },
  { id: "data", label: "Reservation Data", color: "#475569" },
];

const PARTICIPANT_INDEX = Object.fromEntries(
  PARTICIPANTS.map((p, i) => [p.id, i])
);

const COL_W = 150;
const HEADER_H = 56;
const ROW_H = 64;
const LABEL_H = 30;

const xs = (participantId) =>
  PARTICIPANT_INDEX[participantId] * COL_W + COL_W / 2;

function arrowGeometry(fromId, toId, y) {
  const x1 = xs(fromId);
  const x2 = xs(toId);
  const dir = x2 > x1 ? 1 : -1;
  const pad = 10;
  return {
    path: `M ${x1 + dir * pad} ${y} L ${x2 - dir * pad} ${y}`,
    head: `${x2 - dir * pad},${y}`,
    dir,
  };
}

export default function ReactFlowSequenceDiagram({
  steps,
  activeStepIndex,
  outcome,
}) {
  const activeOutcomeColors = {
    permit: "#16a34a",
    deny: "#dc2626",
    indeterminate: "#d97706",
    hitl: "#7c3aed",
  };

  const height =
    HEADER_H + LABEL_H + steps.length * ROW_H + 24;

  const lifelines = useMemo(
    () =>
      PARTICIPANTS.map((p) => (
        <line
          key={p.id}
          x1={xs(p.id)}
          y1={HEADER_H}
          x2={xs(p.id)}
          y2={height - 12}
          className="rfps-lifeline"
        />
      )),
    [height]
  );

  return (
    <div className="rfps-wrap" data-testid="rfps-diagram">
      <svg
        className="rfps-svg"
        width={PARTICIPANTS.length * COL_W}
        height={height}
        role="img"
        aria-label="Sequence diagram of the guided architecture steps"
      >
        {/* participant headers */}
        {PARTICIPANTS.map((p) => (
          <g key={p.id}>
            <rect
              x={xs(p.id) - COL_W / 2 + 8}
              y={8}
              width={COL_W - 16}
              height={40}
              rx={8}
              className="rfps-participant"
              style={{ borderColor: p.color }}
            />
            <text
              x={xs(p.id)}
              y={33}
              textAnchor="middle"
              className="rfps-participant__text"
            >
              {p.label}
            </text>
          </g>
        ))}

        {lifelines}

        {/* step rows */}
        {steps.map((step, i) => {
          const y = HEADER_H + LABEL_H + i * ROW_H + ROW_H / 2;
          const isActive = i === activeStepIndex;
          const isPast = i < activeStepIndex;
          const rowColor =
            isActive && step.outcome
              ? activeOutcomeColors[step.outcome]
              : isActive
                ? "#004687"
                : isPast
                  ? "#94a3b8"
                  : "#cbd5e1";
          const pairs = [];
          for (let k = 0; k + 1 < step.path.length; k += 1) {
            pairs.push([step.path[k], step.path[k + 1]]);
          }
          return (
            <g
              key={step.id}
              className={`rfps-row${isActive ? " rfps-row--active" : ""}`}
            >
              <rect
                x={0}
                y={y - ROW_H / 2}
                width={PARTICIPANTS.length * COL_W}
                height={ROW_H}
                className={
                  isActive ? "rfps-row-bg rfps-row-bg--active" : "rfps-row-bg"
                }
              />
              <text
                x={8}
                y={y - ROW_H / 2 + 14}
                className="rfps-step-label"
                style={{ fill: rowColor }}
              >
                {isActive ? `▶ Step ${step.id}: ${step.title}` : `Step ${step.id}: ${step.title}`}
              </text>
              {pairs.map(([from, to], k) => {
                const geo = arrowGeometry(from, to, y + 12);
                const animId = `rfps-anim-${step.id}-${k}`;
                return (
                  <g key={`${from}-${to}-${k}`}>
                    <path
                      d={geo.path}
                      className={`rfps-arrow${isActive ? " rfps-arrow--active" : ""}`}
                      style={{ stroke: rowColor }}
                      markerEnd={`url(#rfps-arrowhead-${isActive ? "on" : "off"})`}
                    />
                    {isActive && (
                      <circle r="5" className="rfps-token">
                        <animateMotion
                          dur="1.6s"
                          repeatCount="indefinite"
                          path={geo.path}
                        />
                      </circle>
                    )}
                    {k === 0 && (
                      <text
                        x={Math.min(xs(from), xs(to))}
                        y={y + 26}
                        textAnchor="middle"
                        className="rfps-arrow-label"
                        style={{ fill: rowColor }}
                      >
                        {step.stateLabels && step.stateLabels[to]
                          ? step.stateLabels[to]
                          : ""}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        <defs>
          <marker
            id="rfps-arrowhead-on"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="rfps-arrowhead rfps-arrowhead--on" />
          </marker>
          <marker
            id="rfps-arrowhead-off"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="rfps-arrowhead rfps-arrowhead--off" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
