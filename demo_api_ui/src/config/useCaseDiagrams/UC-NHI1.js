/**
 * UC-NHI1 — Live agent NHI inventory. A link card opens the AI Control Plane
 * roster, where the live agent — the only identity with a real PingOne identity
 * behind it — can be stopped at the identity layer so every platform it touches
 * loses trust at once.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Security operator", sub: ["signs in", "opens /ai-control-plane"], x: 40, y: 150, detail: "Signed in as a customer — the same session the live agent runs on, so every stop is demonstrated on a real identity, not a fixture." },
  { id: "gw", group: "gateway", label: "AI Control Plane", sub: ["roster API", "kill switch"], x: 340, y: 150, detail: "The demo BFF behind /ai-control-plane: GET /api/control-plane/agents builds the roster (live + demo rows), and the Stop buttons front the admin kill-switch routes." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["identity layer", "revoke + disable"], x: 640, y: 150, detail: "Where the agent's identity actually lives — its OAuth tokens, its user account, its agent application. Revoking here is what every downstream platform inherits." },
  { id: "agent", group: "agent", label: "Live agent (NHI)", sub: ["id demo-agent", "real PingOne identity"], x: 940, y: 150, detail: "The roster's live row: the only identity with a real PingOne identity behind it, shown with its current LLM provider and vertical." },
];

const EDGES = [
  ["user", "gw", "roster, not logs", { detail: "The operator opens the governed inventory — real identity state, not scattered agent logs." }],
  ["gw", "p1", "kill-switch · scope=full", { detail: "Stop entire agent goes to the identity layer: revoke tokens, disable the user, disable the application." }],
  ["p1", "agent", "app disabled", { detail: "Disabling the agent application blocks new tokens for every user of that client — revocation alone only kills already-issued ones." }],
  ["agent", "user", "401 agent_killed", { detail: "The kill is real: 401 agent_killed, the calling session destroyed, and the roster row flips to revoked." }],
];

const walk = [
  {
    title: "One governed inventory", label: "roster, not logs",
    nodes: ["user", "gw"], edges: [0],
    lines: [{ who: "Operator", text: "The roster shows only real identities — every row has a live PingOne identity behind it, and the live row names the agent's current LLM provider and vertical." }],
    tech: [{ t: "API", c: "GET /api/control-plane/agents -> { live: { id:'demo-agent', kind:'live', status:'active', vertical, provider }, demo: [...] }" }],
  },
  {
    title: "Stop entire agent", label: "kill-switch · scope=full",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Control plane", text: "Stop this instance stops just this session; Stop entire agent goes to the identity layer — every user of that client loses the agent at once." }],
    tech: [
      { t: "API", c: "POST /api/admin/agent/demo-agent/kill-switch  { reason, scope:'full' }" },
      { t: "TOKEN", c: "RFC 7009 revoke of AT + id_token; PUT /users/{id}/enabled=false" },
    ],
  },
  {
    title: "Severed at the identity layer", label: "app disabled",
    nodes: ["p1", "agent"], edges: [2],
    lines: [{ who: "PingOne", text: "Revocation alone only kills already-issued tokens — disabling the application blocks new ones, and cancelling the schedule stops an agent nobody is driving." }],
    tech: [
      { t: "POLICY", c: "PUT /applications/{id} {enabled:false} — blocks NEW tokens for ALL users of this client until re-enabled" },
      { t: "POLICY", c: "Unattended schedule cancelled — the agent stops waking up, not just stops passing" },
    ],
  },
  {
    title: "Trust severed everywhere", label: "401 agent_killed",
    nodes: ["agent", "user"], edges: [3],
    lines: [{ who: "Presenter", text: "The kill is real: the response is 401 agent_killed, the operator's session is destroyed, and the roster row flips to revoked. Nothing on this page is simulated." }],
    tech: [
      { t: "API", c: "401 { error:'agent_killed', need_auth:true, revoked_at, time_to_revoke_ms } — calling session destroyed" },
      { t: "POLICY", c: "Comprehensive shutdown adds terminateAllUserSessions — PingOne SSO sessions closed so the agent cannot silently re-mint" },
    ],
  },
];

export default {
  id: "UC-NHI1",
  result: { label: "INFO", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
