// PrivilegeGatewayTopologyPage.jsx — The two PingOne Privilege MCP Gateway
// deployment variants (agent-based, agentless) from the SE instructional demo
// setup doc, the live load-balanced mcpgw topology and the agent-to-agent layout,
// each a static React Flow drawing with the request flow numbered step by step.
//
// Honesty: every diagram is a hand-placed illustration; Simulate steps through the
// arrows as a teaching aid and sends nothing. The only real parts are the two live
// load-balancer panels (HAProxy stats frame, runtime park/unpark), which call this
// app's admin API and need an admin PingOne sign-in.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) on the shared primitives (components/pingUi,
// styles/ping-ui.css): P2 banner first, P3 frame and sections, P4 cards, P5 kv,
// P7 chips with a word, P9 buttons. Skipped: P6 (no inspector: the diagram's own
// step reel is shared and stays as it is) and P8 (the diagram boxes belong to the
// shared StaticFlowDiagram). The standalone shell bar is not added (the app has its own).
//
// P9 primary per view state: the one primary, in every state (all four tabs, with or without an admin
// session), is the link to the setup guide: the one action that leads somewhere new, kept a real link so it
// opens in a new tab and can be copied. The diagram's own step buttons (shared DiagramStepBar: Simulate, Pause,
// Next ...) are bordered secondaries under the shared toolbar rule. The tab pickers, Park and Unpark are
// secondary too: Park and Unpark change a live load balancer, so they are never the default action. A picker
// shows its selection with a heavier edge, a fill and a check mark, never a primary colour.
// React, hooks
import React, { useEffect, useState, useCallback } from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import apiClient from "../services/apiClient";
import "./PrivilegeGatewayTopologyPage.css";
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from "./pingUi";
import { STEPS_BY_TAB } from "../config/gatewayTopologyStandards";

// Agent-based tab: static hand-placed layout (converted from Mermaid 2026-10-12 —
// all diagrams are ReactFlow now; the archived Mermaid source's ELK layout also
// overlapped its numbered step badges). The client talks to a local Priv Agent,
// which tunnels to the public proxy; the in-cluster gateway dials OUT to the
// proxy — nothing connects inbound to the cluster.
export const AGENT_NODES = [
  { id: "console", group: "cloud", label: "Priv Cloud controller", sub: ["console · config sync"], x: 0, y: 20 },
  { id: "client", group: "device", label: "MCP client", sub: ["Postman · IDE · agent app"], x: 0, y: 320 },
  { id: "agent", group: "device", label: "Priv Agent (local)", sub: ["localhost :8643/sse", "device identity · Secure Enclave"], x: 400, y: 320 },
  { id: "gw", group: "gw", label: "MCP Gateway (in-cluster)", sub: ["mcpgw.\u2039ns\u203a.svc.cluster.local:8680", "JIT policy evaluated here"], x: 400, y: 620 },
  { id: "mcp", group: "app", label: "MCP server", sub: ["cluster-local /sse"], x: 840, y: 620 },
  { id: "proxy", group: "cloud", label: "Public proxy", sub: ["proxy-us-west-2.privilege.pingone.com:443"], x: 840, y: 320 },
];
export const AGENT_EDGES = [
  ["console", "proxy", "config sync (ENV_PROXY_TOKEN)", { dashed: true }],
  ["console", "agent", "gRPC proxy config (magic link)", { dashed: true }],
  ["gw", "proxy", "standing outbound TLS :443", {}],
  ["client", "agent", "MCP request :8643/sse", {}],
  ["agent", "proxy", "TLS tunnel :443", {}],
  ["proxy", "gw", "rides the standing link", {}],
  ["gw", "mcp", "permitted call, cluster-local", {}],
];
// Ping palette: red = Ping product (Privilege, PingOne), dark = app / agent / client, grey = infrastructure.
// Page tokens (defined in the page sheet from the app's tokens, so both themes follow).
const PING = "var(--pgt-ping)";
const APP = "var(--pgt-app)";
const INFRA = "var(--pgt-infra)";
const SWATCH = { [PING]: "ping", [APP]: "app", [INFRA]: "infra" };
const AGENT_GROUPS = {
  cloud: { label: "Priv Cloud / PingOne", bg: PING },
  device: { label: "User device / client", bg: APP },
  gw: { label: "Privilege MCP Gateway (in-cluster)", bg: PING },
  app: { label: "MCP server", bg: APP },
  k8s: { label: "Ingress", bg: INFRA },
};

