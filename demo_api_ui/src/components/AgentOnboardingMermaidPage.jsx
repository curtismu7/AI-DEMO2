// AgentOnboardingMermaidPage.jsx — the same onboarding architecture as
// AgentOnboardingFlowDiagram.jsx (box+arrow diagram, kept unchanged), rendered
// as an interactive React Flow graph via the shared StaticFlowDiagram
// component, in the Ping style (pingStyle): routed numbered arrows, Simulate / Reset / speed, and a click on a box
// for its role in the onboarding story. The Flow and Subway variants reuse the nodes, edges and groups below.
import React from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { AUTHZ, MCP } from "../config/pingStyleStandards";
import { noTokenDetail, diagramStep } from "../config/pingStyleDetail";
import "./AgentOnboardingMermaidPage.css";
import PageHeader from './common/PageHeader';

export const AOM_GROUPS = {
  entry: { label: "People and enterprise systems", bg: "#151a24" },
  ping: { label: "Ping product (Agent Studio, Identity, Gateway, Authorize, IGA)", bg: "#b5231a" },
  disc: { label: "Discovery of unmanaged AI", bg: "#5a5f69" },
};

export const AOM_NODES = [
  {
    id: "A1", group: "entry", label: "1. Enterprise Users (AI Consumers)",
    sub: ["Claude Desktop · Cursor", "VS Code (Copilot) · ChatGPT Enterprise", "Adds/configures MCPs in AI client", "Opens Agent Studio to register"],
    x: 0, y: 0,
  },
  {
    id: "A2", group: "entry", label: "2. Developers / Agent Builders",
    sub: ["Foundry · AWS · Vertex · Others", "Build agent on any platform", "Register agent, MCPs, tools, resources", "Publish to PingOne Agent Gateway (auto)"],
    x: 0, y: 250,
  },
  {
    id: "A3", group: "entry", label: "3. Cloud Discovery (Admin)",
    sub: ["Foundry · AWS · Vertex · Others", "Agents discovered in cloud", "Admin notified", "Admin reviews & imports"],
    x: 0, y: 500,
  },
  {
    id: "AS", group: "ping", label: "Agent Studio",
    sub: ["Enterprise AI Onboarding Portal", "Users: discover + register MCPs", "Devs: register agents/MCPs, publish FGA", "Admins: import discovered, review & submit"],
    x: 440, y: 250,
  },
  {
    id: "IDM", group: "ping", label: "Identity & Metadata (Ping Identity Platform)",
    sub: ["PingOne · PingFederate · AIC", "Create identity & metadata for Agents and MCPs", "Agent Identity, MCP Identity", "Tools, Resources, Prompts Metadata"],
    x: 440, y: 520,
  },
  {
    id: "ORCH", group: "ping", label: "Orchestrates onboarding across the Ping platform",
    sub: ["① Create identity & metadata", "② Publish MCP to PingOne Agent Gateway", "③ Publish FGA rules to PingAuthorize", "④ Register in IGA for AI", "⑤ Keep metadata synchronized"],
    x: 880, y: 250,
  },
  {
    id: "PG", group: "ping", label: "P1 Privilege Agent Gateway",
    sub: ["Policy enforcement", "JIT access & secret injection", "Session & activity logging", "Audit all actor activity"],
    x: 1320, y: 0,
  },
  {
    id: "PGW", group: "ping", label: "PingOne Agent Gateway — MCP Security Gateway",
    sub: ["Secures all MCP comms", "Validates OAuth tokens", "Token exchange / transform", "Routes authz to PingAuthorize"],
    x: 1320, y: 250,
  },
  {
    id: "PA", group: "ping", label: "PingAuthorize / PingOne Authorize",
    sub: ["Fine-grained authz decisions", "Policies for tools/resources/APIs", "Context-aware, real-time"],
    x: 1320, y: 500,
  },
  {
    id: "PD", group: "disc", label: "A. Privilege Discovery",
    sub: ["Browser / Device Agents", "Gateway detects unmanaged AI", "Admin notified, reviews, approves", "Metadata synced to IGA"],
    x: 880, y: 0,
  },
  {
    id: "CD", group: "disc", label: "B. Cloud Discovery (IGA)",
    sub: ["IGA discovers cloud-native agents", "Admin reviews & approves", "Identity created, synced to IGA"],
    x: 1760, y: 0,
  },
  {
    id: "IGA", group: "ping", label: "IGA for AI",
    sub: ["Intelligent Governance & Administration", "Inventory · Ownership/Lifecycle · Entitlements", "Certification · Compliance & Audit", "Single source of truth for all AI agents/MCPs"],
    x: 1760, y: 250,
  },
  {
    id: "RT", group: "entry", label: "Enterprise AI Runtime",
    sub: ["Applications · Databases · APIs", "Files & Storage · SaaS · Enterprise Systems", "All traffic validated, authorized, governed"],
    x: 2200, y: 250,
  },
];

