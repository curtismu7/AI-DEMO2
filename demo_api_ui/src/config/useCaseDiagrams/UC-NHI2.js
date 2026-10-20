/**
 * UC-NHI2 — Agent lifecycle export (JML). Kill-switch and re-enable actions
 * on /agent-lifecycle emit joiner/mover/leaver events in an IGA-consumable
 * shape (webhook / pollable JSON), each linked back to the immutable
 * kill-switch audit record. Illustrative export pattern, not a SailPoint API.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "admin", group: "user", label: "Operator", sub: ["agent lifecycle"], x: 40, y: 150, detail: "Flips the kill switch (or re-enables) on /agent-lifecycle — the human decision that starts the record." },
  { id: "lifecycle", group: "gateway", label: "Agent lifecycle", sub: ["kill switch", "audit record"], x: 340, y: 150, detail: "Applies the revocation and writes the immutable audit record the JML event will point at." },
  { id: "events", group: "pingone", label: "Lifecycle events", sub: ["GET /api/control-plane/lifecycle-events"], x: 640, y: 150, detail: "Emits joiner/mover/leaver events with complianceTags, an auditId and the agent's source tag." },
  { id: "iga", group: "external", label: "IGA tool", sub: ["e.g. SailPoint"], x: 940, y: 150, detail: "Consumes the JML feed to certify agents the way it already certifies humans — webhook or poll." },
];

const EDGES = [
  ["admin", "lifecycle", "revoke / re-enable", { detail: "One click: the agent stops passing policy the moment the switch flips." }],
  ["lifecycle", "events", "leaver / mover event", { detail: "Every state change emits an event — kill-switch = leaver, re-enable = mover, registration = joiner." }],
  ["events", "iga", "JML feed", { detail: "The same joiner/mover/leaver shape an IGA system pulls for employees, now for agents." }],
];

const walk = [
  {
    title: "Flip the switch", label: "revoke",
    nodes: ["admin", "lifecycle"], edges: [0],
    lines: [{ who: "Operator", text: "Self-service revoke on the lifecycle page — the agent's next call fails policy." }],
    tech: [{ t: "POLICY", c: "kill switch -> agent status=revoked; retry denied at the gateway" }],
  },
  {
    title: "Audit record written", label: "immutable",
    nodes: ["lifecycle"], edges: [],
    lines: [{ who: "Lifecycle", text: "The action lands in an immutable audit record before any event leaves." }],
    tech: [{ t: "API", c: "agentLifecycleEventStore (LMDB) -> auditId" }],
  },
  {
    title: "JML event emitted", label: "joiner / mover / leaver",
    nodes: ["lifecycle", "events"], edges: [1],
    lines: [{ who: "Events", text: "kill-switch emits a leaver; re-enable a mover — each carrying complianceTags and the auditId." }],
    tech: [
      { t: "API", c: "GET /api/control-plane/lifecycle-events -> [{ type: 'leaver', auditId, complianceTags }]" },
      { t: "API", c: "optional webhook forward (sailpointForwarder)" },
    ],
  },
  {
    title: "IGA certifies", label: "no competing identity store",
    nodes: ["events", "iga"], edges: [2],
    lines: [{ who: "IGA tool", text: "Agents join the same joiner/mover/leaver process as people — Ping feeds it, not replaces it." }],
    tech: [{ t: "API", c: "webhook POST or poll -> IGA consumes the JML shape" }],
  },
];

// Per-step detail (shown for the active beat). Tokens are decoded MOCK values; forms mirror the real routes
// (POST /api/admin/agent/:agentId/kill-switch, GET /api/control-plane/lifecycle-events, sailpointForwarder).
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/admin/agent/{agentId}/kill-switch\nAuthorization: Bearer <operator access token>\nContent-Type: application/json\n\n{ \"reason\": \"manual_red_button\", \"scope\": \"instance\" }",
      tokens: [{
        note: "Operator access token · who may flip the switch",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "operator-0001", aud: "https://api.ping.demo", scope: "openid profile", exp: 1790000000 },
      }],
      refs: [
        { id: "RFC 9068", title: "JWT Profile for OAuth 2.0 Access Tokens", kind: "rfc" },
        { id: "RFC 7009", title: "OAuth 2.0 Token Revocation", kind: "rfc" },
      ],
    },
  },
  {
    beats: [1],
    detail: {
      form: "agentLifecycleEventStore.append({\n  eventType: \"leaver\",\n  agentId: \"{agentId}\",\n  reason: \"manual_red_button\",\n  actor: { userId, username },\n  auditId: \"aud_01HEXAMPLE\"\n})",
      refs: [{ id: "RFC 8693", title: "OAuth 2.0 Token Exchange (the delegation chain the audit record preserves)", kind: "rfc" }],
    },
  },
  {
    beats: [2],
    detail: {
      form: "GET /api/control-plane/lifecycle-events?eventType=leaver&limit=50\nAuthorization: Bearer <operator access token>",
      refs: [
        { id: "RFC 7644", title: "SCIM 2.0 Protocol (the provisioning shape IGA tools already speak)", kind: "rfc" },
        { id: "RFC 8417", title: "Security Event Token (SET): the event-feed pattern", kind: "rfc" },
      ],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST {SAILPOINT_WEBHOOK_URL}\nContent-Type: application/json\nX-Api-Key: <webhook key, if configured>\n\n{ \"source\": \"ai-demo-bff\", \"eventType\": \"agent_lifecycle\",\n  \"event\": { \"eventType\": \"leaver\", \"agentId\": \"{agentId}\", \"auditId\": \"aud_01HEXAMPLE\",\n            \"complianceTags\": [\"TRiSM\", \"AI-Safety\"] } }",
      refs: [{ id: "RFC 8935", title: "Push-Based SET Delivery over HTTP", kind: "rfc" }],
    },
  },
];

export default {
  id: "UC-NHI2",
  result: { label: "JML_EVENT_FEED", tone: "info" },
  pingStyle: true, // pilot: opts this page into the Ping look (see UseCaseDiagramPage)
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
