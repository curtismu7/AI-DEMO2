import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GROUPS, PLAYBACKS, RFC, SERVER_EDGES, SERVER_MAP, SERVER_ZONES, SPECS } from "./serverTopologyData";
import "./ServerTopologyPage.css";

const LAYER_OPTIONS = [
  ["protocol", "Protocols"], ["network", "Network"], ["security", "Security"], ["standards", "RFCs & specs"],
];
const FILTER_OPTIONS = [
  ["all", "All services"], ["core", "App & MCP"], ["identity", "Identity & policy"],
  ["ai", "AI & data"], ["telemetry", "Observability"], ["optional", "Optional profiles"],
];
const EDGE_COLORS = { mcp: "#388bfd", oauth: "#bc8cff", agent: "#d29922", data: "#f0883e", telemetry: "#3fb950", optional: "#788492" };
const NODE_BY_ID = Object.fromEntries(SERVER_MAP.map((node) => [node.id, node]));
const EDGE_BY_ID = Object.fromEntries(SERVER_EDGES.map((item) => [item.id, item]));

function endpointFor(node, deployment) {
  return deployment === "local" ? node.data.local : node.data.k8s;
}

function matchesFilter(item, filter) {
  if (filter === "all") return true;
  if (filter === "optional") return Boolean(item.data.profile) || item.data.group === "optional";
  if (filter === "identity") return item.data.group === "identity" || item.data.group === "trust";
  return item.data.group === filter;
}

function labelForEdge(item, layer) {
  const data = item.data;
  if (layer === "protocol") return data.protocol;
  if (layer === "network") return data.network;
  if (layer === "security") return data.security;
  return [...(data.rfcs || []).map((key) => RFC[key]?.id), ...(data.specs || []).map((key) => SPECS[key]?.id)].filter(Boolean).join(" · ") || item.label;
}

const ServerCardNode = memo(function ServerCardNode({ data, selected }) {
  const group = GROUPS[data.group] || GROUPS.core;
  return (
    <article className={`stm-node stm-node--${data.kind}${selected ? " is-selected" : ""}`} style={{ "--stm-accent": group.color }}>
      <Handle type="target" position={Position.Left} aria-label="Connection input" />
      <div className="stm-node__head">
        <span className="stm-node__dot" aria-hidden="true" />
        <strong title={data.title}>{data.title}</strong>
      </div>
      <div className="stm-node__service" title={data.service}>{data.service}</div>
      <div className="stm-node__meta">
        <span>{group.label}</span>
        {data.profile && <span className="stm-pill stm-pill--optional">{data.profile}</span>}
      </div>
      <Handle type="source" position={Position.Right} aria-label="Connection output" />
    </article>
  );
});

const ZoneNode = memo(function ZoneNode({ data }) {
  return <div className={`stm-zone stm-zone--${data.tone}`}><span>{data.label}</span></div>;
});

const nodeTypes = { server: ServerCardNode, zone: ZoneNode };

function FitFilteredServices({ filter }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const visible = SERVER_MAP.filter((node) => matchesFilter(node, filter)).map(({ id }) => ({ id }));
      fitView({ nodes: visible, padding: 0.1, minZoom: 0.2, maxZoom: 1, duration: 220 });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [filter, fitView]);
  return null;
}

function standardsFor(item) {
  return [...(item.rfcs || []).map((key) => RFC[key]), ...(item.specs || []).map((key) => SPECS[key])].filter(Boolean);
}

