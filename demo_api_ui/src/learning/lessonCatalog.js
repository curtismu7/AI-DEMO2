import { PROVENANCE } from "./provenance";

const CLOUD_FIRST_PROVENANCE = Object.freeze({
  primary: PROVENANCE.LIVE_CLOUD,
  fallback: [
    PROVENANCE.LIVE_LOCAL,
    PROVENANCE.RECORDED,
    PROVENANCE.SIMULATED,
  ],
});

const lesson = (details) => ({
  ...details,
  provenance: CLOUD_FIRST_PROVENANCE,
});

const REDACTED_RESULT = Object.freeze({
  kind: "redacted",
  valuesRedacted: true,
  fields: ["status", "decision", "correlationId"],
});

export const lessonCatalog = Object.freeze([
  lesson({
    id: "login",
    title: "PingOne login and identity",
    audience: "Sales engineers and customer architects",
    category: "OAuth and identity",
    route: "/oauth-academy",
    standaloneRoute: "/oauth-academy",
    run: { action: "login", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["authorization", "code-exchange", "session"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.RECORDED, label: "Recorded login trace" },
    talkingPoints: [
      "PingOne authenticates the person while the BFF keeps browser tokens server-side.",
    ],
  }),
  lesson({
    id: "delegation",
    title: "Delegated agent access",
    audience: "Sales engineers and IAM teams",
    category: "OAuth and delegation",
    route: "/token-exchange-tester",
    standaloneRoute: "/token-exchange-tester",
    run: { action: "token-exchange", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["subject-token", "actor-token", "delegated-token"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.RECORDED, label: "Recorded token-chain trace" },
    talkingPoints: [
      "RFC 8693 lets an agent act with narrowly scoped authority on behalf of a user.",
    ],
  }),
  lesson({
    id: "mcp",
    title: "MCP discovery and tool calls",
    audience: "Sales engineers and developers",
    category: "MCP and gateways",
    route: "/mcp-discovery",
    standaloneRoute: "/pingone-mcp-inspector",
    run: { action: "mcp-discovery", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["initialize", "tools-list", "tools-call"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Simulated MCP exchange" },
    talkingPoints: [
      "MCP gives the agent a structured way to discover and invoke tools behind an enforced boundary.",
    ],
  }),
  lesson({
    id: "authorize",
    title: "PingOne Authorize policy decision",
    audience: "Sales engineers and security architects",
    category: "Authorization",
    route: "/agent-gateway-authorization",
    standaloneRoute: "/agent-gateway-inspector",
    run: { action: "authorize-decision", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["policy-input", "policy-decision", "gateway-enforcement"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Simulated policy decision" },
    talkingPoints: [
      "PingOne Authorize evaluates context at runtime so the gateway can permit or deny the tool call.",
    ],
  }),
  lesson({
    id: "hitl-step-up",
    title: "Human approval and step-up",
    audience: "Sales engineers and risk teams",
    category: "Authorization and safety",
    route: "/use-cases/live",
    standaloneRoute: "/use-cases/live",
    run: { action: "hitl-step-up", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["challenge", "approval", "step-up", "resumed-call"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.RECORDED, label: "Recorded approval trace" },
    talkingPoints: [
      "High-impact actions pause for explicit user approval and stronger authentication before they continue.",
    ],
  }),
  lesson({
    id: "lifecycle",
    title: "Agent lifecycle and revocation",
    audience: "Sales engineers and governance teams",
    category: "Agent governance",
    route: "/agent-lifecycle",
    standaloneRoute: "/agent-registry",
    run: { action: "agent-lifecycle", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["registration", "invocation", "revocation", "denied-retry"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.RECORDED, label: "Recorded lifecycle trace" },
    talkingPoints: [
      "Agents have an identity and lifecycle that can be constrained, revoked, and audited independently.",
    ],
  }),
  lesson({
    id: "ai-architecture",
    title: "AI agent architecture",
    audience: "Sales engineers and technical decision-makers",
    category: "AI concepts",
    route: "/ai-products/core",
    standaloneRoute: "/ai-products/core",
    run: { action: "ai-architecture", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["intent", "agent-routing", "tool-selection"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.RECORDED, label: "Recorded agent trace" },
    talkingPoints: [
      "The model chooses useful actions, while Ping controls the identity and authority of every action.",
    ],
  }),
  lesson({
    id: "threat-defense",
    title: "AI threat defense",
    audience: "Sales engineers and security teams",
    category: "AI safety",
    route: "/use-cases/live",
    standaloneRoute: "/use-cases/live",
    run: { action: "threat-defense", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["malicious-input", "detection", "policy-deny"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Simulated attack trace" },
    talkingPoints: [
      "Prompt injection and scope escalation are treated as authorization problems with observable enforcement points.",
    ],
  }),
  lesson({
    id: "product-map",
    title: "Ping products in the AI security architecture",
    audience: "Sales engineers and customer stakeholders",
    category: "Ping products",
    route: "/ai-products/core",
    standaloneRoute: "/ai-products/gateway",
    run: { action: "product-map", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["product-boundaries", "request-path"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Architecture walkthrough" },
    talkingPoints: [
      "Each Ping product contributes at a distinct point in the identity, authorization, orchestration, or governance path.",
    ],
  }),
]);

export function getLesson(id) {
  return lessonCatalog.find((entry) => entry.id === id) || null;
}
