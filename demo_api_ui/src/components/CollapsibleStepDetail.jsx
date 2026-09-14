import React, { useState } from "react";
import StepDetailPanel from "./StepDetailPanel";
import "./CollapsibleStepDetail.css";

export default function CollapsibleStepDetail({ step }) {
  const [expanded, setExpanded] = useState(true);

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
          <StepDetailPanel step={step} />
        </div>
      )}
    </div>
  );
}
