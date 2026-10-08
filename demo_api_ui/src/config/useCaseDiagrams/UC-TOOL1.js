/**
 * UC-TOOL1 — Protected RAG. A chip routes to code_search: the BFF exchanges
 * for a delegated MCP token carrying code:search (least privilege), the
 * governed path permits the call, and the answer cites file + line ranges.
 * The indexed corpus is not an ungoverned side door.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["code question"], x: 40, y: 150, detail: "The chip 'find where the BFF performs MCP token exchange' is a retrieval job, not a chat answer." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["delegates"], x: 340, y: 150, detail: "Exchanges the user token for an MCP token carrying code:search — nothing broader." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["PERMIT"], x: 640, y: 150, detail: "The same governed path as every tool call: perimeter check, then policy decision." },
  { id: "rag", group: "resource", label: "code-search MCP", sub: ["Weaviate index"], x: 940, y: 150, detail: "Queries the indexed corpus; the answer carries file and line ranges." },
];

const EDGES = [
  ["agent", "bff", "route to code_search", { detail: "The chip phrase resolves to the retrieval tool." }],
  ["bff", "p1", "delegated, narrow scope", { detail: "code:search only — the agent cannot widen its own access." }],
  ["p1", "rag", "dispatch", { detail: "PERMIT lets the governed call reach the index." }],
  ["rag", "agent", "cited answer", { detail: "File and line ranges return with the PERMIT on the evidence rail." }],
  ["rag", "agent", "corpus stays governed", { detail: "RAG added without turning the index into an ungoverned side door." }],
];

const walk = [
  {
    title: "Chip routes to RAG", label: "A retrieval job",
    nodes: ["agent", "bff"], edges: [0],
    lines: [{ who: "Agent", text: "The question names code locations — that is code_search's job." }],
    tech: [{ t: "API", c: "chip -> code_search tool selected" }],
  },
  {
    title: "Least-privilege exchange", label: "code:search only",
    nodes: ["bff", "p1"], edges: [1],
    lines: [{ who: "BFF", text: "RFC 8693 exchange mints a token scoped exactly to the retrieval." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> MCP AT: scp=code:search (nothing broader)" }],
  },
  {
    title: "Governed path", label: "PERMIT",
    nodes: ["p1", "rag"], edges: [2],
    lines: [{ who: "PingOne", text: "Same machinery as any tool: perimeter, then policy." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT (code:search)" }],
  },
  {
    title: "Retrieval over the index", label: "Corpus stays governed",
    nodes: ["rag", "agent"], edges: [3],
    lines: [{ who: "code-search MCP", text: "The Weaviate index answers; the corpus is not an open side door." }],
    tech: [{ t: "API", c: "Weaviate query -> chunks (file + line ranges)" }],
  },
  {
    title: "Cited answer", label: "Evidence on the rail",
    nodes: ["rag", "agent"], edges: [4],
    lines: [{ who: "Presenter", text: "RAG added without losing the delegated identity, scope, decision or audit." }],
    tech: [{ t: "TOKEN", c: "answer cites files; chain shows the full governed path" }],
  },
];

export default {
  id: "UC-TOOL1",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