// Agentless tab: static hand-placed layout (converted from Mermaid 2026-10-12).
// No local agent — the client connects straight to the ingress; the gateway's
// PingOne OIDC client signs the user in before JIT policy is evaluated.
export const AGENTLESS_NODES = [
  { id: "console", group: "cloud", label: "Priv Cloud console", sub: ["gRPC: proxy config", "(proxyToken from Helm)"], x: 0, y: 20 },
  { id: "p1", group: "cloud", label: "PingOne AS", sub: ["authorize · token · userinfo"], x: 720, y: 20 },
  { id: "client", group: "device", label: "MCP client", sub: ["HTTPS :443 + OIDC auth code"], x: 0, y: 300 },
  { id: "ingress", group: "k8s", label: "Ingress", sub: ["\u2039you\u203a-agentless-mcpgw.ping-devops.com", "/opensearch-mcp-server/mcp"], x: 360, y: 300 },
  { id: "gw", group: "gw", label: "MCP Gateway (in-cluster)", sub: ["mcpgw.\u2039ns\u203a.svc.cluster.local:8680", "JIT policy vs signed-in user"], x: 360, y: 560 },
  { id: "mcp", group: "app", label: "MCP server", sub: ["cluster-local /sse"], x: 720, y: 560 },
];
export const AGENTLESS_EDGES = [
  ["console", "gw", "config (gRPC)", { dashed: true }],
  ["client", "ingress", "HTTPS request", {}],
  ["ingress", "p1", "first contact: auth-code sign-in", {}],
  ["p1", "ingress", "identity (userinfo)", {}],
  ["ingress", "gw", "route to gateway :8680", {}],
  ["gw", "mcp", "permitted call, cluster-local", {}],
];
const AGENTLESS_GROUPS = AGENT_GROUPS;

// A2A tab: static hand-placed layout (StaticFlowDiagram). The Mermaid version's
// ELK auto-layout overlapped its numbered edge labels and crossed edges (seen 2026-10-12).
// Positions chosen so no two edges cross: worker at top-right fans down to the model and
// tool routes; the provider hangs below-left off the model route, clear of the worker fan.
export const A2A_NODES = [
  { id: "console", group: "cloud", label: "Priv Cloud console", sub: ["agent registry · policies", "keys · AIGuard config"], x: 0, y: 20 },
  { id: "main", group: "device", label: "Main agent", sub: ["user device", "holds its own agent key"], x: 0, y: 330 },
  { id: "gwA2A", group: "gw", label: "Agent route", sub: ["/‹worker-app›/a2a", "checks a2a scope + policy"], x: 400, y: 120 },
  { id: "gwLLM", group: "gw", label: "Model route", sub: ["/llm/‹provider›", "checks key + allowed model", "swaps agent key → provider key"], x: 400, y: 300 },
  { id: "model", group: "cloud", label: "Model provider", sub: ["Google · Anthropic · OpenAI", "never sees an agent key"], x: 120, y: 480 },
  { id: "gwMCP", group: "gw", label: "Tool route", sub: ["/‹mcp-app›/mcp", "checks mcp scope + tool grant", "screens results (AIGuard)"], x: 400, y: 680 },
  { id: "worker", group: "k8s", label: "Worker agent", sub: ["cluster-local", "holds its own agent key"], x: 800, y: 120 },
  { id: "mcp", group: "k8s", label: "MCP server", sub: ["cluster-local · zero Privilege code"], x: 800, y: 680 },
];
export const A2A_EDGES = [
  ["console", "gwA2A", "config", { dashed: true }],
  ["main", "gwLLM", "model call", {}],
  ["main", "gwA2A", "A2A message", {}],
  ["gwA2A", "worker", "forwarded", {}],
  ["worker", "gwLLM", "model call", {}],
  ["worker", "gwMCP", "tool call", {}],
  ["gwMCP", "mcp", "screened", {}],
  ["gwLLM", "model", "provider key", {}],
];
const A2A_GROUPS = {
  cloud: { label: "Priv Cloud / providers", bg: PING },
  device: { label: "Main agent (user device)", bg: APP },
  gw: { label: "Agent Privilege", bg: PING },
  k8s: { label: "Worker agent and MCP server (cluster)", bg: APP },
};

