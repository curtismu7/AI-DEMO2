// Builds the two downloads on the Server Topology page from the same data the
// page draws, so they cannot drift from it. docs/exports/*.csv are the checked-in
// output; serverTopologyExports.test.js fails when they are stale.
import { GROUPS, PLAYBACKS, RFC, SERVER_EDGES, SERVER_MAP, SPECS } from "./serverTopologyData";

export const EDGE_COLORS = { mcp: "#388bfd", oauth: "#bc8cff", agent: "#d29922", data: "#f0883e", telemetry: "#3fb950", optional: "#788492" };
export const NODE_TYPE_COLORS = {
  client: "#58a6ff", gateway: "#bc8cff", app: "#39c5cf", identity: "#db61a2",
  data: "#f0883e", agent: "#d29922", telemetry: "#3fb950",
};

const DETAIL_COLUMNS = [
  "Record Type", "ID", "Name", "Source", "Destination", "Group", "Kind", "Role", "Protocol", "Network", "Security",
  "Local Endpoint", "Kubernetes Endpoint", "Profile", "RFCs", "Specifications", "Playback Scenarios", "Demo Step IDs",
  "Security Alternatives", "Group Color", "Node Outline Color", "Connection Color", "Assessment Notes", "Lucidchart Import ID",
];
const LUCID_COLUMNS = ["ID", "Name", "Shape Library", "Page ID", "Contained By", "Text Area 1", "Line Source", "Line Destination", "Source Arrow", "Destination Arrow"];
const PAGE_TITLE = "AI Demo Server Topology — Local Compose + Hosted Kubernetes (repo-declared; review caveats in workplan)";

const cell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (columns, rows) => `${[columns, ...rows].map((row) => row.map(cell).join(",")).join("\n")}\n`;
const refs = (table, keys) => (keys || []).map((key) => table[key]?.id).filter(Boolean).join("; ");
const unique = (list) => [...new Set(list)];

// Lucidchart ids: 1 is the page, then the servers, then the connections.
const serverLucidId = (index) => index + 2;
const edgeLucidId = (index) => SERVER_MAP.length + index + 2;

const playbacksFor = (matches) => Object.entries(PLAYBACKS)
  .filter(([, playback]) => playback.steps.some(matches))
  .map(([key, playback]) => `${key}: ${playback.label}`).join("; ");
const demoStepsFor = (matches) => unique(Object.values(PLAYBACKS)
  .flatMap((playback) => playback.steps.filter(matches).flatMap((step) => step.demoStepIds || []))).join("; ");

const alternative = (option) => {
  const cited = [...(option.rfcs || []).map((key) => RFC[key]?.id), ...(option.specs || []).map((key) => SPECS[key]?.id)].filter(Boolean).join(", ");
  return `${option.title} [${option.status}] — ${option.relationship}. Requirements: ${option.requirements}${cited ? ` (${cited})` : ""}`;
};

/**
 * @param {Record<string, string>} notes Assessment notes by record id. They are
 *   written by hand, so the caller passes the ones already in the file.
 */
export function buildTopologyDetailsCsv(notes = {}) {
  const edgeById = Object.fromEntries(SERVER_EDGES.map((edge) => [edge.id, edge]));
  const servers = SERVER_MAP.map((node, index) => {
    const touches = (step) => {
      const edge = edgeById[step.edgeId];
      return edge && (edge.source === node.id || edge.target === node.id);
    };
    const { data } = node;
    return [
      "Server", node.id, data.title, "", "", GROUPS[data.group]?.label || data.group, data.kind, data.role, data.protocol,
      data.network, data.security, data.local, data.k8s, data.profile || "", refs(RFC, data.rfcs), refs(SPECS, data.specs),
      playbacksFor(touches), demoStepsFor(touches), (data.securityOptions || []).map(alternative).join(" | "),
      GROUPS[data.group]?.color || "", NODE_TYPE_COLORS[data.kind] || "", "", notes[node.id] || "", serverLucidId(index),
    ];
  });
  const connections = SERVER_EDGES.map((edge, index) => {
    const isEdge = (step) => step.edgeId === edge.id;
    const { data } = edge;
    return [
      "Connection", edge.id, edge.label, edge.source, edge.target, data.kind, data.kind, "", data.protocol, data.network,
      data.security, "", "", data.profile || "", refs(RFC, data.rfcs), refs(SPECS, data.specs), playbacksFor(isEdge),
      demoStepsFor(isEdge), (data.securityOptions || []).map(alternative).join(" | "), "", "", EDGE_COLORS[data.kind] || "",
      notes[edge.id] || "", edgeLucidId(index),
    ];
  });
  return toCsv(DETAIL_COLUMNS, [...servers, ...connections]);
}

export function buildTopologyLucidchartCsv() {
  const lucidIdOf = Object.fromEntries(SERVER_MAP.map((node, index) => [node.id, serverLucidId(index)]));
  return toCsv(LUCID_COLUMNS, [
    [1, "Page", "", 1, "", PAGE_TITLE, "", "", "", ""],
    ...SERVER_MAP.map((node, index) => [
      serverLucidId(index), "Process", "Flowchart Shapes", 1, "", [node.data.title, node.data.service, `${node.data.protocol}${node.data.profile ? ` · profile: ${node.data.profile}` : ""}`].join("\n"), "", "", "", "",
    ]),
    ...SERVER_EDGES.map((edge, index) => [
      edgeLucidId(index), "Line", "", 1, "", [edge.label, edge.data.protocol].join("\n"), lucidIdOf[edge.source], lucidIdOf[edge.target], "None", "Arrow",
    ]),
  ]);
}

/** The hand-written assessment notes already in a details CSV, by record id. */
export function readAssessmentNotes(csvText) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    if (quoted) {
      if (char === '"' && csvText[i + 1] === '"') { value += '"'; i += 1; } else if (char === '"') quoted = false; else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; } else if (char === "\n") { row.push(value); rows.push(row); row = []; value = ""; } else if (char !== "\r") value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const idColumn = DETAIL_COLUMNS.indexOf("ID"); const noteColumn = DETAIL_COLUMNS.indexOf("Assessment Notes");
  return Object.fromEntries(rows.slice(1).filter((cells) => cells[noteColumn]).map((cells) => [cells[idColumn], cells[noteColumn]]));
}
