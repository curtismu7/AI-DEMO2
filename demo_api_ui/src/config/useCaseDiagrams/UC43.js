/**
 * UC43 — Consumer & Partner Agent — CIMD registration. The presenter opens the
 * Agent Builder page and registers a customer-facing agent: the BFF builds a
 * public-safe CIMD metadata document, resolves it through the local CIMD mock,
 * and the user-to-agent association appears in the NHI inventory. Mock
 * facade, real identity — governed execution is UC44's lane.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (customer)", sub: ["signs in", "Agent Builder"], x: 40, y: 150, detail: "Session-authenticated customer; her register click drives the flow, and ownership provenance starts with her session." },
  { id: "bff", group: "gateway", label: "Agent Builder BFF", sub: ["CIMD facade", "public-safe doc"], x: 340, y: 150, detail: "Builds the public-safe metadata document (client_id IS its URL, per CIMD §4), publishes it unauthenticated, and resolves it through the local CIMD mock (oauthClientRegistry.registerClientByUrl)." },
  { id: "mock", group: "external", label: "CIMD mock AS", sub: ["stand-in for the AS", "engine: 'mock'"], x: 640, y: 150, detail: "Demo stand-in for the authorization server that would resolve CIMD — PingOne does not support it natively (draft-ietf-oauth-client-id-metadata-document); every step here is badged engine:'mock'." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["Management API", "AI_AGENT app"], x: 940, y: 150, detail: "The real half: POST /applications provisions a first-class AI Agent application ('AI Agent - <user>') — the identity UC44's token exchange acts under later." },
  { id: "nhi", group: "resource", label: "NHI inventory", sub: ["agent registry", "lifecycle"], x: 1240, y: 150, detail: "GET /api/agent-registry reads its sources live — the PingOne agent row carries CIMD provenance (registrationType 'cimd-facade', metadataUrl) beside its scope-drift status." },
];

const EDGES = [
  ["user", "bff", "signed-in click", { detail: "Any signed-in customer registers from the Agent Builder page — ownership provenance starts with her session, not a shared service account." }],
  ["bff", "mock", "engine: 'mock'", { detail: "The BFF builds a public-safe metadata document, publishes it unauthenticated (an AS must be able to fetch it), and resolves it through the local CIMD mock — labeled, never passed off as PingOne." }],
  ["mock", "p1", "AI_AGENT app", { detail: "Mock provenance, real identity: the facade-registered client is anchored to a first-class AI Agent application the BFF provisioned via the Management API." }],
  ["p1", "nhi", "live read, not a copy", { detail: "The registry reads every source live, so the agent row carries its CIMD provenance and scope-drift status without ever going stale." }],
  ["nhi", "user", "no token chain", { detail: "The user-to-agent association shows with lifecycle evidence; governed execution of this identity is UC44's lane — this one is registration only." }],
];

const walk = [
  {
    title: "Alice registers her agent", label: "signed-in click",
    nodes: ["user", "bff"], edges: [0],
    lines: [{ who: "Alice", text: "Any signed-in customer registers from the Agent Builder page — ownership provenance starts with her session, not a shared service account." }],
    tech: [
      { t: "API", c: "POST /api/agent-builder/agent  (requireSession)" },
      { t: "POLICY", c: "one agent per user — an existing agent is returned, never duplicated" },
    ],
  },
  {
    title: "The labeled CIMD facade", label: "engine: 'mock'",
    nodes: ["bff", "mock"], edges: [1],
    lines: [{ who: "BFF", text: "The BFF builds a public-safe metadata document, publishes it unauthenticated (an AS must be able to fetch it), and resolves it through the local CIMD mock — labeled, never passed off as PingOne." }],
    tech: [
      { t: "TOKEN", c: "client_id = metadata URL · grant_types=['client_credentials'] · scope='agent:invoke airlines:read airlines:write' · auth=client_secret_basic" },
      { t: "API", c: "GET /api/cimd/personal-agents/:registrationId/client-metadata.json — public, no auth; stores no PingOne secret, no user token" },
    ],
  },
  {
    title: "Real identity behind the mock", label: "AI_AGENT app",
    nodes: ["mock", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "Mock provenance, real identity: the facade-registered client is anchored to a first-class AI Agent application the BFF provisioned via the Management API." }],
    tech: [
      { t: "API", c: "POST /applications  {type:'AI_AGENT', protocol:'OPENID_CONNECT', name:'AI Agent - <user>'}" },
      { t: "POLICY", c: "joiner lifecycle event → compliance tag NHI-Provisioning" },
    ],
  },
  {
    title: "Provenance lands in the registry", label: "live read, not a copy",
    nodes: ["p1", "nhi"], edges: [3],
    lines: [{ who: "NHI inventory", text: "The registry reads every source live, so the agent row carries its CIMD provenance and scope-drift status without ever going stale." }],
    tech: [
      { t: "API", c: "GET /api/agent-registry → registrationType='cimd-facade', metadataUrl, registrationStatus" },
      { t: "POLICY", c: "expected scopes (scope-topology.json) vs granted → scopeStatus match/drift" },
    ],
  },
  {
    title: "Association visible, registration done", label: "no token chain",
    nodes: ["nhi", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The user-to-agent association shows with lifecycle evidence; governed execution of this identity is UC44's lane — this one is registration only." }],
    tech: [
      { t: "API", c: "GET /api/agent-builder/state → agent.cimd.{status:'registered', metadataUrl}" },
      { t: "POLICY", c: "lifecycle trail: joiner (NHI-Provisioning) → leaver on delete (TRiSM, AI-Safety)" },
    ],
  },
];

export default {
  id: "UC43",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
