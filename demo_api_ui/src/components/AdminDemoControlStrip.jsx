// AdminDemoControlStrip — page-level home for the agent controls that drive
// the /admin demo. The floating agent header carried ~10 controls that only
// matter while presenting THIS page (Demo steps, Routing/Wiring, agent scope,
// Flow Detail, Guide, Graph); on the admin route the agent hides them (see
// pageOwnsAgentChrome in AIAgent.js) and this strip renders them instead.
// Everywhere else the agent header is unchanged.
//
// Ownership of state stays where it was:
//  - Agent mode / Routing / Wiring: AgentModeSelector is the shared SSOT
//    (useLangchainProvider broadcasts across instances). Routing's
//    heuristic-fallback boolean is AIAgent-local, so changes here reach it
//    via the agent-heuristic-fallback-changed event. One-way is enough: the
//    agent's own copy of the control is hidden on this page.
//  - Agent scope: same pattern, agent-scope-write-changed.
//  - Demo steps: DemoStepsDropdown self-fetches by vertical; a selection is
//    handed to the agent via agent-demo-step-select (the agent opens itself
//    and runs the step exactly as if its own dropdown fired).
//  - Flow Detail / Guide: window events; the agent opens the same modals.
//  - Graph: plain navigation to /telemetry.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AgentModeSelector from "./AgentModeSelector";
import DemoStepsDropdown from "./DemoStepsDropdown";
import ScopePicker from "./ScopePicker";
import "./AdminDemoControlStrip.css";

export default function AdminDemoControlStrip() {
  const navigate = useNavigate();
  const [stepsOpen, setStepsOpen] = useState(false);
  // Mirrors the agent's defaults (agentAllowWrite=true, heuristicEnabled=true).
  // The agent's own controls are hidden on this page, so this strip is the only
  // writer and the mirrors cannot be raced.
  const [allowWrite, setAllowWrite] = useState(true);
  const [heuristicFallback, setHeuristicFallback] = useState(true);

  return (
    <div className="adcs" role="toolbar" aria-label="Demo controls">
      <DemoStepsDropdown
        vertical="pingone-admin"
        open={stepsOpen}
        onOpenChange={setStepsOpen}
        onSelect={(uc, stepNumber, opts) => {
          setStepsOpen(false);
          window.dispatchEvent(
            new CustomEvent("agent-demo-step-select", {
              detail: { uc, stepNumber, opts },
            }),
          );
        }}
      />
      <AgentModeSelector
        compact
        heuristicFallback={heuristicFallback}
        onHeuristicFallbackChange={(enabled) => {
          setHeuristicFallback(enabled);
          window.dispatchEvent(
            new CustomEvent("agent-heuristic-fallback-changed", {
              detail: { enabled },
            }),
          );
        }}
      />
      <ScopePicker
        allowWrite={allowWrite}
        onChange={(next) => {
          setAllowWrite(next);
          window.dispatchEvent(
            new CustomEvent("agent-scope-write-changed", {
              detail: { allowWrite: next },
            }),
          );
        }}
      />
      <button
        type="button"
        className="app-page-toolbar-btn"
        title="View token exchange and authorization decisions (RFC 8693)"
        onClick={() => window.dispatchEvent(new CustomEvent("agent-flow-detail-open"))}
      >
        Flow Detail
      </button>
      <button
        type="button"
        className="app-page-toolbar-btn"
        title="Open Agent Demo Guide"
        onClick={() => window.dispatchEvent(new CustomEvent("agent-demo-guide-open"))}
      >
        Guide
      </button>
      <button
        type="button"
        className="app-page-toolbar-btn"
        title="View system graph"
        onClick={() => navigate("/telemetry")}
      >
        Graph
      </button>
    </div>
  );
}