const A2A_STEPS = [
  { heading: "Setup — happens once" },
  { n: 1, text: "In the console, register the worker as a Remote Agent app and the tool server as an MCP app (Agentic Apps), then create one agent per caller (Agent Privilege > Agent Registry): the main agent with the llm and a2a scopes and the worker selected, the worker agent with the llm and mcp scopes and each tool allowed. Each agent gets its own key, provider, allowed model and AIGuard settings." },
  { heading: "Request path — every call" },
  { n: 2, text: "The main agent calls its model through the gateway with its own agent key. The gateway checks the key and the allowed model." },
  { n: 3, text: "The main agent hands the question to the worker as an A2A message/send, addressed to the gateway, with the same agent key." },
  { n: 4, text: "The gateway checks the key, the a2a scope, the policy for that Remote Agent and the guardrail, then forwards the call. A refusal stops here; the worker never sees the main agent's key." },
  { n: 5, text: "The worker calls its own model through the gateway with the worker agent key, on its own model tier." },
  { n: 6, text: "The worker calls a tool on the MCP server through the gateway, again with the worker agent key." },
  { n: 7, text: "The gateway forwards a permitted tool call and screens the result on the way back: personal data is redacted, and a result carrying hidden instructions is blocked before the worker's model reads it." },
  { n: 8, text: "For every model call the gateway swaps the agent key for the real provider key, so no agent ever holds it." },
];
const A2A_DETAILS = {
  main: "The caller. Holds only its own agent key (llm + a2a scopes, worker selected).",
  worker: "Cluster-local worker. Holds its own agent key (llm + mcp scopes, each tool allowed) on its own model tier.",
  gwA2A: "The Remote Agent door: /‹worker-app›/a2a. Per-call checks: key, a2a scope, policy, guardrail.",
  gwLLM: "The model lane: /llm/‹provider›. Key check, allowed-model check, then key swap. Live lanes today: openai, anthropic, google, openrouter, custom (llama.cpp).",
  gwMCP: "The MCP door: /‹mcp-app›/mcp. Key check, mcp scope, per-tool grant, AIGuard screens the result on the way back.",
  model: "The real provider. Sees only the provider key the gateway injected — never an agent key.",
  mcp: "The tool server. Zero Privilege-specific code: it sees a normal MCP call.",
  console: "Registration, policies, agent registry, agent keys, per-key AIGuard. Config plane only — no request traffic flows through it.",
};

