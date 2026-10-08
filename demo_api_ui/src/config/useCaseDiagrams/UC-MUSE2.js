/**
 * UC-MUSE2 — External agent, AI Gateway lane. The same agent connects to the
 * facade's privilege-gateway door: OAuth against the durable demo broker
 * doubles as the sign-in that establishes the BFF's server-side leg to the
 * PingOne Privilege AI Gateway (ownsUpstreamAuth swaps the bearer on the
 * upstream hop). Per-user policy is enforced by the AI Gateway.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["signs in once"], x: 40, y: 150, detail: "Her OAuth sign-in is what establishes the gateway leg — one login, both sides." },
  { id: "agent", group: "external", label: "Muse agent", sub: ["user's machine"], x: 340, y: 150, detail: "Same agent, different door: the facade's privilege-gateway MCP endpoint." },
  { id: "facade", group: "gateway", label: "MCP facade", sub: ["durable broker"], x: 640, y: 150, detail: "Registers the client durably and holds the upstream gateway leg server-side — client config survives gateway restarts." },
  { id: "aigw", group: "pingone", label: "AI Gateway", sub: ["Privilege"], x: 940, y: 150, detail: "PingOne Privilege AI Gateway: per-user policy on the upstream call; the caller's bearer is replaced." },
  { id: "tool", group: "resource", label: "Registered app", sub: ["Agentic App"], x: 1240, y: 150, detail: "The app registered in Privilege (e.g. banking MCP server) serves the tools." },
];

const EDGES = [
  ["user", "agent", "same ask, lane 2", { detail: "Same natural-language request; the presenter points the agent at the other door." }],
  ["agent", "facade", "OAuth + connect", { detail: "DCR against the demo broker; the sign-in also establishes the gateway leg." }],
  ["facade", "aigw", "call with own credential", { detail: "ownsUpstreamAuth: the caller's bearer is swapped for the operator's gateway token." }],
  ["aigw", "tool", "per-user policy", { detail: "Privilege evaluates the human's policy, not a service identity, then dispatches." }],
  ["tool", "user", "answer", { detail: "Result returns through the facade to Muse." }],
];

const walk = [
  {
    title: "Same agent, other door", label: "Lane 2",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Same request — what changes is which Ping product stands in front." }],
    tech: [{ t: "API", c: "Muse -> POST /mcp-facade/privilege-gateway/mcp tools/call" }],
  },
  {
    title: "Durable onboarding", label: "broker + gateway leg",
    nodes: ["agent", "facade"], edges: [1],
    lines: [{ who: "Facade", text: "The client registers with our broker — restart-proof — and the sign-in raises the upstream leg." }],
    tech: [
      { t: "API", c: "POST /oauth/register -> durable client_id (survives gateway restart)" },
      { t: "POLICY", c: "sign-in establishes privilegeGatewaySession (server-side)" },
    ],
  },
  {
    title: "Credential swap", label: "ownsUpstreamAuth",
    nodes: ["facade", "aigw"], edges: [2],
    lines: [{ who: "Facade", text: "Anonymous traffic never rides the operator's session — the bearer is replaced on the way up." }],
    tech: [{ t: "TOKEN", c: "caller bearer -> operator gateway token (upstream hop only)" }],
  },
  {
    title: "Per-user policy", label: "Privilege decides",
    nodes: ["aigw", "tool"], edges: [3],
    lines: [{ who: "AI Gateway", text: "Policy evaluates the human who signed in — identity travels, not just a service credential." }],
    tech: [{ t: "POLICY", c: "Privilege per-user policy -> dispatch to registered Agentic App" }],
  },
  {
    title: "Answer", label: "back to Muse",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Two doors, one story: whichever Ping gateway you run, the external agent is governed." }],
    tech: [{ t: "API", c: "facade -> Muse (tool result)" }],
  },
];

export default {
  id: "UC-MUSE2",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
