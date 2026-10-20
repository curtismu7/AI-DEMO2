/**
 * UC16b — Raw user-token forwarding blocked (Zero Trust). An attack sim tries
 * to resolve an MCP tool token by forwarding Alice's raw user access token
 * straight to MCP — no RFC 8693 exchange, no act claim — and the BFF's
 * fail-closed custody guard blocks it with 403 user_token_forwarding_disabled
 * before any gateway or PingOne Authorize call is made. The proof of
 * enforcement is the absence of evidence: no authorize-decision exists because
 * nothing ever left the BFF.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["signs in once"], x: 40, y: 150, detail: "Signed in; her raw access token is the credential the agent tries to hand to MCP — the thing that must never leave the BFF." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["forwards raw AT"], x: 340, y: 150, detail: "Attempts the shortcut: resolve a tool token for get_my_accounts by presenting Alice's own token — no exchange, no act claim, no scope narrowing." },
  { id: "bff", group: "gateway", label: "BFF — token custody", sub: ["ff_skip_token_exchange", "fail-closed guard"], x: 640, y: 150, detail: "Sole custodian of browser tokens. The custody guard in agentMcpTokenService checks the flag before any gateway or Authorize call; the sim arms and restores it itself." },
  { id: "gw", group: "gateway", label: "Agent MCP gateway", sub: ["never reached"], x: 940, y: 150, detail: "Would validate and dispatch the tool call — but nothing arrives. The block fires at the BFF source, which is the demonstration point." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["never called"], x: 1240, y: 150, detail: "No RFC 8693 exchange, no Authorize evaluation — no authorize-decision evidence exists on this path, by design." },
];

const EDGES = [
  ["user", "agent", "raw token, no exchange", { dashed: true, detail: "The agent needs a tool token for get_my_accounts and tries the shortcut: hand MCP Alice's own access token as-is." }],
  ["agent", "bff", "fail-closed at the BFF", { detail: "The BFF is the sole custodian of browser tokens. The sim arms ff_skip_token_exchange, runs the production resolver, and the guard is checked before anything else." }],
  ["bff", "gw", "403 before any hop", { dashed: true, detail: "The BFF refuses to forward the raw token: 403 user_token_forwarding_disabled. Use RFC 8693 token exchange instead." }],
  ["gw", "p1", "gateway + Authorize silent", { detail: "No call ever arrives — and with no exchange, PingOne Authorize never evaluates anything. No authorize-decision evidence exists; the absence is the proof." }],
  ["p1", "user", "user token never leaves", { dashed: true, detail: "Only exchanged, agent-scoped tokens with an act claim ever leave the BFF. The user token never crossed a process boundary — to the agent runtime, the gateway, or the LLM context." }],
];

const walk = [
  {
    title: "The forwarding attempt", label: "raw token, no exchange",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "The agent needs a tool token for get_my_accounts and tries the shortcut: hand MCP Alice's own access token as-is." }],
    tech: [
      { t: "API", c: "POST /api/demo/attack-sim/run { sim: 'raw-user-token-forwarding' }" },
      { t: "TOKEN", c: "raw user AT: sub=alice, scp=accounts:read, act=absent" },
    ],
  },
  {
    title: "Custody guard armed", label: "fail-closed at the BFF",
    nodes: ["agent", "bff"], edges: [1],
    lines: [{ who: "BFF", text: "The BFF is the sole custodian of browser tokens. The sim arms ff_skip_token_exchange, runs the production resolver, and the guard is checked before anything else." }],
    tech: [
      { t: "POLICY", c: "ff_skip_token_exchange=true -> deny path (armed and restored in-memory by the sim, persist:false)" },
      { t: "API", c: "resolveMcpAccessTokenWithEvents(req, 'get_my_accounts') -> custody check first" },
    ],
  },
  {
    title: "Blocked at the source", label: "403 before any hop",
    nodes: ["bff", "gw"], edges: [2],
    lines: [{ who: "BFF", text: "The BFF refuses to forward the raw token: 403 user_token_forwarding_disabled. Use RFC 8693 token exchange instead." }],
    tech: [
      { t: "API", c: "403 { error: 'user_token_forwarding_disabled' } — no MCP request dispatched" },
      { t: "TOKEN", c: "exchange-skipped event: no agent token minted, RFC 8693 not run" },
    ],
  },
  {
    title: "Nothing downstream", label: "gateway + Authorize silent",
    nodes: ["gw", "p1"], edges: [3],
    lines: [{ who: "Gateway", text: "No call ever arrives — and with no exchange, PingOne Authorize never evaluates anything. No authorize-decision evidence exists; the absence is the proof." }],
    tech: [
      { t: "POLICY", c: "no gateway validation, no Authorize evaluation on this path" },
      { t: "TOKEN", c: "no act claim, no downscoped token — nothing to introspect" },
    ],
  },
  {
    title: "Verdict: custody enforced", label: "user token never leaves",
    nodes: ["p1", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Only exchanged, agent-scoped tokens with an act claim ever leave the BFF. The user token never crossed a process boundary — to the agent runtime, the gateway, or the LLM context." }],
    tech: [
      { t: "API", c: "verdict DENY_403 — sim returns user_token_forwarding_disabled" },
      { t: "POLICY", c: "protection point: BFF token custody (enforced at the source, not downstream)" },
    ],
  },
];

export default {
  id: "UC16b",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
