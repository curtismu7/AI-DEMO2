/**
 * UC2.7 — A2A end to end: protocol + identity. The one step that teaches both
 * meanings of A2A side by side: the Linux Foundation wire protocol (Agent Card
 * discovery, bearer-gated JSON-RPC) and the RFC 8693 nested-act identity chain.
 * Two different credentials for two different layers.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "card", group: "agent", label: "Agent Card", sub: ["discovery"], x: 40, y: 150, detail: "The specialist publishes what it can do and where to call it. Discovery needs no credential." },
  { id: "rpc", group: "gateway", label: "JSON-RPC endpoint", sub: ["bearer-gated"], x: 340, y: 150, detail: "message/send without a bearer is refused — the wire protocol itself is credential-gated." },
  { id: "cc", group: "pingone", label: "client_credentials", sub: ["machine identity"], x: 640, y: 150, detail: "Each agent first authenticates itself — who the agent is, not who it acts for." },
  { id: "ex", group: "pingone", label: "RFC 8693 x2", sub: ["act nests"], x: 940, y: 150, detail: "Then each hop exchanges for the delegated token: act nests, scopes narrow." },
  ];

const EDGES = [
  ["card", "rpc", "discover -> call", { detail: "The card gives the URL; the call still needs a bearer." }],
  ["rpc", "rpc", "401 no bearer", { dashed: true, detail: "A real 401 from a real call — the protocol gate, shown live." }],
  ["cc", "ex", "authenticate then delegate", { detail: "client_credentials twice, then RFC 8693 twice — one per hop." }],
  ["ex", "ex", "both layers, one page", { detail: "The walkthrough renders every hop live when signed in." }],
  ["ex", "ex", "both layers live", { detail: "The walkthrough renders every hop live when signed in — two credentials, two layers." }],
];

const walk = [
  {
    title: "Agent Card", label: "Discovery, no credential",
    nodes: ["card", "rpc"], edges: [0],
    lines: [{ who: "Specialist", text: "The card names capabilities and endpoint — that is the discovery layer." }],
    tech: [{ t: "A2A", c: "GET /.well-known/agent.json -> capabilities + endpoint" }],
  },
  {
    title: "No bearer -> 401", label: "The wire gate",
    nodes: ["rpc"], edges: [1],
    lines: [{ who: "Endpoint", text: "A JSON-RPC message/send without a bearer is refused. Shown live, not asserted." }],
    tech: [{ t: "API", c: "POST /a2a message/send (no Authorization) -> 401" }],
  },
  {
    title: "Machine identity", label: "client_credentials x2",
    nodes: ["cc", "ex"], edges: [2],
    lines: [{ who: "PingOne", text: "Each agent proves who it is with its own client credentials first." }],
    tech: [{ t: "TOKEN", c: "client_credentials x2 -> machine AT per agent" }],
  },
  {
    title: "Identity chain", label: "RFC 8693 x2",
    nodes: ["ex"], edges: [3],
    lines: [{ who: "PingOne", text: "Then each hop exchanges: act nests, scopes narrow — who acts for whom." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 x2 -> delegated AT: act nested, scopes narrowed" }],
  },
  {
    title: "Two layers, one page", label: "The vocabulary step",
    nodes: ["ex"], edges: [4],
    lines: [{ who: "Presenter", text: "Wire protocol gates transport; act chain proves identity. Different credentials." }],
    tech: [{ t: "POLICY", c: "later A2A steps build on this vocabulary" }],
  },
];

export default {
  id: "UC2.7",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
