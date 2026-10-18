// AgentOnboardingMermaidPage.jsx — the same onboarding architecture as
// AgentOnboardingFlowDiagram.jsx (box+arrow diagram, kept unchanged), rendered
// as an interactive React Flow graph via the shared StaticFlowDiagram
// component. Click any node for its role in the onboarding story.
import React, { useState } from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import "./AgentOnboardingMermaidPage.css";
import PageHeader from './common/PageHeader';

export const AOM_GROUPS = {
  entry: { label: "Entry / Discovery", bg: "#4f8a3d" },
  studio: { label: "Agent Studio", bg: "#5b8cff" },
  identity: { label: "Identity & Metadata", bg: "#c8860a" },
  gov: { label: "Governance & Enforcement", bg: "#e8ae3d" },
  disc: { label: "Privilege / Cloud Discovery", bg: "#d9730d" },
  iga: { label: "IGA for AI", bg: "#a83289" },
  rt: { label: "Enterprise Runtime", bg: "#0891b2" },
};

export const AOM_NODES = [
  {
    id: "A1", group: "entry", label: "1. Enterprise Users (AI Consumers)",
    sub: ["Claude Desktop · Cursor", "VS Code (Copilot) · ChatGPT Enterprise", "Adds/configures MCPs in AI client", "Opens Agent Studio to register"],
    x: 0, y: 40,
  },
  {
    id: "A2", group: "entry", label: "2. Developers / Agent Builders",
    sub: ["Foundry · AWS · Vertex · Others", "Build agent on any platform", "Register agent, MCPs, tools, resources", "Publish to PingOne Agent Gateway (auto)"],
    x: 0, y: 230,
  },
  {
    id: "A3", group: "entry", label: "3. Cloud Discovery (Admin)",
    sub: ["Foundry · AWS · Vertex · Others", "Agents discovered in cloud", "Admin notified", "Admin reviews & imports"],
    x: 0, y: 420,
  },
  {
    id: "AS", group: "studio", label: "Agent Studio",
    sub: ["Enterprise AI Onboarding Portal", "Users: discover + register MCPs", "Devs: register agents/MCPs, publish FGA", "Admins: import discovered, review & submit"],
    x: 320, y: 40,
  },
  {
    id: "IDM", group: "identity", label: "Identity & Metadata (Ping Identity Platform)",
    sub: ["PingOne · PingFederate · AIC", "Create identity & metadata for Agents and MCPs", "Agent Identity, MCP Identity", "Tools, Resources, Prompts Metadata"],
    x: 320, y: 330,
  },
  {
    id: "ORCH", group: "studio", label: "Orchestrates onboarding across the Ping platform",
    sub: ["① Create identity & metadata", "② Publish MCP to PingOne Agent Gateway", "③ Publish FGA rules to PingAuthorize", "④ Register in IGA for AI", "⑤ Keep metadata synchronized"],
    x: 640, y: 40,
  },
  {
    id: "PG", group: "gov", label: "P1 Privilege Agent Gateway",
    sub: ["Policy enforcement", "JIT access & secret injection", "Session & activity logging", "Audit all actor activity"],
    x: 960, y: 40,
  },
  {
    id: "PGW", group: "gov", label: "PingOne Agent Gateway — MCP Security Gateway",
    sub: ["Secures all MCP comms", "Validates OAuth tokens", "Token exchange / transform", "Routes authz to PingAuthorize"],
    x: 960, y: 230,
  },
  {
    id: "PA", group: "gov", label: "PingAuthorize / PingOne Authorize",
    sub: ["Fine-grained authz decisions", "Policies for tools/resources/APIs", "Context-aware, real-time"],
    x: 960, y: 430,
  },
  {
    id: "PD", group: "disc", label: "A. Privilege Discovery",
    sub: ["Browser / Device Agents", "Gateway detects unmanaged AI", "Admin notified, reviews, approves", "Metadata synced to IGA"],
    x: 0, y: 660,
  },
  {
    id: "CD", group: "disc", label: "B. Cloud Discovery (IGA)",
    sub: ["IGA discovers cloud-native agents", "Admin reviews & approves", "Identity created, synced to IGA"],
    x: 0, y: 850,
  },
  {
    id: "IGA", group: "iga", label: "IGA for AI",
    sub: ["Intelligent Governance & Administration", "Inventory · Ownership/Lifecycle · Entitlements", "Certification · Compliance & Audit", "Single source of truth for all AI agents/MCPs"],
    x: 320, y: 660,
  },
  {
    id: "RT", group: "rt", label: "Enterprise AI Runtime",
    sub: ["Applications · Databases · APIs", "Files & Storage · SaaS · Enterprise Systems", "All traffic validated, authorized, governed"],
    x: 640, y: 660,
  },
];

export const AOM_EDGES = [
  ["A1", "AS"], ["A2", "AS"], ["A3", "AS"],
  ["AS", "ORCH"], ["IDM", "ORCH"],
  ["ORCH", "PG"], ["ORCH", "PGW"], ["ORCH", "PA"],
  ["PGW", "PA", null, { dashed: true }],
  ["PD", "PG", "direct route"],
  ["CD", "IGA"], ["PG", "IGA"], ["PGW", "IGA"], ["PA", "IGA"],
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
  const [selectedNode, setSelectedNode] = useState(null);

  const nodeDetail = selectedNode
    ? AOM_DETAILS[selectedNode.id] ||
      `${selectedNode.data.label} — participant in the onboarding architecture.`
    : null;

  return (
    <div className="aom-page">
      <div className="aom-hero">
        <PageHeader eyebrow="Proposed architecture — T. Madiraju" title="Enterprise AI Onboarding — Architecture" summary={<>Same architecture and detail as the box+arrow diagram, now an
          interactive React Flow graph — zoom, pan, and click any node for its
          role in the onboarding story.</>} />
      </div>

      <div className="aom-panel">
        <StaticFlowDiagram
          NODES={AOM_NODES}
          EDGES={AOM_EDGES}
          GROUPS={AOM_GROUPS}
          details={AOM_DETAILS}
          onNodeClick={(node) => setSelectedNode(selectedNode?.id === node.id ? null : node)}
          testId="aom-flow-diagram"
          height={640}
        />
      </div>

      {nodeDetail && (
        <div className="aom-node-detail" role="status">
          <strong>{selectedNode.data.label}</strong>
          <p>{nodeDetail}</p>
        </div>
      )}

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