// Live mcpgw load-balanced topology (verified on the SE cluster 2026-10-12: LB pods run
// haproxy:3.0-alpine; privilege/GATEWAY-LOAD-BALANCER.md §00/§00a, CURRENT-CONFIGURATION.md).
// Static hand-placed layout, drawn with StaticFlowDiagram (React Flow) like
// PrivilegeFirstGatewayPage — the Mermaid-source tabs above are archived content.
const LB_GROUPS = {
  client: { label: "Clients", bg: APP },
  lb: { label: "Ingress and load balancer", bg: INFRA },
  gw: { label: "Agent Privilege — mesh cluster ai-demo-cmuir", bg: PING },
  state: { label: "Shared state", bg: INFRA },
  door: { label: "Agentic App doors", bg: PING },
  backend: { label: "Backends", bg: APP },
};
export const LB_NODES = [
  { id: "client", group: "client", label: "MCP clients / browser", sub: ["LM Studio · demo Privilege page", "https://mcpgw.ai-demo.ping-devops.com/<App>/mcp"], x: 0, y: 20 },
  { id: "ingress", group: "lb", label: "nginx-public ingress", sub: ["TLS :443 → mcpgw-lb :8623"], x: 330, y: 20 },
  { id: "lb", group: "lb", label: "mcpgw-lb ×2 · HAProxy 3.0", sub: ["balance hash (X-Forwarded-For + app)", "hash-type consistent → one node per client per app", "health GET / every 10s · fall 2 / rise 60", "X-Served-By: gateway-N"], x: 660, y: 20 },
  { id: "redis", group: "state", label: "privilege-redis", sub: ["shared client registry — tokens are NOT shared"], x: 660, y: 240 },
  { id: "gw1", group: "gw", label: "gateway-1", sub: ["agentless-mcpgw · curtismuir", ":8623 https · 9/9 sidecars"], x: 330, y: 460 },
  { id: "gw2", group: "gw", label: "gateway-2", sub: ["agentless-mcpgw · cmuir", ":8623 http · sidecars"], x: 760, y: 460 },
  { id: "d-ose", group: "door", label: "opensearch", sub: ["policy off → always-403 deny twin"], x: 0, y: 700 },
  { id: "d-agg", group: "door", label: "aggregate family", sub: ["aggregate (default door)", "aggregate-limited · aggregate-none"], x: 220, y: 700 },
  { id: "d-hostile", group: "door", label: "hostile family", sub: ["hostile-mcp (315 calls/wk)", "hostile-mcp-governed · hostile-a2a"], x: 460, y: 700 },
  { id: "d-side", group: "door", label: "sidecar + other doors", sub: ["openapi2 · mcp-pingone", "mcp-brave-search · mcp-grafana", "agent-gateway · llm lanes"], x: 700, y: 700 },
  { id: "b-ose", group: "backend", label: "opensearch-mcp-server", sub: ["svc · curtismuir /mcp"], x: 110, y: 920 },
  { id: "b-host", group: "backend", label: "hostile-mcp-server", sub: ["Deployment · :8899 → /mcp"], x: 460, y: 920 },
  { id: "b-side", group: "backend", label: "sidecars (per gateway pod)", sub: ["brave :8084 · grafana :8081 · banking-rest :8082", "pingone :8083 · openapi-banking :8080 · promptguard :8086"], x: 660, y: 920 },
];
export const LB_EDGES = [
  ["client", "ingress", "HTTPS", {}],
  ["ingress", "lb", ":8623", {}],
  ["lb", "gw1", "hash pin", {}],
  ["lb", "gw2", "hash pin", {}],
  ["gw1", "redis", "registry", { dashed: true }],
  ["gw2", "redis", "registry", { dashed: true }],
  ["gw2", "d-ose", "any node serves any app", { dashed: true }],
  ["d-ose", "b-ose", "", { vertical: true }],
  ["d-agg", "b-ose", "aggregate of ose+banking", { vertical: true }],
  ["d-side", "b-side", "", { vertical: true }],
  ["d-hostile", "b-host", "", { vertical: true }],
];
// The step numbers are the orange arrow numbers on the diagram (n = LB_EDGES index + 1); the failover notes have no arrow.
const LB_STEPS = [
  { heading: "Request path — every call" },
  { n: 1, text: "The client calls https://mcpgw.ai-demo.ping-devops.com/<App>/mcp over HTTPS." },
  { n: 2, text: "The nginx-public ingress terminates TLS and routes to Service mcpgw-lb on :8623." },
  { n: 3, text: "One of two HAProxy pods answers. balance hash on client address plus app (the first path segment) with hash-type consistent pins every request for one app from one client to the same gateway node, so one client's apps spread over all gateways. The global /callback follows a node tag the authorize redirect leaves in state — no stick table, both pods hash and probe identically. Every response carries X-Served-By: gateway-N, which is how the demo proves who answered." },
  { n: 4, text: "A different client address can hash to the other node; both pods make the same choice for the same address." },
  { n: 5, text: "Each gateway node reads client registrations from the shared privilege-redis, so a client registered once is known everywhere. Tokens are not shared." },
  { n: 6, text: "The second node reads the same registry — a client moved to it by a failover is known, but signs in again because its token was minted by the other node." },
  { n: 7, text: "The pinned node evaluates the Agentic App's JIT policy (allowed tools, users, time window). Both nodes belong to mesh cluster ai-demo-cmuir, so an app is registered once and any node can serve it. The opensearch door is the deliberate known-deny twin: no policy attached, always 403." },
  { n: 8, text: "A permitted call reaches opensearch-mcp-server cluster-locally." },
  { n: 9, text: "The aggregate door fans one call across opensearch and banking tools; the response returns with X-Served-By naming the node that served it." },
  { n: 10, text: "Sidecar-backed doors reach their sidecar on the gateway pod's own localhost." },
  { n: 11, text: "The hostile family reaches hostile-mcp-server on :8899; the governed twin answers 403 when policy refuses." },
  { heading: "Failover — what a switch costs" },
  { text: "Health checks run every 10s (any 2xx–4xx counts as up; the gateway answers 401 to a bare GET /). When a node dies its clients move within one 10s sample — but their tokens were minted by the dead node, so they sign in again. Registrations survive via shared Redis; tokens do not." },
  { text: "A recovered node needs 60 consecutive passing checks (rise 60 × 10s ≈ 10 minutes) before it takes clients back. That window answers 503 node=<NOSRV> and looks like a total outage while every gateway is actually fine — wait it out; do not restart a gateway to 'fix' it. The LB runtime controls below this diagram park or unpark a node through HAProxy's runtime API (admin only): parking is instant, unparking waits out the same rise-60 hold-out, and runtime state resets when the LB pods roll." },
];
const LB_DETAILS = {
  lb: "Two replicas on separate hosts (topologySpread). Engine is haproxy — swapped after PR #1022 deployed; gateway1-lb.values.yaml matches.",
  gw1: "Owns the HTTPS front door certificate name; 9/9 containers: gateway + 8 sidecars.",
  gw2: "Second node in cmuir, same release chart (release agentless-mcpgw in its namespace). Gateway-3 was deleted from the cluster on 2026-10-12.",
  redis: "One pod, 1Gi AOF, password-only TLS-less in-cluster. Hard dependency: a gateway restart with Redis down exits after 6 attempts.",
  "d-agg": "The teaching family, and the BFF's default door: aggregate (policy-backed), aggregate-limited (tool-filtered, the per-tool-grant demo) and aggregate-none (no policy → deny-all twin). opensearch-hitl — the old always-200 fixture — was deleted from the console 2026-10-12 (unused 15 days); the default moved to aggregate.",
  "d-ose": "Deliberate known-deny door: no policy attached, always 403. Enforcement is real; do not 'fix' it.",
  "d-hostile": "The hostile family: hostile-mcp (the demo workhorse), hostile-mcp-governed (policy-governed twin, 403s when policy refuses) and hostile-a2a (A2A route).",
  "d-side": "Sidecar-backed doors (openapi2, mcp-pingone, mcp-brave-search, mcp-grafana) plus the LLM lanes under /llm/* (openai, anthropic, google, openrouter, custom).",
};