export const AOM_EDGES = [
  ["A1", "AS"], ["A2", "AS"], ["A3", "AS"],
  ["AS", "ORCH"], ["IDM", "ORCH"],
  ["ORCH", "PG"], ["ORCH", "PGW"], ["ORCH", "PA"],
  ["PGW", "PA", null, { dashed: true, vertical: true }],
  ["PD", "PG", "direct route"],
  ["CD", "IGA", null, { vertical: true }], ["PG", "IGA"], ["PGW", "IGA"], ["PA", "IGA"],
  ["IGA", "RT"],
];

export const AOM_DETAILS = {
  A1: "Enterprise users add and configure MCPs inside their AI clients, then open Agent Studio to register.",
  A2: "Developers build agents on any platform and register agents, MCPs, tools, and resources — publishing to the PingOne Agent Gateway automatically.",
  A3: "Agents running in cloud platforms are discovered; admins are notified and review before importing.",
  AS: "The onboarding portal where users discover and register MCPs, developers register agents and publish FGA, and admins import discovered agents.",
  IDM: "The Ping Identity platform creates identity and metadata for agents and MCPs — identities, tools, resources, prompts, ownership, and attributes.",
  ORCH: "Coordinates onboarding across the Ping platform: identity & metadata, MCP publishing, FGA rules, IGA registration, and metadata sync.",
  PG: "P1 Privilege Agent Gateway — policy enforcement, JIT access & secret injection, session logging, and full actor audit.",
  PGW: "The MCP security gateway — secures all MCP comms, validates OAuth tokens, performs token exchange/transform, and routes authz to PingAuthorize.",
  PA: "Fine-grained, context-aware authorization decisions for tools, resources, and APIs in real time.",
  PD: "Privilege detects unmanaged AI usage from browser/device agents; admins review and approve, and metadata syncs to IGA.",
  CD: "IGA discovers cloud-native agents; admins review and approve, and identities are created and synced.",
  IGA: "The single source of truth for all AI agents/MCPs — inventory, ownership/lifecycle, entitlements, certification, compliance, and audit.",
  RT: "Where enterprise systems live. All agent traffic here is validated, authorized, and governed.",
};

const HERE = "Target-state design, not built in this demo: no wire format or token is defined for this hop.";
const none = (form, refs = []) => noTokenDetail(form, HERE, refs);

