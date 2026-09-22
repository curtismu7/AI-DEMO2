/**
 * ReactFlowPocComparePage — /architecture/poc-compare
 *
 * Flow and Sequence tabs over the live architecture demo. The explanation
 * panel lives inside ReactFlowPocPage and narrates the executing flow for
 * both views; this page adds the tab chrome and theme toggle.
 */
import React, { useState } from "react";
import ReactFlowPocPage from "./ReactFlowPocPage";
import useDiagramTheme from "./useDiagramTheme";
import "./ReactFlowPocComparePage.css";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ReactFlowPocComparePage() {
  const [tab, setTab] = useState("flow");
  const { dark, toggle: toggleTheme } = useDiagramTheme();
  const rfExtra = (
    <div className="rfpc-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "flow"}
        className={tab === "flow" ? "rfpc-tab rfpc-tab--on" : "rfpc-tab"}
        onClick={() => setTab("flow")}
      >
        Flow
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "sequence"}
        className={tab === "sequence" ? "rfpc-tab rfpc-tab--on" : "rfpc-tab"}
        onClick={() => setTab("sequence")}
      >
        Sequence
      </button>
      <button
        type="button"
        className="rfp-theme-btn"
        onClick={toggleTheme}
        data-testid="rfpc-theme-toggle"
      >
        {dark ? "☀️ Light" : "🌙 Dark"}
      </button>
    </div>
  );

  return (
    <div className={`rfpc-page${dark ? " rfp-dark rfpc-dark" : ""}`} data-testid="rfpc-page">
      <div className="rfpc-header">
        <h2>Architecture diagram POC</h2>
        <p>
          The complete architecture as an interactive flow diagram or a guided
          sequence diagram — both driven by the same steps, scenarios, and
          controls. Press Simulate and read the narration panel as the flow
          executes.
        </p>
      </div>
      {rfExtra}
      <ReactFlowPocPage key={tab} initialView={tab} />
    </div>
  );
}
