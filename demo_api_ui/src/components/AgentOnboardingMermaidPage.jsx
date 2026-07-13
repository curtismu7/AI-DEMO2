// AgentOnboardingMermaidPage.jsx — the same onboarding architecture as
// AgentOnboardingFlowDiagram.jsx (box+arrow diagram, kept unchanged), redrawn
// as a real Mermaid.js flowchart: auto-laid-out boxes with directional
// arrows instead of hand-positioned CSS. A third, additive view — not a
// replacement. Follows the mermaid.initialize/render pattern already used in
// Phase266ArchitecturePage.jsx.
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import "./AgentOnboardingMermaidPage.css";

const ICON = (name, alt) =>
  `<img src="/images/vendor-logos/${name}.svg" alt="${alt}" width="16" height="16" style="vertical-align:-3px;margin-right:3px"/>`;

const MERMAID_SOURCE = `flowchart TD
    subgraph ENTRY[" "]
        direction LR
        A1["<b>1. Enterprise Users</b><br/><i>(AI Consumers)</i><br/>${ICON("claude", "Claude")}Claude Desktop &nbsp; ${ICON("cursor", "Cursor")}Cursor<br/>${ICON("vscode", "VS Code")}VS Code (Copilot) &nbsp; ${ICON("openai", "ChatGPT")}ChatGPT Enterprise<br/>&bull; Adds/configures MCPs in AI client<br/>&bull; Opens Agent Studio to register"]
        A2["<b>2. Developers /<br/>Agent Builders</b><br/>${ICON("azure", "Foundry")}Foundry &nbsp; ${ICON("aws", "AWS")}AWS<br/>${ICON("googlecloud", "Vertex")}Vertex &nbsp; Other Platforms<br/>&bull; Build agent on any platform<br/>&bull; Register agent, MCPs, tools, resources<br/>&bull; Publish to PingGateway (auto)"]
        A3["<b>3. Cloud Discovery</b><br/><i>(Admin)</i><br/>${ICON("azure", "Foundry")}Foundry &nbsp; ${ICON("aws", "AWS")}AWS<br/>${ICON("googlecloud", "Vertex")}Vertex &nbsp; Other Platforms<br/>&bull; Agents discovered in cloud<br/>&bull; Admin notified<br/>&bull; Admin reviews &amp; imports"]
    end

    AS["<b>Agent Studio</b><br/><i>Enterprise AI Onboarding Portal</i><br/>Users: discover + register MCPs<br/>Devs: register agents/MCPs, publish FGA<br/>Admins: import discovered, review &amp; submit"]

    IDM["<b>Identity &amp; Metadata</b><br/><i>(Ping Identity Platform)</i><br/>PingOne &middot; PingFederate &middot; AIC<br/>Create identity &amp; metadata for Agents and MCPs<br/>&bull; Agent Identity, MCP Identity<br/>&bull; Tools, Resources, Prompts Metadata<br/>&bull; Ownership &amp; Attributes"]

    ORCH["<b>Orchestrates onboarding across the Ping platform</b><br/>&#9312; Create identity &amp; metadata<br/>&#9313; Publish MCP to PingGateway<br/>&#9314; Publish FGA rules to PingAuthorize<br/>&#9315; Register in IGA for AI<br/>&#9316; Keep metadata synchronized"]

    subgraph GOV[" "]
        direction LR
        PG["<b>P1 Privileges<br/>MCP Gateway</b><br/>&bull; Policy enforcement<br/>&bull; JIT access &amp; secret injection<br/>&bull; Session &amp; activity logging<br/>&bull; Audit all actor activity"]
        PGW["<b>PingGateway<br/>MCP Security Gateway</b><br/>&bull; Secures all MCP comms<br/>&bull; Validates OAuth tokens<br/>&bull; Token exchange / transform<br/>&bull; Routes authz to PingAuthorize"]
        PA["<b>PingAuthorize /<br/>PingOne Authorize</b><br/>&bull; Fine-grained authz decisions<br/>&bull; Policies for tools/resources/APIs<br/>&bull; Context-aware, real-time"]
    end

    subgraph DISC[" "]
        direction LR
        PD["<b>A. Privilege Discovery</b><br/><i>Browser / Device Agents</i><br/>&bull; Gateway detects unmanaged AI<br/>&bull; Admin notified, reviews, approves<br/>&bull; Metadata synced to IGA"]
        CD["<b>B. Cloud Discovery</b><br/><i>(IGA)</i><br/>&bull; IGA discovers cloud-native agents<br/>&bull; Admin reviews &amp; approves<br/>&bull; Identity created, synced to IGA"]
    end

    IGA["<b>IGA for AI</b><br/><i>Intelligent Governance &amp; Administration</i><br/>Inventory &middot; Ownership/Lifecycle &middot; Entitlements<br/>Certification &middot; Compliance &amp; Audit<br/>Single source of truth for all AI agents/MCPs"]

    RT["<b>Enterprise AI Runtime</b><br/>Applications &middot; Databases &middot; APIs<br/>Files &amp; Storage &middot; SaaS &middot; Enterprise Systems<br/>All traffic validated, authorized, governed"]

    A1 --> AS
    A2 --> AS
    A3 --> AS
    AS --> ORCH
    IDM --> ORCH
    ORCH --> PG
    ORCH --> PGW
    ORCH --> PA
    PGW <--> PA
    PD -->|"direct route"| PG
    CD --> IGA
    PG --> IGA
    PGW --> IGA
    PA --> IGA
    IGA --> RT

    classDef entry fill:#1b2a1f,stroke:#4f8a3d,color:#e9ecf3,text-align:left;
    classDef studio fill:#1b1f3a,stroke:#5b8cff,color:#e9ecf3,text-align:left;
    classDef identity fill:#3d2b06,stroke:#c8860a,color:#e9ecf3,text-align:left;
    classDef gov fill:#241a06,stroke:#e8ae3d,color:#e9ecf3,text-align:left;
    classDef disc fill:#2c1811,stroke:#d9730d,color:#e9ecf3,text-align:left;
    classDef iga fill:#241533,stroke:#a83289,color:#e9ecf3,text-align:left;
    classDef rt fill:#062024,stroke:#0891b2,color:#e9ecf3,text-align:left;
    class A1,A2,A3 entry;
    class AS,ORCH studio;
    class IDM identity;
    class PG,PGW,PA gov;
    class PD,CD disc;
    class IGA iga;
    class RT rt;`;