const AGENT_STEPS = [
  { heading: "Setup — happens once" },
  { n: 1, text: "Console and public proxy (proxy-us-west-2.privilege.pingone.com:443) sync configuration. The gateway is registered in the console under Gateways > Add New > Add via Docker — Cluster ID of your choice, Host IP set to the gateway DNS (e.g. https://cj-mcpgw.ping-devops.com) — which issues the ENV_PROXY_TOKEN you pass to the privgateway Helm chart as mcpgw.proxyToken." },
  { n: 2, text: "The Priv Agent is installed from an onboarding magic link (Directory > Users > your admin user > Services > Privilege > Generate Onboarding Link). Once connected, the console pushes proxy config to it over gRPC and the agent exposes a local MCP frontend at https://opensearch.default.applications.procyon.ai:8643/sse." },
  { n: 3, text: "The gateway (http://mcpgw.‹namespace›.svc.cluster.local:8680) dials out and holds a standing TLS link to the public proxy on 443 — Priv expects the gateway on 8680 and the cluster ingress only allows standard ports, so nothing connects inbound to it." },
  { heading: "Request path — every call" },
  { n: 4, text: "MCP client (the doc demos with Postman) sends its request over HTTPS to the agent's local frontend on :8643/sse, which carries the user's device identity (Secure Enclave key store, tenant binding)." },
  { n: 5, text: "Agent tunnels the request over TLS on 443 to proxy-us-west-2.privilege.pingone.com." },
  { n: 6, text: "Proxy routes the request down the standing link from step 3; the gateway evaluates the JIT policy you authored under Agentic Apps > opensearch-mcp-server > Policy (allowed tools, users, start/end time window) before anything proceeds." },
  { n: 7, text: "Gateway forwards the permitted tool call over cluster-local HTTP to http://‹release›-opensearch-mcp-server.‹namespace›.svc.cluster.local/sse; denied calls stop at step 6." },
];

const AGENTLESS_STEPS = [
  { heading: "Setup — happens once" },
  { n: 1, text: "Console pushes proxy config to the gateway over gRPC — the gateway registered itself with the proxyToken you passed to the agentless-mcpgw Helm chart, alongside the OIDC values (oidc.clientId / clientSecret / authUrl / tokenUrl / userUrl) of the \"MCP Gateway\" PingOne web app." },
  { heading: "Request path — every call" },
  { n: 2, text: "Client calls https://‹you›-agentless-mcpgw.ping-devops.com/opensearch-mcp-server/mcp over HTTPS 443." },
  { n: 3, text: "On first contact the gateway's PingOne OIDC client runs the authorization-code sign-in (Client Secret Basic) against https://auth.pingone.com/‹env-id›/as/authorize and exchanges the code at /as/token; the redirect URI is the gateway DNS + /callback." },
  { n: 4, text: "The gateway reads identity from /as/userinfo." },
  { n: 5, text: "Ingress routes to the gateway service on 8680, which evaluates the JIT policy (Agentic Apps > opensearch-mcp-server > Policy: allowed tools, users, time window) against the signed-in PingOne user." },
  { n: 6, text: "Gateway forwards the permitted tool call over cluster-local HTTP to http://opensearch-mcp-server.‹namespace›.svc.cluster.local/sse; denied calls stop at step 5." },
];

