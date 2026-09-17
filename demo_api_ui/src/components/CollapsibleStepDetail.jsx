import React, { useState } from "react";
import StepDetailPanel from "./StepDetailPanel";
import "./CollapsibleStepDetail.css";

export default function CollapsibleStepDetail({ step }) {
  const [expanded, setExpanded] = useState(true);
  const [fontSize, setFontSize] = useState("large");

  if (!step) return null;

  return (
    <div className="csd-container">
      <button
        className="csd-summary"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="csd-toggle-icon">{expanded ? "▼" : "▶"}</span>
        <span className="csd-label">{step.label || "Step Details"}</span>
        {step.status && <span className={`csd-status csd-status-${step.status}`}>{step.status}</span>}
      </button>
      {expanded && (
        <div className="csd-details">
          <div className="csd-font-control" role="group" aria-label="Step details font size">
            <span className="csd-font-label">Text size</span>
            {[['small', 'A−', 'Decrease step details font size'], ['medium', 'A', 'Default step details font size'], ['large', 'A+', 'Increase step details font size']].map(([size, label, ariaLabel]) => (
              <button key={size} type="button" aria-label={ariaLabel} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{label}</button>
            ))}
          </div>
          <StepDetailPanel step={step} fontSize={fontSize} />
        </div>
      )}
    </div>
  );
}