function DetailPanel({ selectedNode, selectedEdge, deployment, activeStep, onClear }) {
  const connection = selectedEdge ? EDGE_BY_ID[selectedEdge] : null;
  const server = selectedNode ? NODE_BY_ID[selectedNode]?.data : null;
  const group = server ? GROUPS[server.group] : null;
  const standards = standardsFor(connection?.data || server || {});
  const pathLabel = connection ? `${NODE_BY_ID[connection.source]?.data.title} → ${NODE_BY_ID[connection.target]?.data.title}` : server?.title;
  const address = server ? endpointFor(server ? NODE_BY_ID[selectedNode] : null, deployment) : null;

  return (
    <aside className="stm-details" aria-live="polite" aria-label="Selected topology details">
      <header className="stm-details__head">
        <span className="stm-details__dot" style={{ "--stm-accent": group?.color || "#388bfd" }} aria-hidden="true" />
        <div className="stm-details__titles">
          <h2>{pathLabel || "Select a server or connection"}</h2>
          <p>{connection ? "Connection · configured topology" : server ? `${server.service} · ${group.label}` : "No selection"}</p>
        </div>
        {(server || connection) && <button className="stm-icon-button" type="button" onClick={onClear} aria-label="Clear selection">Clear</button>}
      </header>
      <div className="stm-details__body">
        {activeStep && <p className="stm-step-context">Playback step {activeStep.index + 1} of {activeStep.total}: {activeStep.title}</p>}
        {server && <section className="stm-detail-section"><h3>Role</h3><p>{server.role}</p></section>}
        {server && <section className="stm-detail-section"><h3>Endpoint</h3><div className="stm-code">{address}</div><p className="stm-subtle">{deployment === "local" ? "Local Docker address" : "Kubernetes service address"}</p></section>}
        {connection && <section className="stm-detail-section"><h3>Connection path</h3><p>{endpointFor(NODE_BY_ID[connection.source], deployment)}<br /><span className="stm-path-arrow">to</span><br />{endpointFor(NODE_BY_ID[connection.target], deployment)}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>Protocol</h3><p>{connection ? connection.data.protocol : server.protocol}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>Network path</h3><p>{connection ? connection.data.network : server.network}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>TLS / authentication</h3><p>{connection ? connection.data.security : server.security}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>Related RFCs & specs</h3>
          {standards.length ? <div className="stm-standard-list">{standards.map((standard) => <a key={standard.id} href={standard.url} target="_blank" rel="noreferrer"><strong>{standard.id}</strong><span>{standard.title}</span></a>)}</div> : <p className="stm-subtle">No references mapped for this item.</p>}
          <p className="stm-subtle">References describe related standards; they do not assert conformance. RFC 8705 is specific to OAuth client mTLS, not generic workload mTLS.</p>
        </section>}
        {!server && !connection && <p className="stm-empty-detail">Choose a card or line to see its declared endpoint, protocol, network path, security notes, and standards references.</p>}
        <div className="stm-evidence">Static, source-defined view. Runtime health is not queried.</div>
      </div>
    </aside>
  );
}

function TopologyCanvas({
  deployment, filter, activeLayer, selectedNode, selectedEdge, activePlaybackEdge, onSelectNode, onSelectEdge, onFit, onClearSelection,
}) {
  const graphNodes = useMemo(() => {
    const serviceNodes = SERVER_MAP.map((node) => ({
      ...node,
      selected: node.id === selectedNode,
      data: { ...node.data, endpoint: endpointFor(node, deployment) },
      style: { opacity: matchesFilter(node, filter) ? 1 : 0.22 },
    }));
    return [...SERVER_ZONES, ...serviceNodes];
  }, [deployment, filter, selectedNode]);

  const graphEdges = useMemo(() => SERVER_EDGES.map((item) => {
    const visible = filter === "all" || matchesFilter(NODE_BY_ID[item.source], filter) || matchesFilter(NODE_BY_ID[item.target], filter) || (filter === "optional" && item.data.profile);
    const active = activePlaybackEdge === item.id || selectedEdge === item.id;
    const stroke = EDGE_COLORS[item.data.kind] || EDGE_COLORS.mcp;
    const standards = [...(item.data.rfcs || []), ...(item.data.specs || [])];
    const label = labelForEdge(item, activeLayer);
    return {
      ...item,
      selected: selectedEdge === item.id,
      animated: activePlaybackEdge === item.id,
      hidden: !visible,
      label: label.length > 45 ? `${label.slice(0, 42)}…` : label,
      labelBgPadding: [6, 4],
      style: { stroke, strokeWidth: active ? 3.5 : 1.8, opacity: visible ? 0.92 : 0.08, strokeDasharray: item.data.kind === "telemetry" ? "6 5" : item.data.profile ? "6 5" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      data: { ...item.data, standards },
    };
  }), [activeLayer, activePlaybackEdge, filter, selectedEdge]);

  return (
    <div className="stm-canvas" aria-label="Interactive server topology graph">
      <ReactFlow
        nodes={graphNodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.2, maxZoom: 1 }}
        minZoom={0.12}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => node.type === "server" && onSelectNode(node.id)}
        onEdgeClick={(_, item) => onSelectEdge(item.id)}
        onPaneClick={onClearSelection}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--stm-dot)" />
        <Controls position="top-right" showInteractive={false} />
        <FitFilteredServices filter={filter} />
      </ReactFlow>
      <button className="stm-fit-button" type="button" onClick={onFit}>Fit all servers</button>
    </div>
  );
}