export const TABS = [
  {
    id: "lb",
    label: "Live LB topology",
    title: "Live load-balanced topology",
    status: "Current",
    clusterChecked: true,
    checked: "Against the SE cluster, 2026-10-12",
    static: true,
    nodes: LB_NODES,
    edges: LB_EDGES,
    groups: LB_GROUPS,
    steps: LB_STEPS,
    stepDetail: STEPS_BY_TAB.lb,
    details: LB_DETAILS,
    ariaLabel:
      "Live mcpgw load-balanced topology: MCP clients reach an nginx ingress, then two HAProxy load-balancer pods, which pin each client by a consistent hash to one of two gateway nodes in mesh cluster ai-demo-cmuir. The nodes share a Redis client registry and serve the Agentic App doors — the aggregate family, opensearch, the hostile-mcp family and the sidecar doors — which reach the OpenSearch MCP server, hostile-mcp-server and per-pod sidecars.",
    blurb:
      "How the demo's one public mcpgw URL is served today: two HAProxy pods pin each client to one of two gateway nodes of mesh cluster ai-demo-cmuir, and every Agentic App door behind them. Verified live on the SE cluster 2026-10-12.",
  },
  {
    id: "agent",
    label: "Agent-based",
    title: "Agent-based deployment",
    status: "Archived",
    checked: "Not checked against a cluster on this page",
    static: true,
    nodes: AGENT_NODES,
    edges: AGENT_EDGES,
    groups: AGENT_GROUPS,
    steps: AGENT_STEPS,
    stepDetail: STEPS_BY_TAB.agent,
    details: {
      gw: "Priv expects the gateway on 8680; the cluster ingress only allows standard ports, so the gateway dials OUT instead of being reached.",
      agent: "Installed from an onboarding magic link; exposes a local MCP frontend on :8643/sse with the user's device identity (Secure Enclave, tenant binding).",
    },
    ariaLabel:
      "Archived agent-based variant: the MCP client talks to a local Priv Agent, which tunnels to the Privilege public proxy; the in-cluster gateway dials out to the proxy and evaluates JIT policy there before forwarding to the MCP server. Nothing connects inbound to the cluster.",
    blurb:
      "ARCHIVED deployment variant. The MCP client talks to a local Priv Agent, which tunnels out to the Privilege public proxy. The in-cluster gateway also dials out to that proxy — Privilege expects the gateway on 8680 and the cluster ingress only carries 443, so no traffic enters the cluster directly.",
  },
  {
    id: "agentless",
    label: "Agentless",
    title: "Agentless deployment",
    status: "Archived",
    checked: "Not checked against a cluster on this page",
    static: true,
    nodes: AGENTLESS_NODES,
    edges: AGENTLESS_EDGES,
    groups: AGENTLESS_GROUPS,
    steps: AGENTLESS_STEPS,
    stepDetail: STEPS_BY_TAB.agentless,
    details: {
      ingress: "Terminates TLS for ‹you›-agentless-mcpgw.ping-devops.com; routes /opensearch-mcp-server/mcp to the gateway.",
      gw: "Registers with the proxyToken from the Helm install; its PingOne OIDC client (Client Secret Basic) signs the user in on first contact.",
    },
    ariaLabel:
      "Archived agentless variant: no local agent — the client connects straight to the cluster ingress over HTTPS, the gateway's PingOne OIDC client signs the user in on first contact, then the gateway evaluates JIT policy and forwards the permitted call cluster-locally.",
    blurb:
      "ARCHIVED deployment variant. No local agent. The MCP client connects straight to the cluster ingress over HTTPS and authenticates with the gateway's PingOne OIDC client (authorization code flow); the console still pushes proxy configuration to the gateway.",
  },
  {
    id: "a2a",
    label: "Agent-to-agent",
    title: "Agent-to-agent through the gateway",
    status: "Recorded",
    checked: "Not checked against a cluster on this page",
    static: true,
    nodes: A2A_NODES,
    edges: A2A_EDGES,
    groups: A2A_GROUPS,
    steps: A2A_STEPS,
    stepDetail: STEPS_BY_TAB.a2a,
    details: A2A_DETAILS,
    ariaLabel:
      "Agent-to-agent through the gateway: a main agent calls its model and sends an A2A message through the gateway's agent route, which forwards to the worker agent. The worker calls its own model and tools through the gateway's model and tool routes on its own key. The gateway holds the real provider key and screens tool results before the worker's model reads them.",
    blurb:
      "Two agents and a tool server, with the Agent Privilege between every pair. Each agent holds only its own agent key; the gateway checks that key on every model call, agent-to-agent call and tool call, and holds the real provider key itself. A longer chain works the same way: Demo Step 26 runs main agent, LangChain agent and a specialist, with the gateway between each pair.",
  },
];


const BANNER = (
  <>
    <strong>Drawings, not telemetry.</strong> Every diagram on this page is a hand-placed illustration of the
    documented topology. Simulate steps through its arrows as a teaching aid and sends nothing. The live
    load-balancer drawing was checked against the SE cluster on 2026-10-12 and is not re-read when the page
    loads. <strong>Real:</strong> the HAProxy stats frame and the runtime controls under the live drawing call
    this app&apos;s admin API and need an admin PingOne sign-in; Park and Unpark change the live load balancer.
  </>
);

