/**
 * UC-TOOL1 — Protected RAG. A chip routes to code_search: the BFF exchanges
 * for a delegated MCP token carrying code:search (least privilege), the
 * governed path permits the call, and the answer cites file + line ranges.
 * The indexed corpus is not an ungoverned side door.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["code question"], x: 40, y: 150, detail: "The chip 'find where the BFF performs MCP token exchange' is a retrieval job, not a chat answer." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["delegates"], x: 420, y: 150, detail: "Exchanges the user token for an MCP token carrying code:search — nothing broader." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["PERMIT"], x: 800, y: 150, detail: "The same governed path as every tool call: perimeter check, then policy decision." },
  { id: "rag", group: "resource", label: "code-search MCP", sub: ["Weaviate index"], x: 1180, y: 150, detail: "Queries the indexed corpus; the answer carries file and line ranges." },
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
    tech: [{ t: "TOKEN", c: "RFC 8693 -> MCP AT: scope=code:search (nothing broader)" }],
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

// Per-step detail. Tokens are decoded MOCK values. code_search request shape mirrors demo_mcp_code_search/src/server.ts
// (query, codebase_id, limit, file_filter -> results, query_time_ms).
const ISS = "https://auth.pingone.com/<env id>/as";
const steps = [
  {
    beats: [0],
    detail: {
      form: "chip text: \"find where the BFF performs MCP token exchange\"\n\nBFF picks the tool from the phrase:\n{ \"tool\": \"code_search\", \"arguments\": { \"query\": \"<chip text>\", \"limit\": 10 } }",
      tokens: [],
      refs: [SPEC("MCP authorization 2025-11-25", "MCP tools are called through an authorized session")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /<env id>/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent access token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&resource=<code-search MCP URI>\n&scope=code:search",
      tokens: [
        {
          note: "INPUT subject_token (MOCK) - the signed-in user's token",
          claims: { iss: ISS, sub: "<user id>", aud: "<banking resource>", scope: "openid accounts:read" },
        },
        {
          note: "OUTPUT delegated MCP token (MOCK) - code:search only, nothing broader",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: ISS, sub: "<user id>", aud: "<code-search MCP URI>", scope: "code:search", act: { sub: "<agent client id>" }, exp: "<unix time>" },
        },
      ],
      refs: [RFC(8693, "OAuth 2.0 Token Exchange"), RFC(8707, "Resource Indicators (audience narrowed to one MCP server)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated MCP token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"code_search\", \"arguments\": { \"query\": \"<chip text>\" } } }\n\nPingOne Authorize decision for tool code_search: PERMIT",
      tokens: [{
        note: "Delegated MCP token (MOCK) as the gateway sees it - perimeter check, then policy",
        claims: { iss: ISS, sub: "<user id>", aud: "<code-search MCP URI>", scope: "code:search", act: { sub: "<agent client id>" } },
      }],
      refs: [SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization"), RFC(6750, "Bearer token usage"), SPEC("PingOne Authorize decision API", "Policy decision requested for the call")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST <code-search MCP>/search\nContent-Type: application/json\n\n{ \"query\": \"<chip text>\", \"codebase_id\": \"{codebaseId}\", \"limit\": 10 }\n\n-> 200 { \"results\": [ { \"file\": \"<path>\", \"line_start\": <n>, \"line_end\": <n>, \"snippet\": \"<chunk>\" } ], \"query_time_ms\": <n> }",
      tokens: [],
      refs: [SPEC("MCP authorization 2025-11-25", "The MCP server only sees calls the gateway authorized")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"content\": [ { \"type\": \"text\", \"text\": \"<answer citing file and line ranges>\" } ] } }\n\nevidence rail: delegated identity, scope code:search, PERMIT decision, audit row",
      tokens: [],
      refs: [RFC(8693, "act claim keeps who-acts-for-whom on the audit record")],
    },
  },
];

export default {
  id: "UC-TOOL1",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