function CanvasWithFit(props) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => {
    const visible = SERVER_MAP.filter((node) => matchesFilter(node, props.filter)).map(({ id }) => ({ id }));
    fitView({ nodes: visible, padding: 0.1, minZoom: 0.2, maxZoom: 1, duration: 250 });
  }, [fitView, props.filter]);
  return <TopologyCanvas {...props} onFit={handleFit} />;
}

function ServerTopologyContent() {
  const [deployment, setDeployment] = useState("local");
  const [filter, setFilter] = useState("all");
  const [activeLayer, setActiveLayer] = useState("protocol");
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [scenario, setScenario] = useState("nodeGateway");
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const playback = PLAYBACKS[scenario];
  const activePlaybackEdge = playing ? playback.edgeIds[stepIndex] : null;
  const currentStepEdge = playback.edgeIds[stepIndex];
  const stepDetails = playing || selectedEdge === currentStepEdge
    ? { index: stepIndex, total: playback.edgeIds.length, title: EDGE_BY_ID[currentStepEdge]?.label }
    : null;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => {
      if (stepIndex >= playback.edgeIds.length - 1) {
        setPlaying(false);
        setSelectedEdge(playback.edgeIds[stepIndex]);
      }
      else setStepIndex((current) => current + 1);
    }, 1450);
    return () => window.clearTimeout(timer);
  }, [playing, playback.edgeIds.length, stepIndex]);

  const selectNode = useCallback((id) => { setPlaying(false); setSelectedNode(id); setSelectedEdge(null); setDetailsOpen(true); }, []);
  const selectEdge = useCallback((id) => { setPlaying(false); setSelectedNode(null); setSelectedEdge(id); setDetailsOpen(true); }, []);
  const clearSelection = useCallback(() => { setPlaying(false); setSelectedNode(null); setSelectedEdge(null); }, []);
  const selectScenario = useCallback((event) => {
    setScenario(event.target.value);
    setStepIndex(0);
    setPlaying(false);
    setFilter("all");
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);
  const moveStep = useCallback((delta) => {
    setPlaying(false);
    setSelectedNode(null);
    setDetailsOpen(true);
    const nextIndex = Math.max(0, Math.min(playback.edgeIds.length - 1, stepIndex + delta));
    setStepIndex(nextIndex);
    setSelectedEdge(playback.edgeIds[nextIndex]);
  }, [playback.edgeIds, stepIndex]);
  const togglePlaying = useCallback(() => {
    setSelectedNode(null);
    setDetailsOpen(true);
    if (playing) {
      setPlaying(false);
      setSelectedEdge(playback.edgeIds[stepIndex]);
      return;
    }
    setFilter("all");
    setSelectedEdge(null);
    if (stepIndex >= playback.edgeIds.length - 1) setStepIndex(0);
    setPlaying(true);
  }, [playback.edgeIds, playing, stepIndex]);
  const restart = useCallback(() => {
    setPlaying(false);
    setStepIndex(0);
    setSelectedNode(null);
    setSelectedEdge(playback.edgeIds[0]);
    setDetailsOpen(true);
  }, [playback.edgeIds]);

  return (
    <main className="server-topology-page">
      <header className="stm-header">
        <div className="stm-heading">
          <div><h1>Server topology</h1><p>Configured services and their network paths across local Docker and hosted Kubernetes.</p></div>
          <span className="stm-static-badge">Static map · not live health</span>
        </div>
        <div className="stm-toolbar" aria-label="Topology display controls">
          <div className="stm-segmented" role="group" aria-label="Deployment view">
            {[ ["local", "Local Docker"], ["k8s", "Hosted Kubernetes"] ].map(([key, label]) => <button key={key} type="button" aria-pressed={deployment === key} onClick={() => setDeployment(key)}>{label}</button>)}
          </div>
          <div className="stm-toolbar__spacer" />
          <div className="stm-layers" role="group" aria-label="Connection label detail">
            {LAYER_OPTIONS.map(([key, label]) => <button key={key} type="button" aria-pressed={activeLayer === key} onClick={() => setActiveLayer(key)}>{label}</button>)}
          </div>
        </div>
        <nav className="stm-filters" aria-label="Filter servers by category">
          <span>Show</span>
          {FILTER_OPTIONS.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
          <strong>{filter === "all" ? `${SERVER_MAP.length} services` : `${SERVER_MAP.filter((node) => matchesFilter(node, filter)).length} shown`}</strong>
        </nav>
        <section className="stm-playback" aria-label="Flow playback controls">
          <label htmlFor="stm-playback-scenario">Play a request path</label>
          <select id="stm-playback-scenario" value={scenario} onChange={selectScenario}>
            {Object.entries(PLAYBACKS).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}
          </select>
          <button type="button" onClick={() => moveStep(-1)} disabled={stepIndex === 0} aria-label="Previous hop">Previous</button>
          <button className="stm-play-button" type="button" onClick={togglePlaying}>{playing ? "Pause" : "Play"}</button>
          <button type="button" onClick={() => moveStep(1)} disabled={stepIndex >= playback.edgeIds.length - 1} aria-label="Next hop">Next</button>
          <button type="button" onClick={restart}>Restart</button>
          <span className="stm-playback__progress" aria-live="polite">Hop {stepIndex + 1} of {playback.edgeIds.length}</span>
        </section>
      </header>

      <section className={`stm-workspace${detailsOpen ? "" : " stm-workspace--map-only"}`} aria-label="Server graph and selected details">
        <div className="stm-graph-panel">
          <div className="stm-graph-caption"><strong>Service map</strong><span>{deployment === "local" ? "Local Docker network" : "Kubernetes · ai-demo namespace"}</span><span className="stm-scroll-hint">Drag to pan · scroll to zoom</span><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Hide details" : "Show details"}</button></div>
          <ReactFlowProvider>
            <CanvasWithFit
              deployment={deployment} filter={filter} activeLayer={activeLayer} selectedNode={selectedNode}
              selectedEdge={selectedEdge} activePlaybackEdge={activePlaybackEdge} onSelectNode={selectNode}
              onSelectEdge={selectEdge} onClearSelection={clearSelection}
            />
          </ReactFlowProvider>
          <div className="stm-legend" aria-label="Connection legend">
            {[["mcp", "MCP / HTTP"], ["oauth", "OAuth / identity"], ["agent", "Agent / model"], ["telemetry", "Telemetry"]].map(([key, label]) => <span key={key}><i style={{ "--stm-accent": EDGE_COLORS[key] }} />{label}</span>)}
            <span><i className="stm-legend__optional" />Optional profile</span>
          </div>
        </div>
        {detailsOpen && <DetailPanel
          selectedNode={selectedNode} selectedEdge={playing ? activePlaybackEdge : selectedEdge} deployment={deployment}
          activeStep={stepDetails} onClear={clearSelection}
        />}
      </section>

      <footer className="stm-notes">
        <span><strong>NetworkPolicy:</strong> <code>ai-demo-internal</code> allows ingress from <code>ai-demo</code> and <code>ingress-nginx</code>; egress to the namespace, DNS over TCP/UDP 53, and public TCP 80/443, excluding AWS metadata IPs.</span>
        <span><strong>mTLS:</strong> local MCP mTLS is opt-in; checked-in Kubernetes manifests do not declare workload mTLS for these service hops. RFC 8705 covers OAuth mTLS, not generic workload mTLS or SPIFFE.</span>
      </footer>
    </main>
  );
}

export default function ServerTopologyPage() {
  return <ServerTopologyContent />;
}
