// PrivilegeGatewayTopologyPage.jsx — The two PingOne Privilege MCP Gateway
// deployment variants (agent-based, agentless) from the SE instructional demo
// setup doc, rendered via Mermaid with the request flow numbered step by step.
// Follows the PrivilegeMcpDiagramPage tab/render/export conventions.
import React, { useEffect, useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import FlowDiagram from "./FlowDiagram";
import StaticFlowDiagram from "./StaticFlowDiagram";
import "./PrivilegeMcpDiagramPage.css";
import "./PrivilegeGatewayTopologyPage.css";
import "./McpGatewayOauthFlowPage.css";

const AGENT_SOURCE = `flowchart LR
    subgraph cloud["Priv Cloud"]
        console["Priv Cloud Controller<br/>(Console)"]
        proxy["Public Proxy<br/>proxy-us-west-2.privilege.pingone.com:443"]
    end

    subgraph device["User Device"]
        client["MCP Client<br/>(Postman, IDE, agent app)"]
        agent["Priv Agent<br/>https://opensearch.default.applications.procyon.ai:8643/sse"]
    end

    subgraph k8s["K8s cluster — ‹you›-ping-devops"]
        gw["MCP Gateway<br/>http://mcpgw.‹namespace›.svc.cluster.local:8680"]
        mcp["MCP Server<br/>http://‹release›-opensearch-mcp-server.‹namespace›.svc.cluster.local/sse"]
    end

    console <-.- s1(("1")) -. "config sync<br/>(gateway registered via ENV_PROXY_TOKEN)" .-> proxy
    console -.- s2(("2")) -. "gRPC: proxy config<br/>(agent installed via onboarding magic link)" .-> agent
    gw --- s3(("3")) -- "standing outbound link, TLS :443<br/>(Priv wants gateway on 8680;<br/>ingress only allows 443)" --> proxy
    client --- s4(("4")) -- "MCP request<br/>HTTPS :8643 /sse" --> agent
    agent --- s5(("5")) -- "TLS tunnel :443" --> proxy
    proxy --- s6(("6")) -- "rides the link from 3<br/>JIT policy evaluated at gateway" --> gw
    gw --- s7(("7")) -- "permitted tool call<br/>HTTP /sse, cluster-local" --> mcp

    classDef cloudN fill:#f5d4d5,stroke:#b3282d,color:#4a1113
    classDef deviceN fill:#d5e2f2,stroke:#3d6ea5,color:#16324f
    classDef k8sN fill:#d2ecdf,stroke:#2e8b6a,color:#123f2f
    classDef mcpN fill:#e3dbf3,stroke:#6b4fa5,color:#2c1d4f
    classDef stepN fill:#b3282d,stroke:#e4636a,color:#ffffff,font-size:20px,font-weight:bold
    class console,proxy cloudN
    class client,agent deviceN
    class gw k8sN
    class mcp mcpN
    class s1,s2,s3,s4,s5,s6,s7 stepN
    style cloud fill:#b3282d14,stroke:#b3282d80
    style device fill:#3d6ea514,stroke:#3d6ea580
    style k8s fill:#2e8b6a12,stroke:#2e8b6a80`;

const AGENTLESS_SOURCE = `flowchart LR
    subgraph cloud["Priv Cloud"]
        console["Priv Cloud Controller<br/>(Console)"]
    end

    subgraph device["User Device"]
        client["MCP Client<br/>(Postman, IDE, agent app)"]
    end

    subgraph k8s["K8s cluster — ‹you›-ping-devops"]
        ingress["Ingress<br/>https://‹you›-agentless-mcpgw.ping-devops.com:443<br/>/opensearch-mcp-server/mcp"]
        gw["MCP Gateway<br/>http://mcpgw.‹namespace›.svc.cluster.local:8680"]
        mcp["MCP Server<br/>http://opensearch-mcp-server.‹namespace›.svc.cluster.local/sse"]
    end

    console -.- s1(("1")) -. "gRPC: proxy config<br/>(proxyToken from Helm install)" .-> gw
    client --- s2(("2")) -- "HTTPS :443 + OIDC auth code<br/>auth.pingone.com/‹env-id›/as/authorize<br/>redirect: gateway DNS /callback" --> ingress
    ingress --- s3(("3")) -- "route to gateway :8680<br/>JIT policy evaluated" --> gw
    gw --- s4(("4")) -- "permitted tool call<br/>HTTP /sse, cluster-local" --> mcp

    classDef cloudN fill:#f5d4d5,stroke:#b3282d,color:#4a1113
    classDef deviceN fill:#d5e2f2,stroke:#3d6ea5,color:#16324f
    classDef k8sN fill:#d2ecdf,stroke:#2e8b6a,color:#123f2f
    classDef mcpN fill:#e3dbf3,stroke:#6b4fa5,color:#2c1d4f
    classDef stepN fill:#b3282d,stroke:#e4636a,color:#ffffff,font-size:20px,font-weight:bold
    class console cloudN
    class client deviceN
    class ingress,gw k8sN
    class mcp mcpN
    class s1,s2,s3,s4 stepN
    style cloud fill:#b3282d14,stroke:#b3282d80
    style device fill:#3d6ea514,stroke:#3d6ea580
    style k8s fill:#2e8b6a12,stroke:#2e8b6a80`;

// Step numbers ride on the arrows here, not on separate badge nodes: the badges
// widened the layout past the panel, so the whole diagram was scaled down to
// about two-thirds and its labels became hard to read.
const A2A_SOURCE = `flowchart TB
    console["Priv Cloud console"]
    main["Main agent<br/>User device"]

    subgraph k8s["K8s cluster"]
        subgraph gw["Agent Privilege"]
            gwA2A["Agent route<br/>/‹worker-app›/a2a"]
            gwLLM["Model route<br/>/llm/‹provider›"]
            gwMCP["Tool route<br/>/‹mcp-app›/mcp"]
        end
        worker["Worker agent"]
        mcp["MCP server"]
    end

    model["Model provider<br/>Google, Anthropic or OpenAI"]

    console -. "1 · config" .-> gwA2A
    main -- "3 · A2A message" --> gwA2A
    main -- "2 · model call" --> gwLLM
    gwA2A -- "4 · forwarded" --> worker
    worker -- "5 · model call" --> gwLLM
    worker -- "6 · tool call" --> gwMCP
    gwMCP -- "7 · screened" --> mcp
    gwLLM -- "8 · provider key" --> model

    classDef cloudN fill:#f5d4d5,stroke:#b3282d,color:#4a1113
    classDef deviceN fill:#d5e2f2,stroke:#3d6ea5,color:#16324f
    classDef k8sN fill:#d2ecdf,stroke:#2e8b6a,color:#123f2f
    classDef mcpN fill:#e3dbf3,stroke:#6b4fa5,color:#2c1d4f
    class console,model cloudN
    class main deviceN
    class gwA2A,gwLLM,gwMCP,worker k8sN
    class mcp mcpN
    style k8s fill:#2e8b6a12,stroke:#2e8b6a80
    style gw fill:#2e8b6a22,stroke:#2e8b6a`;

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

// Live mcpgw load-balanced topology (verified on the SE cluster 2026-10-12: LB pods run
// haproxy:3.0-alpine; privilege/GATEWAY-LOAD-BALANCER.md §00/§00a, CURRENT-CONFIGURATION.md).
// Static hand-placed layout, drawn with StaticFlowDiagram (React Flow) like
// PrivilegeFirstGatewayPage — the Mermaid-source tabs above are archived content.
const LB_GROUPS = {
  client: { label: "Clients", bg: "var(--th-status-info)" },
  lb: { label: "Load balancer", bg: "var(--th-status-error)" },
  gw: { label: "Agent Privilege — mesh cluster ai-demo-cmuir", bg: "var(--th-status-success-border)" },
  state: { label: "Shared state", bg: "var(--th-status-warning)" },
  door: { label: "Agentic App doors", bg: "var(--th-status-info)" },
  backend: { label: "Backends", bg: "var(--th-text-muted)" },
};
export const LB_NODES = [
  { id: "client", group: "client", label: "MCP clients / browser", sub: ["LM Studio · demo Privilege page", "https://mcpgw.ai-demo.ping-devops.com/<App>/mcp"], x: 0, y: 20 },
  { id: "ingress", group: "lb", label: "nginx-public ingress", sub: ["TLS :443 → mcpgw-lb :8623"], x: 330, y: 20 },
  { id: "lb", group: "lb", label: "mcpgw-lb ×2 · HAProxy 3.0", sub: ["balance hdr(X-Forwarded-For)", "hash-type consistent → one node per client", "health GET / every 10s · fall 2 / rise 60", "X-Served-By: gateway-N"], x: 660, y: 20 },
  { id: "redis", group: "state", label: "privilege-redis", sub: ["shared client registry — tokens are NOT shared"], x: 660, y: 240 },
  { id: "gw1", group: "gw", label: "gateway-1", sub: ["agentless-mcpgw · curtismuir", ":8623 https · 9/9 sidecars"], x: 330, y: 460 },
  { id: "gw2", group: "gw", label: "gateway-2", sub: ["agentless-mcpgw2 · cmuir", ":8623 http · sidecars"], x: 660, y: 460 },
  { id: "gw3", group: "gw", label: "gateway-3", sub: ["agentless-mcpgw3 · curtismuir", ":8623 http · sidecars"], x: 990, y: 460 },
  { id: "d-ose22", group: "door", label: "opensearch22", sub: ["always-200 fixture (time-boxed policy)"], x: 0, y: 700 },
  { id: "d-ose", group: "door", label: "opensearch", sub: ["policy off → always-403 deny twin"], x: 240, y: 700 },
  { id: "d-agg", group: "door", label: "aggregate", sub: ["opensearch + banking tools"], x: 480, y: 700 },
  { id: "d-hostile", group: "door", label: "hostile-mcp", sub: ["deliberate attack surface"], x: 720, y: 700 },
  { id: "d-agentgw", group: "door", label: "agent-gateway", sub: ["real PingGateway backend"], x: 960, y: 700 },
  { id: "d-side", group: "door", label: "sidecar doors", sub: ["mcp-brave-search · mcp-grafana", "openapi2 · pingone-mcp"], x: 1200, y: 700 },
  { id: "b-ose", group: "backend", label: "opensearch-mcp-server", sub: ["svc · curtismuir /mcp"], x: 120, y: 920 },
  { id: "b-pg", group: "backend", label: "ping-gateway", sub: ["real PingGateway · cmuir :8080"], x: 900, y: 920 },
  { id: "b-host", group: "backend", label: "hostile-mcp-server", sub: ["Deployment · :8899 → /mcp"], x: 1140, y: 920 },
  { id: "b-side", group: "backend", label: "sidecars (per gateway pod)", sub: ["brave :8084 · grafana :8081 · banking-rest :8082", "pingone :8083 · openapi-banking :8080 · promptguard :8086"], x: 400, y: 920 },
];
export const LB_EDGES = [
  ["client", "ingress", "HTTPS", {}],
  ["ingress", "lb", ":8623", {}],
  ["lb", "gw1", "hash pin", {}],
  ["lb", "gw2", "hash pin", {}],
  ["lb", "gw3", "hash pin", {}],
  ["gw1", "redis", "registry", { dashed: true }],
  ["gw2", "redis", "registry", { dashed: true }],
  ["gw3", "redis", "registry", { dashed: true }],
  ["gw2", "d-ose22", "any node serves any app", { dashed: true }],
  ["d-ose22", "b-ose", "", { vertical: true }],
  ["d-ose", "b-ose", "", { vertical: true }],
  ["d-agg", "b-side", "", { vertical: true }],
  ["d-side", "b-side", "", { vertical: true }],
  ["d-agentgw", "b-pg", "", { vertical: true }],
  ["d-hostile", "b-host", "", { vertical: true }],
];
const LB_STEPS = [
  { heading: "Request path — every call" },
  { n: 1, text: "The client calls https://mcpgw.ai-demo.ping-devops.com/<App>/mcp. The nginx-public ingress terminates TLS and routes to Service mcpgw-lb on :8623." },
  { n: 2, text: "One of two HAProxy pods answers. balance hdr(X-Forwarded-For) with hash-type consistent pins every request from one client address to the same gateway node — no stick table, both pods hash and probe identically. Every response carries X-Served-By: gateway-N, which is how the demo proves who answered." },
  { n: 3, text: "The pinned gateway node evaluates the Agentic App's JIT policy (allowed tools, users, time window) and forwards the permitted call. All three nodes belong to mesh cluster ai-demo-cmuir, so an app is registered once and any node can reach any backend — sidecars on its own pod's localhost, or cross-namespace Services." },
  { n: 4, text: "A response returns with X-Served-By naming the node that served it." },
  { heading: "Failover — what a switch costs" },
  { n: 5, text: "Health checks run every 10s (any 2xx–4xx counts as up; the gateway answers 401 to a bare GET /). When a node dies its clients move within one 10s sample — but their tokens were minted by the dead node, so they sign in again. Registrations survive via shared Redis; tokens do not." },
  { n: 6, text: "A recovered node needs 60 consecutive passing checks (rise 60 × 10s ≈ 10 minutes) before it takes clients back. That window answers 503 node=<NOSRV> and looks like a total outage while every gateway is actually fine — wait it out; do not restart a gateway to 'fix' it." },
];
const LB_WALK = [
  { title: "Client request", label: "step 1", nodes: ["client", "ingress"], edges: [0], lines: ["HTTPS to the public door; the ingress terminates TLS and forwards to mcpgw-lb :8623."] },
  { title: "Consistent-hash pin", label: "step 2", nodes: ["lb", "gw1", "gw2", "gw3"], edges: [1, 2, 3, 4], lines: ["HAProxy hashes X-Forwarded-For; the same client always lands on the same node. X-Served-By names the winner."] },
  { title: "JIT policy + app call", label: "step 3", nodes: ["gw1", "d-ose22"], edges: [8], lines: ["The pinned node checks the app's policy, then reaches the backend — any node can serve any app on the shared cluster."] },
  { title: "Backend answer", label: "step 4", nodes: ["d-ose22", "b-ose"], edges: [9], lines: ["The permitted call reaches opensearch-mcp-server cluster-locally; the result returns with X-Served-By on it."] },
  { title: "Shared registry", label: "step 5", nodes: ["redis", "gw1", "gw2", "gw3"], edges: [5, 6, 7], lines: ["Both/all nodes read registrations from one Redis, so a client registered once is known everywhere — but tokens are not shared, so a failover still costs a sign-in."] },
];
const LB_DETAILS = {
  lb: "Two replicas on separate hosts (topologySpread). Engine is haproxy in the live cluster even though gateway1-lb.values.yaml still says engine: nginx — swapped after PR #1022 deployed.",
  gw1: "Owns the HTTPS front door certificate name; 9/9 containers: gateway + 8 sidecars.",
  gw2: "Re-enrolled into cluster ai-demo-cmuir on 2026-10-04; serves plain HTTP because its OAuth URL does not match its own certificate.",
  gw3: "Third node, same namespace as gateway-1; main container request trimmed to 250m so the SE cluster can still schedule it.",
  redis: "One pod, 1Gi AOF, password-only TLS-less in-cluster. Hard dependency: a gateway restart with Redis down exits after 6 attempts.",
  "d-ose22": "Deliberate known-good door: 3-month policy time-box. When it 403s, that is renewal coming due, not a regression.",
  "d-ose": "Deliberate known-deny door: no policy attached, always 403. Enforcement is real; do not 'fix' it.",
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
  { n: 2, text: "Client calls https://‹you›-agentless-mcpgw.ping-devops.com/opensearch-mcp-server/mcp over HTTPS 443. On first contact the gateway's PingOne OIDC client runs the authorization-code sign-in (Client Secret Basic) against https://auth.pingone.com/‹env-id›/as/authorize, exchanges the code at /as/token, and reads identity from /as/userinfo; the redirect URI is the gateway DNS + /callback." },
  { n: 3, text: "Ingress routes to the gateway service on 8680, which evaluates the JIT policy (Agentic Apps > opensearch-mcp-server > Policy: allowed tools, users, time window) against the signed-in PingOne user." },
  { n: 4, text: "Gateway forwards the permitted tool call over cluster-local HTTP to http://opensearch-mcp-server.‹namespace›.svc.cluster.local/sse; denied calls stop at step 3." },
];

export const TABS = [
  {
    id: "lb",
    label: "Live LB topology",
    static: true,
    steps: LB_STEPS,
    walk: LB_WALK,
    details: LB_DETAILS,
    blurb:
      "How the demo's one public mcpgw URL is served today: two HAProxy pods pin each client to one of three gateway nodes of mesh cluster ai-demo-cmuir, and every Agentic App door behind them. Verified live on the SE cluster 2026-10-12.",
  },
  {
    id: "agent",
    label: "Agent-based",
    source: AGENT_SOURCE,
    filename: "privilege-gateway-agent-topology.mmd",
    steps: AGENT_STEPS,
    blurb:
      "The MCP client talks to a local Priv Agent, which tunnels out to the Privilege public proxy. The in-cluster gateway also dials out to that proxy — Privilege expects the gateway on 8680 and the cluster ingress only carries 443, so no traffic enters the cluster directly.",
  },
  {
    id: "agentless",
    label: "Agentless",
    source: AGENTLESS_SOURCE,
    filename: "privilege-gateway-agentless-topology.mmd",
    steps: AGENTLESS_STEPS,
    blurb:
      "No local agent. The MCP client connects straight to the cluster ingress over HTTPS and authenticates with the gateway's PingOne OIDC client (authorization code flow); the console still pushes proxy configuration to the gateway.",
  },
  {
    id: "a2a",
    label: "Agent-to-agent",
    source: A2A_SOURCE,
    filename: "privilege-gateway-a2a-topology.mmd",
    steps: A2A_STEPS,
    blurb:
      "Two agents and a tool server, with the Agent Privilege between every pair. Each agent holds only its own agent key; the gateway checks that key on every model call, agent-to-agent call and tool call, and holds the real provider key itself. A longer chain works the same way: Demo Step 26 runs main agent, LangChain agent and a specialist, with the gateway between each pair.",
  },
];

export const SEQUENCE_SOURCE = `sequenceDiagram
    autonumber
    box rgb(240,240,255) Agent-based — local Priv Agent tunnels out
    participant Client
    participant Agent as Priv Agent (local)
    participant Proxy as Privilege public proxy
    participant GW as MCP Gateway (in-cluster)
    participant MCP as MCP Server
    end

    Note over Proxy,GW: setup, once: console/proxy config sync,<br/>agent installed via magic link, gateway dials<br/>out — standing TLS link on 443
    Client->>Agent: MCP request, HTTPS :8643/sse
    Agent->>Proxy: TLS tunnel :443
    Proxy->>GW: rides the standing link from setup
    GW->>GW: evaluate JIT policy<br/>(Agentic Apps > Policy)
    alt permitted
        GW->>MCP: cluster-local HTTP /sse
        MCP-->>GW: result
        GW-->>Proxy: result
        Proxy-->>Agent: result
        Agent-->>Client: result
    else denied
        GW-->>Proxy: denied at step 6
    end

    box rgb(255,245,235) Agentless — client connects straight to ingress
    participant Client2 as Client
    participant ING as Ingress
    participant GW2 as MCP Gateway (in-cluster)
    participant P1 as PingOne AS
    participant MCP2 as MCP Server
    end

    Note over ING,GW2: setup, once: console pushes proxy config<br/>to gateway over gRPC (proxyToken from Helm install)
    Client2->>ING: HTTPS :443 request
    ING->>P1: first contact: authorization-code<br/>sign-in (Client Secret Basic)
    P1-->>ING: identity (userinfo)
    ING->>GW2: route to gateway :8680
    GW2->>GW2: evaluate JIT policy against<br/>signed-in PingOne user
    alt permitted
        GW2->>MCP2: cluster-local HTTP /sse
        MCP2-->>GW2: result
        GW2-->>ING: result
        ING-->>Client2: result
    else denied
        GW2-->>ING: denied at step 3
    end`;

const SEQUENCE_NOTES = [
  {
    title: "Agent-based — local agent tunnels out",
    items: [
      { text: "The MCP client never leaves the device — it talks to the local Priv Agent's frontend, which tunnels everything out over a standing TLS link the gateway itself dialed to the public proxy." },
      { text: "Nothing connects inbound to the cluster: the gateway wants port 8680, but the cluster ingress only carries 443, so the gateway reaches out instead of being reached." },
      { text: "JIT policy is evaluated at the gateway once the request rides back down the standing link from the proxy." },
    ],
  },
  {
    title: "Agentless — direct ingress + OIDC",
    items: [
      { text: "No local agent — the client connects straight to the cluster ingress over HTTPS." },
      { text: "On first contact, the gateway's own PingOne OIDC client runs an authorization-code sign-in — this identity check happens inline, before the request ever reaches the JIT policy step." },
      { text: "The console still pushes proxy configuration to the gateway over gRPC, but there is no public proxy or tunnel in the data path — the client's traffic terminates at the cluster ingress directly." },
    ],
  },
  {
    title: "Key difference",
    items: [
      { text: "Both variants converge on the same JIT policy check and the same cluster-local hop to the MCP server — what differs is how the client's identity and traffic reach the gateway: a locally-installed agent tunneling out, or a direct OIDC sign-in against the ingress." },
    ],
  },
];

const LEGEND = [
  { className: "pgt-swatch--cloud", label: "Priv Cloud" },
  { className: "pgt-swatch--device", label: "User Device" },
  { className: "pgt-swatch--k8s", label: "K8s cluster" },
  { className: "pgt-swatch--mcp", label: "MCP server (destination)" },
  { className: "pgt-swatch--step", label: "step number" },
];


export default function PrivilegeGatewayTopologyPage() {
  const [activeTab, setActiveTab] = useState("lb");
  const [source, setSource] = useState(AGENT_SOURCE);
  const [seqSource, setSeqSource] = useState(SEQUENCE_SOURCE);

  useEffect(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    if (tab && tab.source) setSource(tab.source);
  }, [activeTab]);

  const activeTabMeta = TABS.find((t) => t.id === activeTab);
  const isStatic = Boolean(activeTabMeta?.static);

  return (
    <>
    <div className="pmd-page pgt-page">
      {!isStatic && (
      <div className="pgt-archived">
        <strong>The Agent-based and Agentless tabs are archived.</strong> The Agent-to-agent tab is current. See{" "}
        <a href="/privilege-first-gateway">Privilege first, Agent Gateway for the rest</a>{" "}
        for the current Privilege Agentic App gateway content, including the settled backend-hop
        Auth Mode findings.
      </div>
      )}
      <div className="pmd-hero">
        <span className="pmd-eyebrow">PingOne Privilege · MCP Gateway</span>
        <h1>Privilege Gateway Topologies</h1>
        <p className="pmd-sub">
          The live load-balanced mcpgw topology as deployed on the SE cluster, plus
          the two deployment variants from the instructional demo setup and the
          agent-to-agent layout, with the
          request flow numbered in order. Dashed lines are control-plane
          configuration; solid lines are the data path. Guillemets (‹ ›) mark
          values you substitute.
        </p>
        <a
          className="pmd-link pgt-doc-link"
          href="https://pingidentity.atlassian.net/wiki/x/SwDRwg"
          target="_blank"
          rel="noreferrer"
        >
          Setup guide: PingOne Privilege MCP Gateway — Instructional Demo Setup
        </a>
      </div>

      <div className="pmd-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`pmd-tab${activeTab === tab.id ? " pmd-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <p className="pmd-sub pgt-blurb">{activeTabMeta?.blurb}</p>

      {isStatic ? (
        <>
          <ul className="pgt-legend">
            <li><span className="pgt-swatch pgt-swatch--lb" />load balancer / ingress</li>
            <li><span className="pgt-swatch pgt-swatch--gw" />gateway nodes (one mesh cluster)</li>
            <li><span className="pgt-swatch pgt-swatch--door" />Agentic App doors</li>
            <li><span className="pgt-swatch pgt-swatch--state" />shared state</li>
            <li><span className="pgt-swatch pgt-swatch--mcp" />backends</li>
          </ul>
          <StaticFlowDiagram
            NODES={LB_NODES}
            EDGES={LB_EDGES}
            GROUPS={LB_GROUPS}
            walk={LB_WALK}
            details={LB_DETAILS}
            testId="pgt-lb-diagram"
            ariaLabel="Live mcpgw load-balanced topology: MCP clients reach an nginx ingress, then two HAProxy load-balancer pods, which pin each client by a consistent hash to one of three gateway nodes in mesh cluster ai-demo-cmuir. The nodes share a Redis client registry and serve the Agentic App doors opensearch22, opensearch, aggregate, hostile-mcp, agent-gateway and the sidecar doors, which reach the OpenSearch MCP server, PingGateway, hostile-mcp-server and per-pod sidecars."
          />
        </>
      ) : (
        <>
      <ul className="pgt-legend">
        {LEGEND.map((item) => (
          <li key={item.label}>
            <span className={`pgt-swatch ${item.className}`} />
            {item.label}
          </li>
        ))}
      </ul>

      <DiagramExportBar
        source={source}
        sourceFilename={activeTabMeta?.filename || "privilege-gateway-topology.mmd"}
        onSourceChange={setSource}
      />
      <div className="pmd-panel">
        <FlowDiagram source={source} label="Privilege gateway topology diagram" height={640} />
      </div>
        </>
      )}

      <ol className="pgt-steps">
        {(activeTabMeta?.steps || []).map((step, i) =>
          step.heading ? (
            <li key={`h-${i}`} className="pgt-steps__heading">
              {step.heading}
            </li>
          ) : (
            <li key={step.n}>
              <span className="pgt-steps__n">{step.n}</span>
              <span>{step.text}</span>
            </li>
          ),
        )}
      </ol>

      {!isStatic && (
      <p className="pmd-footer">
        Source:{" "}
        <a
          className="pmd-link"
          href="https://pingidentity.atlassian.net/wiki/x/SwDRwg"
          target="_blank"
          rel="noreferrer"
        >
          PingOne Privilege MCP Gateway: Instructional Demo Setup
        </a>{" "}
        (SE Confluence), Figures 1–2. Both variants end at the same OpenSearch
        MCP server; what changes is how the client's identity and traffic reach
        the gateway. Pick one variant per Helm release — never mix{" "}
        <code>privgateway</code> and <code>agentless-mcpgw</code> values.
      </p>
      )}
    </div>

    <div className="mgof-page">
      <div className="mgof-hero">
        <span className="mgof-eyebrow">PingOne Privilege · MCP Gateway</span>
        <h1>Request Flow: Agent-based vs Agentless</h1>
        <p className="mgof-sub">
          Same JIT policy check, same cluster-local hop to the MCP server — the two
          variants differ in how the client's identity and traffic reach the gateway.
          The left flow tunnels through a locally-installed Priv Agent; the right flow
          connects straight to the cluster ingress and signs in via PingOne OIDC.
        </p>
      </div>

      <DiagramExportBar
        source={seqSource}
        sourceFilename="privilege-gateway-request-flow.mmd"
        onSourceChange={setSeqSource}
      />

      <div className="mgof-panel">
        <FlowDiagram source={seqSource} label="Privilege gateway request flow sequence diagram" />
      </div>

      <div className="mgof-notes">
        {SEQUENCE_NOTES.map((group) => (
          <div className="mgof-note-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.items.map((item, idx) => (
                <li key={idx}>{item.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mgof-footer">
        Source:{" "}
        <a
          className="pmd-link"
          href="https://pingidentity.atlassian.net/wiki/x/SwDRwg"
          target="_blank"
          rel="noreferrer"
        >
          PingOne Privilege MCP Gateway: Instructional Demo Setup
        </a>{" "}
        (SE Confluence), same steps numbered in the topology diagrams above.
      </p>
    </div>
    </>
  );
}
