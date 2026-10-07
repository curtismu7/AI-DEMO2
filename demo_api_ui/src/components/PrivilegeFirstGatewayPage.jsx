// PrivilegeFirstGatewayPage.jsx — target architecture from
// docs/superpowers/plans/2026-09-08-privilege-first-gateway.md: the PingOne
// Privilege AI Gateway as the first hop for LLM and MCP traffic, the Agent
// Gateway behind it, and the identity fork the plan stops at. Both figures are
// React Flow graphs (StaticFlowDiagram) so they pan, zoom and step.
import React from "react";
import DiagramStepBar from "./DiagramStepBar";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import "./PrivilegeFirstGatewayPage.css";

const GROUPS = {
  caller: { label: "Callers", bg: "var(--th-border-strong)" },
  priv: { label: "Privilege AI Gateway", bg: "var(--th-status-error)" },
  ag: { label: "Agent Gateway", bg: "var(--th-status-info)" },
  server: { label: "MCP servers", bg: "var(--th-border-strong)" },
  ghost: { label: "Unchanged today", bg: "var(--th-text-muted)" },
};

const GATEWAY_NODES = [
  { id: "ext", group: "caller", label: "External MCP clients", sub: ["LM Studio, LibreChat MCP", "OAuth (DCR+PKCE) via doors"], x: 0, y: 20 },
  { id: "bff", group: "caller", label: "BFF chat", sub: ["demo-api-server :3001", "LangGraph agent, tool pipeline"], x: 0, y: 150 },
  { id: "side", group: "caller", label: "Sidecar agents", sub: ["ag-ui runtime", "LibreChat, agent-service :3006"], x: 0, y: 280 },
  { id: "proxy", group: "ghost", label: "llm-proxy :8090 · local models", sub: ["llama.cpp / MLX, no auth today", "outside Privilege, no lane (D2)"], x: 0, y: 440 },
  { id: "llm", group: "priv", label: "Privilege · LLM lane", sub: ["virtual keys, /llm/{provider}/v1", "provider key injected here", "model allow-list · usage caps"], x: 330, y: 70 },
  { id: "mcp", group: "priv", label: "Privilege · MCP lane", sub: ["Agentic App agent-gateway", "/agent-gateway/mcp (NEW)", "policy · approval · recording"], x: 330, y: 250 },
  { id: "cloud", group: "caller", label: "Cloud LLM providers", sub: ["OpenAI · Anthropic · Google", "Privilege holds the real key"], x: 660, y: 70 },
  { id: "ag", group: "ag", label: "Agent Gateway", sub: ["ping-gateway :8080 /mcp", "introspection · RFC 8693 · aud", "P1AZ per tool · D-05 · RAR"], x: 660, y: 250 },
  { id: "s1", group: "server", label: "mcp-server", sub: [":8080 banking"], x: 340, y: 440 },
  { id: "s2", group: "server", label: "resource-srv", sub: [":8081 invest"], x: 570, y: 440 },
  { id: "s3", group: "server", label: "mcp-weather", sub: [":8896"], x: 800, y: 440 },
  { id: "s4", group: "server", label: "mcp-brave", sub: [":8897"], x: 1030, y: 440 },
];
const SPIKE = { dashed: true, color: "var(--th-status-warning)" };
const GATEWAY_EDGES = [
  ["bff", "llm", "chat"],
  ["bff", "mcp", "tools/call"],
  ["side", "llm", "OpenAI lane by env"],
  ["ext", "mcp", "OAuth via façade doors"],
  ["side", "proxy", "local models", { dashed: true, vertical: true }],
  ["llm", "cloud", "real provider key"],
  ["mcp", "ag", "backend hop · Phase 0 decides", SPIKE],
  ["ag", "s1", "exchanged token, aud per server", { vertical: true }],
  ["ag", "s2", "", { vertical: true }],
  ["ag", "s3", "", { vertical: true }],
  ["ag", "s4", "", { vertical: true }],
];
const GATEWAY_CAPTIONS = edgeCaptions(GATEWAY_EDGES, Object.fromEntries(GATEWAY_NODES.map((n) => [n.id, n.label])));

const FORK_NODES = [
  { id: "pa", group: "priv", label: "Outcome A · Privilege", sub: ["bearer in: session token", "user token in: header"], x: 0, y: 20 },
  { id: "ga", group: "ag", label: "Agent Gateway sees", sub: ["sub = user · act = [privilege-bridge]", "header validated like a bearer", "banking:read: P1AZ decides, PERMIT", "Privilege shows in act chain + audit"], x: 330, y: 20 },
  { id: "pb", group: "priv", label: "Outcome B · Privilege", sub: ["bearer in: session token", "headers dropped"], x: 740, y: 20 },
  { id: "gb", group: "ag", label: "Agent Gateway sees", sub: ["sub = privilege-bridge · no user", "no exchange can mint banking:read", "banking tools: DENY, no user", "weather · brave · opensearch: PERMIT"], x: 1070, y: 20 },
];
const FORK_EDGES = [
  ["pa", "ga", "Bearer: bridge token + tx-token: user"],
  ["pb", "gb", "Bearer: bridge token (client_credentials)"],
];

