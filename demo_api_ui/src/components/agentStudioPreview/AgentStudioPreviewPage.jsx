// AgentStudioPreviewPage.jsx — "Agent Studio (Preview)": simulated unified
// onboarding portal for all 3 personas from Tarun Madiraju's diagram.
// Enterprise User / Developer tabs walk the exact numbered steps from
// FLOWS.enterpriseUser / FLOWS.developer (agentOnboardingFlows.js); Admin
// tab reviews agents surfaced by the Discovery Preview page via the shared
// mock store.
import React, { useState, useEffect, useCallback } from "react";
import { FLOWS } from "../../data/agentOnboardingFlows";
import { agentStudioMockStore } from "../../data/agentStudioMockStore";
import PreviewBanner from "./PreviewBanner";
import WizardStepper from "./WizardStepper";
import "./agentStudioPreview.css";

const TABS = [
  { id: "user", label: "I'm an Enterprise AI User" },
  { id: "dev", label: "I'm a Developer" },
  { id: "admin", label: "I'm an Admin" },
];

export default function AgentStudioPreviewPage() {
  const [tab, setTab] = useState("user");
  const [snap, setSnap] = useState(() => agentStudioMockStore.getState());

  useEffect(() => agentStudioMockStore.subscribe(setSnap), []);

  const onUserComplete = useCallback(() => {
    agentStudioMockStore.registerAgent({
      name: "demouser — Claude Desktop",
      persona: "Enterprise User",
      mcpCount: 3,
    });
  }, []);

  const onDevComplete = useCallback(() => {
    agentStudioMockStore.registerAgent({
      name: "claims-triage-agent (AWS Bedrock)",
      persona: "Developer",
      mcpCount: 5,
    });
  }, []);

  const pending = snap.agents.filter((a) => a.status === "pending");
  const registered = snap.agents.filter((a) => a.status !== "pending");

  return (
    <div className="asp-root">
      <div className="asp-page">
        <PreviewBanner />
        <div className="asp-hero">
          <span className="asp-eyebrow">Agent Studio · Preview</span>
          <h1>Welcome to Agent Studio</h1>
          <p>
            Every step below comes straight from Tarun Madiraju's onboarding
            flow diagram — walk through it as your persona.
          </p>
        </div>

        <div className="asp-tabs" role="tablist" aria-label="Persona">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`asp-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "user" && (
          <WizardStepper
            steps={FLOWS.enterpriseUser.steps}
            outcome={FLOWS.enterpriseUser.outcome}
            onComplete={onUserComplete}
          />
        )}

        {tab === "dev" && (
          <WizardStepper
            steps={FLOWS.developer.steps}
            outcome={FLOWS.developer.outcome}
            onComplete={onDevComplete}
          />
        )}

        {tab === "admin" && (
          <>
            <div className="asp-subhdr">Waiting on your review</div>
            <div className="asp-rowlist">
              {pending.length === 0 && (
                <div className="asp-rowcard">
                  <span className="empty">
                    Nothing pending — approve a discovery on the Discovery page to see it here.
                  </span>
                </div>
              )}
              {pending.map((a) => (
                <div className="asp-rowcard" key={a.id}>
                  <span className="t">{a.name}</span>
                  <span className="s">
                    {a.source} · detected {a.detectedAt}
                  </span>
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

            <div className="asp-subhdr">Registered this session</div>
            <div className="asp-rowlist">
              {registered.length === 0 && (
                <div className="asp-rowcard">
                  <span className="empty">
                    Complete a flow above (or approve a discovery) to register an agent.
                  </span>
                </div>
              )}
              {registered.map((a) => (
                <div className="asp-rowcard" key={a.id}>
                  <span className="t">{a.name}</span>
                  <span className="s">
                    {a.persona} · {a.source}
                  </span>
                  <span className={`asp-badge asp-badge--${a.status}`}>{a.status}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
