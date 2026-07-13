// IgaForAiPage.jsx — "IGA for AI (Preview)": single inventory of every
// agent, however it was onboarded (Agent Studio or Discovery), with
// lifecycle status and a certify action. Reads the shared mock store —
// a state view, not a step sequence, so it uses the calmer row-table
// treatment rather than the WizardStepper.
import React, { useState, useEffect } from "react";
import { agentStudioMockStore } from "../../data/agentStudioMockStore";
import PreviewBanner from "./PreviewBanner";
import "./agentStudioPreview.css";

export default function IgaForAiPage() {
  const [snap, setSnap] = useState(() => agentStudioMockStore.getState());

  useEffect(() => agentStudioMockStore.subscribe(setSnap), []);

  const agents = snap.agents;
  const governed = agents.filter((a) => a.status === "governed" || a.status === "certified");
  const pending = agents.filter((a) => a.status === "pending");
  const fromDiscovery = agents.filter((a) => a.source !== "Agent Studio");

  return (
    <div className="asp-root">
      <div className="asp-page asp-page--wide">
        <PreviewBanner />
        <div className="asp-hero">
          <span className="asp-eyebrow">Agent Studio · Preview</span>
          <h1>IGA for AI</h1>
          <p>One inventory for every agent and MCP — however it was onboarded.</p>
        </div>

        <div className="asp-stats">
          <div className="asp-stat">
            <div className="n">{agents.length}</div>
            <div className="l">Total agents</div>
          </div>
          <div className="asp-stat">
            <div className="n">{governed.length}</div>
            <div className="l">Governed</div>
          </div>
          <div className="asp-stat">
            <div className="n">{pending.length}</div>
            <div className="l">Pending review</div>
          </div>
          <div className="asp-stat">
            <div className="n">{fromDiscovery.length}</div>
            <div className="l">From discovery</div>
          </div>
        </div>

        <div className="asp-rowlist">
          {agents.length === 0 && (
            <div className="asp-rowcard">
              <span className="empty">
                No agents yet — complete a flow in Agent Studio or approve a discovery.
              </span>
            </div>
          )}
          {agents.map((a) => (
            <div className="asp-rowcard" key={a.id}>
              <span className="t">{a.name}</span>
              <span className="s">
                {a.source} · owner: {a.owner}
                {a.lastCertified ? ` · certified ${a.lastCertified}` : ""}
              </span>
              <span className={`asp-badge asp-badge--${a.status}`}>{a.status}</span>
              {a.status === "governed" && (
                <button
                  type="button"
                  className="asp-btn"
                  onClick={() => agentStudioMockStore.certifyAgent(a.id)}
                >
                  Certify
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
