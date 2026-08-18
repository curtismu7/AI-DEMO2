// PrivilegeGatewayTopologyPage.jsx — The two PingOne Privilege MCP Gateway
// deployment variants (agent-based, agentless) from the SE instructional demo
// setup doc, rendered via Mermaid with the request flow numbered step by step.
// Follows the PrivilegeMcpDiagramPage tab/render/export conventions.
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./PrivilegeMcpDiagramPage.css";
import "./PrivilegeGatewayTopologyPage.css";

const AGENT_SOURCE = `flowchart LR
    subgraph cloud["Priv Cloud"]
        console["Priv Cloud Controller<br/>(Console)"]
        proxy["Public Proxy<br/>proxy-us-west-2.privilege.pingone.com:443"]
    end

    subgraph device["User Device"]
        client["MCP Client"]
        agent["Priv Agent<br/>opensearch.default.applications.procyon.ai:8643"]
    end

    subgraph k8s["K8s cluster — ‹you›-ping-devops"]
        gw["MCP Gateway<br/>mcpgw.‹namespace›.svc.cluster.local:8680"]
        mcp["MCP Server<br/>opensearch-mcp-server /sse"]
    end

    console <-.- s1(("1")) -. "config sync" .-> proxy
    console -.- s2(("2")) -. "gRPC: proxy config" .-> agent
    gw --- s3(("3")) -- "standing outbound link<br/>(Priv wants 8680; ingress only allows 443)" --> proxy
    client --- s4(("4")) -- "MCP request" --> agent
    agent --- s5(("5")) -- "TLS tunnel" --> proxy
    proxy --- s6(("6")) -- "rides the link from 3<br/>policy evaluated at gateway" --> gw
    gw --- s7(("7")) -- "permitted tool call" --> mcp

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
        client["MCP Client"]
    end

    subgraph k8s["K8s cluster — ‹you›-ping-devops"]
        ingress["Ingress<br/>‹you›-agentless-mcpgw.ping-devops.com:443<br/>/opensearch-mcp-server/mcp"]
        gw["MCP Gateway<br/>mcpgw.‹namespace›.svc.cluster.local:8680"]
        mcp["MCP Server<br/>opensearch-mcp-server"]
    end

    console -.- s1(("1")) -. "gRPC: proxy config" .-> gw
    client --- s2(("2")) -- "HTTPS + OIDC sign-in<br/>(PingOne auth code flow)" --> ingress
    ingress --- s3(("3")) -- "route to gateway<br/>policy evaluated" --> gw
    gw --- s4(("4")) -- "permitted tool call" --> mcp

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

const AGENT_STEPS = [
  { heading: "Setup — happens once" },
  { n: 1, text: "Console and public proxy sync configuration — the policies you author in the Priv console land on the proxy mesh." },
  { n: 2, text: "Console pushes proxy config to the installed Priv Agent over gRPC, giving it a local frontend on :8643." },
  { n: 3, text: "Gateway dials out from the cluster and holds a standing link to the public proxy — this replaces any inbound route." },
  { heading: "Request path — every call" },
  { n: 4, text: "MCP client sends its request to the agent's local frontend, which carries the user's device identity." },
  { n: 5, text: "Agent tunnels the request to the public proxy over TLS on 443." },
  { n: 6, text: "Proxy routes the request down the standing link from step 3; the gateway evaluates policy (user, tool, time window) before anything proceeds." },
  { n: 7, text: "Gateway forwards the permitted tool call to the OpenSearch MCP server over /sse; denied calls stop at step 6." },
];

const AGENTLESS_STEPS = [
  { heading: "Setup — happens once" },
  { n: 1, text: "Console pushes proxy config to the gateway over gRPC — the gateway registered itself with the proxy token you passed to Helm." },
  { heading: "Request path — every call" },
  { n: 2, text: "Client calls the ingress URL over HTTPS; on first contact the gateway's PingOne OIDC client runs the authorization-code sign-in and the user authenticates." },
  { n: 3, text: "Ingress routes to the gateway service on 8680, which evaluates policy against the signed-in PingOne user." },
  { n: 4, text: "Gateway forwards the permitted tool call to the OpenSearch MCP server; denied calls stop at step 3." },
];

export const TABS = [
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
];

const LEGEND = [
  { className: "pgt-swatch--cloud", label: "Priv Cloud" },
  { className: "pgt-swatch--device", label: "User Device" },
  { className: "pgt-swatch--k8s", label: "K8s cluster" },
  { className: "pgt-swatch--mcp", label: "MCP server (destination)" },
  { className: "pgt-swatch--step", label: "step number" },
];

export default function PrivilegeGatewayTopologyPage() {
  const containerRef = useRef(null);
  const [activeTab, setActiveTab] = useState("agent");
  const [source, setSource] = useState(AGENT_SOURCE);
  const [renderError, setRenderError] = useState(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    if (tab) setSource(tab.source);
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { useMaxWidth: true },
    });

    async function render() {
      try {
        const id = `privilege-gateway-topology-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    render();
    return () => { cancelled = true; };
  }, [source]);

  const activeTabMeta = TABS.find((t) => t.id === activeTab);

  return (
    <div className="pmd-page">
      <div className="pmd-hero">
        <span className="pmd-eyebrow">PingOne Privilege · MCP Gateway</span>
        <h1>Privilege Gateway Topologies</h1>
        <p className="pmd-sub">
          The two deployment variants from the instructional demo setup, with the
          request flow numbered in order. Dashed lines are control-plane
          configuration; solid lines are the data path. Guillemets (‹ ›) mark
          values you substitute.
        </p>
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
        {renderError ? (
          <p className="pmd-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div
            className="pmd-diagram"
            ref={containerRef}
            aria-label="Privilege gateway topology diagram"
          />
        )}
      </div>

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

      <p className="pmd-footer">
        Source: <em>PingOne Privilege MCP Gateway: Instructional Demo Setup</em>{" "}
        (SE Confluence), Figures 1–2. Both variants end at the same OpenSearch
        MCP server; what changes is how the client's identity and traffic reach
        the gateway. Pick one variant per Helm release — never mix{" "}
        <code>privgateway</code> and <code>agentless-mcpgw</code> values.
      </p>
    </div>
  );
}