const LEGEND = [
  { color: "#4f8a3d", label: "Entry / Discovery (Users, Devs, Admin)" },
  { color: "#5b8cff", label: "Agent Studio / Orchestration" },
  { color: "#c8860a", label: "Identity & Metadata (Ping Identity Platform)" },
  { color: "#e8ae3d", label: "Governance & Enforcement" },
  { color: "#d9730d", label: "Privilege / Cloud Discovery" },
  { color: "#a83289", label: "IGA for AI" },
  { color: "#0891b2", label: "Enterprise Runtime" },
];

export default function AgentOnboardingMermaidPage() {
  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis" },
    });

    async function render() {
      try {
        const { svg } = await mermaid.render("agent-onboarding-mermaid-svg", MERMAID_SOURCE);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="aom-page">
      <div className="aom-hero">
        <span className="aom-eyebrow">Proposed architecture — T. Madiraju</span>
        <h1>Enterprise AI Onboarding — Mermaid Flowchart</h1>
        <p className="aom-sub">
          Same architecture and detail as the box+arrow diagram, rendered with Mermaid's
          auto-layout engine — real directional arrows between nodes.
        </p>
      </div>

      <div className="aom-panel">
        {renderError ? (
          <p className="aom-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div className="aom-diagram" ref={containerRef} aria-label="Onboarding architecture Mermaid flowchart" />
        )}
      </div>

      <div className="aom-legend">
        {LEGEND.map((l) => (
          <span key={l.label} className="aom-legend-entry">
            <span className="aom-swatch" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