export const AOM_STEPS = [
  diagramStep("users-studio", [0], "Users register MCPs in Agent Studio", "Enterprise users add MCPs in their AI client, then open Agent Studio to select and register them.", null, none("Proposed: user opens Agent Studio and registers a discovered MCP.")),
  diagramStep("devs-studio", [1], "Developers register agents and MCPs", "Developers build on any platform, then register the agent, its MCPs, tools and resources in Agent Studio.", null, none("Proposed: developer registers an agent and publishes its MCPs.")),
  diagramStep("admin-studio", [2], "Admins import discovered agents", "Agents found in cloud platforms are reviewed by an admin and imported into Agent Studio.", null, none("Proposed: admin reviews and imports a cloud-discovered agent.")),
  diagramStep("studio-orch", [3], "Agent Studio starts the orchestration", "A registration triggers the onboarding orchestration across the Ping platform.", null, none("Proposed: registration event -> orchestration.")),
  diagramStep("idm-orch", [4], "Identity and metadata feed the orchestration", "The Ping identity platform creates the agent and MCP identities and their tool, resource and prompt metadata.", null, none("Proposed: create identity and metadata for the agent and its MCPs.")),
  diagramStep("orch-pg", [5], "Orchestration configures the Privilege gateway", "Policy enforcement, JIT access and secret injection are set up for the new agent.", null, none("Proposed: publish enforcement settings to the Privilege Agent Gateway.")),
  diagramStep("orch-pgw", [6], "Orchestration publishes the MCP to the Agent Gateway", "The MCP is published to the PingOne Agent Gateway automatically.", "The gateway then secures every MCP call to it.", none("Proposed: publish the MCP server to PingOne Agent Gateway.", [MCP[0], MCP[1]])),
  diagramStep("orch-pa", [7], "Orchestration publishes FGA rules", "Fine-grained authorization rules for the tools and resources go to PingAuthorize.", null, none("Proposed: publish FGA rules to PingAuthorize / PingOne Authorize.", [AUTHZ[0]])),
  diagramStep("pgw-pa", [8], "The gateway asks PingAuthorize", "The MCP gateway routes each authorization decision to PingAuthorize.", null, none("Proposed: gateway sends the tool-call context to the decision point.", [AUTHZ[0]])),
  diagramStep("pd-pg", [9], "Browser and device discovery reach the Privilege gateway", "The gateway detects unmanaged AI use; the admin is notified and approves.", null, none("Proposed: discovery signal from browser and device agents.")),
  diagramStep("cd-iga", [10], "Cloud discovery feeds IGA", "IGA discovers cloud-native agents; the admin approves and an identity is created.", null, none("Proposed: IGA cloud discovery import.")),
  diagramStep("pg-iga", [11], "The Privilege gateway reports to IGA", "Session and activity data keep the IGA inventory current.", null, none("Proposed: sync agent metadata and activity to IGA.")),
  diagramStep("pgw-iga", [12], "The Agent Gateway reports to IGA", "Published MCPs and their usage are registered in IGA.", null, none("Proposed: sync MCP registrations to IGA.")),
  diagramStep("pa-iga", [13], "PingAuthorize reports to IGA", "Decisions and policies are recorded for certification and audit.", null, none("Proposed: sync policy and decision metadata to IGA.")),
  diagramStep("iga-rt", [14], "IGA governs the enterprise runtime", "Governed agents reach applications, data and APIs with all traffic validated and authorized.", null, none("Proposed: governed access to the enterprise runtime.")),
];

export default function AgentOnboardingMermaidPage() {
  return (
    <div className="aom-page aom-page--ping">
      <div className="aom-hero">
        <PageHeader eyebrow="Proposed architecture — T. Madiraju" title="Enterprise AI Onboarding — Architecture" summary={<>Same architecture and detail as the box+arrow diagram, now an
          interactive React Flow graph — drag boxes, press Simulate to walk the arrows, and click any
          box for its role in the onboarding story.</>} />
      </div>

      <div className="aom-panel">
        <StaticFlowDiagram
          NODES={AOM_NODES}
          EDGES={AOM_EDGES}
          GROUPS={AOM_GROUPS}
          details={AOM_DETAILS}
          steps={AOM_STEPS}
          pingStyle
          testId="aom-flow-diagram"
          ariaLabel="Enterprise AI onboarding architecture diagram"
        />
      </div>

      <div className="aom-legend">
        {Object.entries(AOM_GROUPS).map(([key, g]) => (
          <span key={key} className="aom-legend-entry">
            <i className="aom-swatch" style={{ background: g.bg }} />
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}
