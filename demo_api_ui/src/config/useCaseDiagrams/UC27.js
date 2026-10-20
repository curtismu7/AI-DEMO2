/**
 * UC27 — HITL consent bypass attempt. The presenter asks for a $600 transfer;
 * no real approval receipt exists, so the call stops at the human-in-the-loop
 * gate. A raw consentGiven flag callers could once set to skip the checks was
 * removed — the BFF requires a verified, server-issued receipt tied to the
 * user, agent and tool. The flag is verified, not trusted.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, AUTHZ, MCP } from "../pingStyleStandards";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["$600 transfer"], x: 40, y: 150, detail: "Carries the request — and any claim that consent was already given. The claim changes nothing." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["receipt required"], x: 440, y: 150, detail: "Requires a real, verifiable receipt from the HITL service; a client-supplied consentGiven flag cannot satisfy it." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["HITL boundary"], x: 840, y: 150, detail: "$600 sits above the HITL boundary: without a verified receipt the answer is HITL_REQUIRED, not PERMIT." },
  { id: "user", group: "user", label: "Alice (user)", sub: ["must approve"], x: 1240, y: 150, detail: "The only path past the gate is a fresh challenge she actually approves — consent is forged by no one." },
];

const EDGES = [
  ["agent", "gw", "transfer $600", { detail: "A transfer above the HITL boundary — presented as if consent were already given." }],
  ["gw", "p1", "verify consent", { detail: "The BFF checks for a verified receipt bound to user, agent and tool — not a caller-set flag." }],
  ["p1", "gw", "HITL_REQUIRED", { dashed: true, detail: "No real receipt exists: the call stops and a fresh challenge is required." }],
  ["gw", "user", "consent challenge", { detail: "The transfer waits until Alice approves — nothing runs on a claim alone." }],
];

const walk = [
  {
    title: "Agent requests $600", label: "Claiming consent was given",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "The transfer goes out above the HITL boundary — however it frames the consent." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call create_transfer amount=600" }],
  },
  {
    title: "BFF demands a receipt", label: "Verified, not trusted",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The old raw consentGiven flag is gone: only a server-issued receipt tied to user, agent and tool counts." }],
    tech: [{ t: "TOKEN", c: "receipt check: HitlApproved requires verified HITL-service receipt (user+agent+tool bound); consentGiven flag removed" }],
  },
  {
    title: "HITL_REQUIRED", label: "No receipt, no run",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Nothing was approved, so nothing runs — the gate answers with an obligation, not a pass." }],
    tech: [{ t: "POLICY", c: "amount > HITL boundary, no verified receipt -> HITL_REQUIRED (tool dispatch withheld)" }],
  },
  {
    title: "Fresh challenge", label: "The only way through",
    nodes: ["gw", "user"], edges: [3],
    lines: [{ who: "Alice", text: "Any mismatch falls back to a new consent challenge — the human approves or the transfer never happens." }],
    tech: [{ t: "API", c: "BFF falls back to fresh HITL challenge on receipt mismatch; transfer waits for approval" }],
  },
];

const DELEGATED = {
  note: "MOCK decoded delegated token · valid, but it proves identity, not consent",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", act: { sub: "agent-0001" }, exp: 1790000000 },
};

// Per-step detail. Forms mirror the 428 envelope of services/mcpToolPipeline.js and POST /api/transactions/consent-challenge.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\",\n             \"arguments\": { \"amount\": 600, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\", \"consentGiven\": true } } }\n\nconsentGiven is the attacker's claim. It used to skip checks; it is no longer read.",
      tokens: [DELEGATED],
      refs: [RFC(6750, "Bearer token usage"), ...MCP.filter((r) => r.id === "MCP authorization 2025-11-25")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "BFF receipt check (services/mcpToolPipeline.js)\n\nrequired: a server-issued HITL receipt bound to { user, agent, tool }\nfound:    none (a client-set flag is not a receipt)\nresult:   HitlApproved = false\n\nPingOne Authorize is asked with amount=600 and HitlApproved=false.",
      tokens: [],
      refs: AUTHZ.filter((r) => r.id === "OpenID AuthZEN" || r.id === "RFC 8693"),
    },
  },
  {
    beats: [2],
    detail: {
      form: "HTTP/1.1 428\n\n{ \"error\": \"mcp_hitl_required\",\n  \"error_description\": \"This transaction requires human approval. Confirm it on the dashboard to continue.\",\n  \"hitl\": { \"type\": \"consent\" } }\n\n(on the gateway path the same obligation arrives as a JSON-RPC error; the tool is not dispatched)",
      tokens: [],
      refs: [RFC(6585, "Additional HTTP Status Codes (428 Precondition Required)")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /api/transactions/consent-challenge\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"type\": \"transfer\", \"amount\": 600, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\" }\n\n-> 201 { \"challengeId\": \"{challengeId}\", \"expiresAt\": \"<ISO time>\" }\n\nThe transfer waits until Alice approves this challenge; only then does a receipt exist.",
      tokens: [],
    },
  },
];

export default {
  id: "UC27",
  result: { label: "HITL REQUIRED", tone: "warn" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
