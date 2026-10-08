/**
 * UC22 — CIBA out-of-band approval. The agent moves a deliberately small $150
 * (below the MFA threshold to show the trigger is sensitivity, not amount):
 * the approval is pushed to the user's phone and the agent polls until it is
 * granted. A compromised browser cannot self-approve.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $150"], x: 40, y: 150, detail: "Has no browser to prompt — it can only ask and poll." },
  { id: "p1", group: "pingone", label: "PingOne CIBA", sub: ["auth_req_id"], x: 340, y: 150, detail: "Accepts the backchannel request and pushes the approval to the user's device." },
  { id: "user", group: "user", label: "Alice (user)", sub: ["own phone"], x: 640, y: 150, detail: "Approves off-session. A compromised browser or rogue agent cannot answer for her." },
  { id: "tool", group: "resource", label: "Banking MCP", sub: ["dispatched last"], x: 940, y: 150, detail: "Runs only after the poll returns a token — the chain shows the full order." },
];

const EDGES = [
  ["agent", "p1", "CIBA request", { detail: "Backchannel auth request: the agent asks PingOne, not the browser." }],
  ["p1", "user", "push to phone", { detail: "The approval request lands on the enrolled device.", vertical: true }],
  ["agent", "p1", "poll (pending)", { detail: "The agent cannot self-approve; it polls the token endpoint with auth_req_id." }],
  ["user", "p1", "approve", { detail: "Her decision happens off-session, out of the agent's reach.", vertical: true }],
  ["p1", "agent", "token", { detail: "The poll completes: ciba-poll done, token issued." }],
  ["agent", "tool", "dispatch", { detail: "Chain order on the record: authorize-decision -> ciba-poll -> tool-dispatched." }],
];

const walk = [
  {
    title: "Agent asks for $150", label: "Sensitivity, not amount",
    nodes: ["agent", "p1"], edges: [0],
    lines: [{ who: "Agent", text: "$150 is deliberately below the MFA threshold — CIBA here is about the action class." }],
    tech: [{ t: "API", c: "POST /bc-authorize scope=transfer amount=150 -> auth_req_id" }],
  },
  {
    title: "Push to the phone", label: "Out of band",
    nodes: ["p1", "user"], edges: [1],
    lines: [{ who: "PingOne", text: "The approval request goes to the user's own device — the agent has no browser." }],
    tech: [{ t: "POLICY", c: "CIBA push delivered to enrolled device" }],
  },
  {
    title: "Agent polls", label: "Cannot self-approve",
    nodes: ["agent", "p1"], edges: [2],
    lines: [{ who: "Agent", text: "authorization_pending — it waits. That is the whole point." }],
    tech: [{ t: "TOKEN", c: "POST /token grant=urn:openid:params:grant-type:ciba -> authorization_pending" }],
  },
  {
    title: "User approves", label: "Off the session",
    nodes: ["user", "p1"], edges: [3],
    lines: [{ who: "Alice", text: "The decision is hers and happens off-session — a rogue agent cannot answer." }],
    tech: [{ t: "POLICY", c: "out-of-band approval recorded against auth_req_id" }],
  },
  {
    title: "Poll returns the token", label: "ciba-poll completes",
    nodes: ["p1", "agent"], edges: [4],
    lines: [{ who: "PingOne", text: "Now the poll succeeds and the delegated token is issued." }],
    tech: [{ t: "TOKEN", c: "poll -> 200 access_token (consent confirmed)" }],
  },
  {
    title: "Tool dispatched", label: "Chain in order",
    nodes: ["agent", "tool"], edges: [5],
    lines: [{ who: "Gateway", text: "The transfer executes with the full order visible: authorize, poll, dispatch." }],
    tech: [{ t: "API", c: "token chain: authorize-decision -> ciba-poll -> tool-dispatched" }],
  },
];

export default {
  id: "UC22",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