// Every tab is a static React Flow graph (the Mermaid renderer is gone); the TABS entry owns its
// NODES / EDGES / GROUPS / stepDetail / details. No block comment sits in the JSX below: the pattern check's
// comment stripper would pair its end with the "/llm/*" in a string above and hide the page body.
export default function PrivilegeGatewayTopologyPage() {
  const [activeTab, setActiveTab] = useState("lb");

  const activeTabMeta = TABS.find((t) => t.id === activeTab);
  const live = activeTabMeta.id === "lb";
  const archived = activeTabMeta.status === "Archived";

  return (
    <PingPage className="pgt-page" data-testid="pgt-page">
      <SimBanner data-testid="pgt-banner">{BANNER}</SimBanner>
      <PageHeader eyebrow="PingOne Privilege · MCP Gateway" title="Privilege Gateway Topologies" summary={<>The live load-balanced mcpgw topology as deployed on the SE cluster, plus
          the two deployment variants from the instructional demo setup and the
          agent-to-agent layout, with the
          request flow numbered in order. Dashed lines are control-plane
          configuration; solid lines are the data path. Guillemets (‹ ›) mark
          values you substitute.</>}>
        <a
          className="pu-btn pu-btn--primary pgt-doc-link"
          href="https://pingidentity.atlassian.net/wiki/x/SwDRwg"
          target="_blank"
          rel="noreferrer"
          aria-label="Setup guide: PingOne Privilege MCP Gateway — Instructional Demo Setup (opens in a new tab)"
        >
          Setup guide: PingOne Privilege MCP Gateway — Instructional Demo Setup <span aria-hidden="true">&#8599;</span>
        </a>
      </PageHeader>

      <PageFrame>
        <Section id="pgt-topology" kicker="1 · Drawing" title={activeTabMeta.title} lede={activeTabMeta.blurb}>
          <div className="pgt-tabs" role="group" aria-label="Topology variant">
            {TABS.map((tab) => (
              <TabButton key={tab.id} selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </TabButton>
            ))}
          </div>

          {archived && (
            <Card tone="warn" className="pgt-archived" data-testid="pgt-archived">
              <p className="pu-status-line">
                <StatusChip tone="warn">Archived</StatusChip>
                <span>
                  <strong>This deployment variant is archived.</strong> See{" "}
                  <a href="/privilege-first-gateway">Privilege first, Agent Gateway for the rest</a>{" "}
                  for the current Privilege Agentic App gateway content, including the settled backend-hop
                  Auth Mode findings.
                </span>
              </p>
            </Card>
          )}

          <ul className="pgt-legend">
            {[...new Set(activeTabMeta.nodes.map((n) => n.group))].map((g) => (
              <li key={g}>
                <span className={`pgt-swatch pgt-swatch--${SWATCH[activeTabMeta.groups[g].bg]}`} aria-hidden="true" />
                {activeTabMeta.groups[g].label}
              </li>
            ))}
          </ul>
          <StaticFlowDiagram
            NODES={activeTabMeta.nodes}
            EDGES={activeTabMeta.edges}
            GROUPS={activeTabMeta.groups}
            pingStyle
            steps={activeTabMeta.stepDetail}
            details={activeTabMeta.details}
            testId={`pgt-${activeTabMeta.id}-diagram`}
            ariaLabel={activeTabMeta.ariaLabel}
          />
          <Card tone="neutral" title="About this drawing" className="pgt-about">
            <p className="pu-status-line">
              <StatusChip tone="neutral">Illustration</StatusChip>
              <StatusChip tone={archived ? "warn" : activeTabMeta.clusterChecked ? "ok" : "neutral"}>{activeTabMeta.status}</StatusChip>
            </p>
            <KvList
              items={[
                { label: "Boxes", value: String(activeTabMeta.nodes.length) },
                { label: "Arrows", value: String(activeTabMeta.edges.length) },
                { label: "Checked", value: activeTabMeta.checked },
              ]}
            />
          </Card>
        </Section>

        {live && (
          <Section
            id="pgt-live"
            kicker="2 · Real load balancer"
            title="Live load balancer state"
            lede="These two panels are not drawings: they call this app's admin API against the SE load balancer pods."
          >
            <LbRuntimePanel />
            <LbStatsPanel />
          </Section>
        )}

        <Section id="pgt-flow" kicker={`${live ? 3 : 2} · Request flow`} title="Numbered steps">
          <Card tone="neutral">
            <ol className="pgt-steps">
              {(activeTabMeta?.steps || []).map((step, i) =>
                step.heading ? (
                  <li key={`h-${i}`} className="pgt-steps__heading">
                    {step.heading}
                  </li>
                ) : (
                  <li key={step.n ?? `note-${i}`}>
                    <span className={`pgt-steps__n${step.n ? "" : " pgt-steps__n--note"}`}>{step.n ?? "i"}</span>
                    <span>{step.text}</span>
                  </li>
                ),
              )}
            </ol>
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// A selector (secondary, never primary): aria-pressed carries the state; the page sheet draws the check mark.
function TabButton({ selected, onClick, children }) {
  return (
    <button type="button" className="pu-btn" aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

// HAProxy's own stats page (/lb-stats on the public LB frontend, read-only),
// served to the iframe THROUGH the admin-gated BFF proxy
// /api/admin/lb/runtime/stats-view: the demo's PingOne sign-in is the gate,
// and the stats credential never reaches the browser. No build-time gate:
// when the BFF lacks the stats env the proxy itself answers 503 with the
// variable names — that is the configuration signal, not this panel.
// The frame is always rendered: signed out, or without the stats env, it shows
// the BFF's own refusal, which is why the card says so instead of claiming a live view.
function LbStatsPanel() {
  return (
    <Card tone="live" title="Live LB stats" data-testid="pgt-stats">
      <p className="pu-status-line">
        <StatusChip tone="info">Live, admin only</StatusChip>
        <span>Real HAProxy page, not a drawing.</span>
      </p>
      <p className="pu-note pgt-hint">
        HAProxy&apos;s built-in stats page for <code>mcpgw-lb</code> — node health,
        sessions and traffic per gateway node, refreshed every 5s. Admin sign-in
        (PingOne) is the only prompt; no separate stats password. Signed out, or
        when the admin API has no stats configuration, the frame shows its refusal
        instead of the page.
      </p>
      <iframe
        title="HAProxy LB stats"
        src="/api/admin/lb/runtime/stats-view"
        className="pgt-stats__frame"
      />
    </Card>
  );
}

// Runtime park/unpark over HAProxy's runtime API, applied to BOTH LB pods by
// the admin route (mounted authenticateToken + requireAdmin in server.js).
// Runtime-only: park state resets when the LB pods roll — persistent parking
// still goes through gateway1-lb.values.yaml. Unpark keeps the chart's
// rise-60 hold-out: the node takes clients again after ~10 minutes of passing
// checks, same as today's helm path.
function LbRuntimePanel() {
  const [state, setState] = useState(null); // {nodes, errors} | "denied"
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null); // { tone, word, text } | null
  // A read that failed for a reason other than sign-in (500, network). The last good nodes stay on screen.
  const [readError, setReadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/admin/lb/runtime");
      setState(res.data);
      setReadError(null);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        setState("denied");
        setReadError(null);
      } else {
        setReadError(status ? `HTTP ${status}` : (e?.message || "request failed"));
      }
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (state === "denied") {
    return (
      <Card tone="neutral" title="LB runtime controls" className="pgt-runtime">
        <p className="pu-status-line">
          <StatusChip tone="warn">Admin sign-in needed</StatusChip>
          <span>Nothing is shown here until an admin session can read the load balancer.</span>
        </p>
        <p className="pu-note pgt-hint">Sign in as an admin to see live node state and park or unpark a gateway.</p>
      </Card>
    );
  }

  // A disabled button would drop keyboard focus to the page while the call runs, so the row
  // buttons stay focusable (aria-disabled) and ignore the press until the call is done.
  const act = async (node, action) => {
    if (busy) return;
    setBusy(node + action);
    setNotice(null);
    try {
      await apiClient.post(`/api/admin/lb/runtime/${node}/${action}`);
      setNotice({
        tone: "ok",
        word: "Done",
        text: action === "park"
          ? `${node} parked — its clients move within one 10s health sample.`
          : `${node} enabled — it re-enters rotation after the ~10-minute rise-60 hold-out.`,
      });
      await load();
    } catch (e) {
      setNotice({ tone: "danger", word: "Failed", text: `${node} ${action} failed: ${e?.response?.data?.error || e.message}` });
    } finally {
      setBusy("");
    }
  };

  const nodes = state?.nodes || [];
  const errors = state?.errors || [];
  return (
    <Card tone={state ? "live" : "neutral"} title="LB runtime controls" className="pgt-runtime">
      <p className="pu-status-line">
        {readError
          ? <StatusChip tone="danger">Unavailable</StatusChip>
          : state ? <StatusChip tone="info">Live, admin only</StatusChip> : <StatusChip tone="neutral">Checking</StatusChip>}
        <span>{readError
          ? `Could not read the load balancer (${readError}). ${state ? "Showing the last nodes it reported; " : ""}retrying every 10s.`
          : state ? "Node state read from the load balancer pods every 10s. Park and Unpark change the live load balancer." : "Reading node state from the load balancer."}</span>
      </p>
      <p className="pu-note pgt-hint">
        Runtime-only — resets when the LB pods roll; persistent parking still goes
        through <code>gateway1-lb.values.yaml</code>. Unpark keeps the ~10-minute
        hold-out.
        {errors.length > 0 && <span className="pgt-runtime__err"> {errors.length} pod{errors.length > 1 ? "s" : ""} unreachable — shown values may be one pod only.</span>}
      </p>
      <div role="status" aria-live="polite" data-testid="pgt-runtime-notice">
        {notice && (
          <p className="pu-status-line">
            <StatusChip tone={notice.tone}>{notice.word}</StatusChip>
            <span>{notice.text}</span>
          </p>
        )}
      </div>
      {state && nodes.length === 0 && <p className="pu-empty pu-note">The load balancer reported no nodes.</p>}
      <ul className="pgt-runtime__list">
        {nodes.map((n) => {
          const up = n.status === "UP";
          const action = up ? "park" : "unpark";
          return (
            <li key={n.name} className="pgt-runtime__row">
              <code>{n.name}</code>
              <StatusChip tone={up ? "ok" : n.status === "MAINT" ? "warn" : "danger"}>{n.status || "UNKNOWN"}</StatusChip>
              <span className="pgt-runtime__sess">{n.sessions} session{n.sessions === 1 ? "" : "s"}</span>
              <button
                type="button"
                className="pu-btn"
                aria-disabled={busy ? "true" : undefined}
                aria-label={`${up ? "Park" : "Unpark"} ${n.name}`}
                onClick={() => act(n.name, action)}
              >
                {up ? "Park" : "Unpark"}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
