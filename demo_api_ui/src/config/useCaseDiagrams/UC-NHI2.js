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

export default {
  id: "UC-NHI2",
  result: { label: "JML_EVENT_FEED", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
