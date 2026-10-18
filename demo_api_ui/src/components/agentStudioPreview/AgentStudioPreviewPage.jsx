// AgentStudioPreviewPage.jsx — "Agent Studio (Preview)", spec page 1 of 5
// (docs/superpowers/specs/2026-07-13-agent-studio-preview-design.md). Three
// persona tabs: Enterprise User and Developer walk their FLOWS wizards (same
// step data as the diagram page) and register a governed agent into the
// shared mock store on finish; Admin reviews the agents Discovery surfaced
// and approves them into governance. The other four preview pages read the
// same store, which is what makes the preview feel like one pipeline.
import React, { useState, useEffect, useCallback } from "react";
import { FLOWS } from "../../data/agentOnboardingFlows";
import { agentStudioMockStore } from "../../data/agentStudioMockStore";
import PreviewBanner from "./PreviewBanner";
import WizardStepper from "./WizardStepper";
import "./agentStudioPreview.css";
import PageHeader from '../common/PageHeader';

const PERSONAS = [
  { id: "enterpriseUser", label: "Enterprise AI User" },
  { id: "developer", label: "Developer" },
  { id: "admin", label: "Admin" },
];

export default function AgentStudioPreviewPage() {
  const [persona, setPersona] = useState("enterpriseUser");
  const [snap, setSnap] = useState(() => agentStudioMockStore.getState());
  useEffect(() => agentStudioMockStore.subscribe(setSnap), []);

  const registerFromFlow = useCallback((flowId) => {
    const flow = FLOWS[flowId];
    agentStudioMockStore.registerAgent({
      name: flowId === "enterpriseUser"
        ? "personal-ai-assistant (managed)"
        : "enterprise-built-agent",
      persona: flow.persona,
      mcpCount: flowId === "enterpriseUser" ? 3 : 2,
    });
  }, []);

  const pending = snap.agents.filter((a) => a.status === "pending");
  const activeFlow = FLOWS[persona];

  return (
    <div className="asp-root asp-root--studio">
      <div className="asp-page">
        <PreviewBanner />
        <PageHeader eyebrow="Agent Studio · Preview" title="Agent Studio" summary={<>The 1-year-target onboarding experience: users and developers walk
            a guided flow; admins review what Discovery surfaced.</>} />

        <div className="asp-tabs" role="tablist" aria-label="Persona">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={persona === p.id}
              className={`asp-tab${persona === p.id ? " active" : ""}`}
              onClick={() => setPersona(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {persona === "admin" ? (
          <div className="asp-rowlist" role="tabpanel" aria-label="Admin review">
            <p className="asp-adminhint">
              Agents surfaced by Discovery land here pending review. Approving
              brings them into governance — they then appear in IGA for AI.
            </p>
            {pending.length === 0 && (
              <div className="asp-rowcard">
                <span className="empty">
                  Nothing pending — walk a Discovery story to surface an
                  unmanaged agent.
                </span>
              </div>
            )}
            {pending.map((a) => (
              <div className="asp-rowcard" key={a.id}>
                <span className="t">{a.name}</span>
                <span className="s">
                  {a.source}
                  {a.detectedAt ? ` · detected ${a.detectedAt}` : ""}
                </span>
                <span className="asp-badge asp-badge--pending">pending</span>
                <button
                  type="button"
                  className="asp-btn asp-btn--primary"
                  onClick={() => agentStudioMockStore.approveAgent(a.id)}
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div role="tabpanel" aria-label={activeFlow.label}>
            <WizardStepper
              key={persona}
              steps={activeFlow.steps}
              outcome={activeFlow.outcome}
              onComplete={() => registerFromFlow(persona)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