const FLAGS = [
  {
    code: ["ff_privilege_llm_first"],
    text: "BFF chat: google → privilege_llm, anthropic → privilege_claude. Default off. Works locally and on SE.",
  },
  {
    code: ["AGENT_LLM_BASE_URL", "AGENT_LLM_API_KEY"],
    text: "Sidecar agents and LibreChat enter the Privilege OpenAI lane by env alone. No agent code changes.",
  },
  {
    code: ["ff_mcp_gateway_privilege_first"],
    text: "BFF MCP chokepoint routes to /agent-gateway/mcp on Privilege, checked before the PingOne Agent Gateway flag so the two compose. Default off. SE only.",
  },
];

export default function PrivilegeFirstGatewayPage() {
  const stepper = useDiagramStepper(GATEWAY_EDGES.length);
  return (
    <main className="pfg-page">
      <header className="pfg-hero">
        <div className="pfg-eyebrow">AI-DEMO2 · plan 2026-09-08</div>
        <h1>Privilege first, Agent Gateway for the rest</h1>
        <p>
          Every LLM call and every MCP tool call enters the PingOne Privilege AI Gateway before anything else.
          Privilege owns the credentials and the human-governed policy. The Agent Gateway behind it keeps doing the
          delegated, per-tool authorization it does today. Agent-to-agent calls take the same front door: each agent
          is a Remote Agent app on the gateway and is called with the caller&apos;s own agent key (see the
          Agent-to-agent tab on <a href="/privilege-gateway-topologies">Privilege Gateway Topologies</a>).
        </p>
      </header>

      <DiagramStepBar stepper={stepper} caption={GATEWAY_CAPTIONS[stepper.step]} />

      <figure className="pfg-figure">
        <StaticFlowDiagram
          NODES={GATEWAY_NODES}
          EDGES={GATEWAY_EDGES}
          GROUPS={GROUPS}
          stepper={stepper}
          testId="pfg-gateway-diagram"
          height={600}
          ariaLabel="Target architecture: callers on the left enter the Privilege AI Gateway, whose LLM lane goes to cloud providers with a virtual key and whose MCP lane goes to the Agent Gateway, which then reaches the MCP servers. Local models on port 8090 stay outside Privilege."
        />
        <div className="pfg-legend">
          <span><i className="pfg-sw" />request path, as planned</span>
          <span><i className="pfg-sw pfg-sw--spike" />the one hop the Phase 0 spike must measure</span>
          <span><i className="pfg-sw pfg-sw--ghost" />unchanged today, stays outside Privilege</span>
        </div>
        <figcaption>
          <strong>What moves.</strong> Today the BFF's chat goes vendor-direct and its tool calls go straight to the
          Agent Gateway; Privilege only serves the browser doors and two opt-in picker modes. In the target, the
          Privilege LLM lane becomes the default cloud path and the Agent Gateway becomes Privilege's registered
          backend, so the two gates compose instead of sitting side by side. SE cluster only for the MCP lane: the
          Privilege gateway pod must reach ping-gateway.ping-devops-cmuir.svc.cluster.local. The LLM lane already
          works from local Docker.
        </figcaption>
      </figure>

      <figure className="pfg-figure">
        <StaticFlowDiagram
          NODES={FORK_NODES}
          EDGES={FORK_EDGES}
          GROUPS={GROUPS}
          testId="pfg-fork-diagram"
          height={260}
          ariaLabel="The identity fork on the Privilege to Agent Gateway hop. Outcome A: Privilege forwards a subject token header, so the Agent Gateway sees the user with Privilege as an actor and banking tools can be permitted. Outcome B: only a machine token arrives, so the Agent Gateway sees the bridge client with no user and banking tools are denied while weather and brave are permitted."
        />
        <figcaption>
          <strong>The fork the plan stops at — settled 2026-09-10 as Outcome A.</strong> A live probe (throwaway
          Agentic App on Auth Mode None, pointed at a disposable header-logging backend) confirmed it: custom
          request headers reach the backend unchanged, so a header carrying the caller's exchanged token — such
          as tx-token — survives this hop too, letting delegated user identity reach the Agent Gateway
          instead of collapsing to a machine subject. Auth Mode None itself forwards no Authorization header at
          all; a backend that needs a bearer on this hop requires Auth Mode Static Token instead. (x-forwarded-for
          preserves the real caller address; x-forwarded-host arrives empty — don't key logic on it.) What's left
          is wiring up the bridge token in the console: Phase 2, Tasks 5–9.
        </figcaption>
      </figure>

      <section className="pfg-flags" aria-label="Switches introduced by the plan">
        {FLAGS.map((f) => (
          <div key={f.code[0]} className="pfg-flag">
            <div>
              {f.code.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <small>{f.text}</small>
          </div>
        ))}
      </section>
    </main>
  );
}
