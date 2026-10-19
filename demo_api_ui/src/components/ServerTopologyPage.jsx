import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DEMO_STEP_USE_CASES, GROUPS, PLAYBACKS, RFC, SERVER_EDGES, SERVER_MAP, SERVER_ZONES, SPECS } from "./serverTopologyData";
import { EDGE_COLORS, NODE_TYPE_COLORS } from "./serverTopologyExports";
import "./ServerTopologyPage.css";
import ServerTopologyExportControls from "./ServerTopologyExportControls";
import { layoutEdgeLabels, layoutRoutedLabels } from "./topologyEdgeLabelLayout";
import { rectsKey, routeTopologyEdges, serverRects } from "./topologyRouting";
import { labelPoint, pathFromPoints } from "../utils/orthoRoute";
import { useDraggableNodes } from '../hooks/useDraggableNodes';
import { STEP_TIME_OPTIONS, StepTimeSelector } from "./diagram";
import { formFor, noTokenNote, refsFor, tokenNoteFor, tokensFor } from "../config/serverTopologyStandards";
import { useThemeOptional } from "../context/ThemeContext";

const A2A_FLOW_BUTTONS = [["privilegeA2a", "A2A access review"], ["privilegeA2aChain", "A2A agent chain"]];
const LAYER_OPTIONS = [
  ["protocol", "Protocols"], ["network", "Network"], ["security", "Security"], ["standards", "RFCs & specs"],
];
const FILTER_OPTIONS = [
  ["flow", "Current flow (others dimmed)"], ["all", "All services (all lit)"], ["core", "App & MCP"], ["identity", "Identity & policy"],
  ["ai", "AI & data"], ["telemetry", "Observability"], ["optional", "Optional profiles"],
];
const NODE_TYPE_LABELS = [
  ["client", "Client"], ["gateway", "Gateway"], ["app", "App"], ["identity", "Identity"],
  ["data", "Data"], ["agent", "Agent"], ["telemetry", "Telemetry"],
];
const NODE_BY_ID = Object.fromEntries(SERVER_MAP.map((node) => [node.id, node]));
const EDGE_BY_ID = Object.fromEntries(SERVER_EDGES.map((item) => [item.id, item]));
// Keep these aligned with the .stm-node width and minimum height in the stylesheet.
const NODE_CARD_WIDTH = 218;
const NODE_CARD_HEIGHT = 104;
const SELECTED_NODE_SCALE = 1.1;
// React Flow lifts the selected box to 1000 + its zIndex (10); the arrows of that box sit just above it.
const FOCUS_EDGE_Z = 1011;
// Policy-decision hops are drawn dashed (a check, not the request path itself).
const DECISION_EDGES = new Set(["pinggw-authz", "nodegw-authz"]);
// Arrows outside the chosen flow are numbered after its last step, in map order.
function offFlowNumbers(steps) {
  const inFlow = new Set(steps.map((step) => step.edgeId));
  let n = steps.length;
  return new Map(SERVER_EDGES.filter((item) => !inFlow.has(item.id)).map((item) => [item.id, String(++n).padStart(2, "0")]));
}

function flowNodeIds(steps) {
  return new Set(steps.flatMap(({ edgeId }) => {
    const edge = EDGE_BY_ID[edgeId];
    return edge ? [edge.source, edge.target] : [];
  }));
}

function endpointFor(node, deployment) {
  return deployment === "local" ? node.data.local : node.data.k8s;
}

function matchesFilter(item, filter) {
  if (filter === "all" || filter === "flow") return true;
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

const ServerCardNode = memo(function ServerCardNode({ id, data, selected }) {
  const group = GROUPS[data.group] || GROUPS.core;
  return (
    <article data-ping-red={data.kind === "identity" || data.kind === "gateway" ? "true" : undefined} data-ping-grey={id === "hitl" ? "true" : undefined} className={`stm-node stm-node--${data.kind}${selected ? " is-selected" : ""}`} style={{ "--stm-accent": group.color, "--stm-node-type-color": NODE_TYPE_COLORS[data.kind] || group.color }}>
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

// The step number(s) of an arrow, drawn as orange badges. They grow when the diagram is zoomed out so they stay readable.
const badgeScale = (zoom) => Math.min(2.4, Math.max(1, 0.75 / zoom));
function EdgeBadge({ x, y, numbers, words, showWords, emphasized, extra }) {
  const { zoom } = useViewport();
  const scale = badgeScale(zoom);
  return (
    <EdgeLabelRenderer>
      <div
        className={`stm-edge-label nodrag nopan${showWords ? " is-words" : ""}${emphasized ? " is-emphasized" : ""}${extra ? " is-extra" : ""}`}
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})` }}
      >
        {numbers.map((n) => <span className="stm-edge-num" key={n}>{n}</span>)}
        <span className="stm-edge-text">{words}</span>
      </div>
    </EdgeLabelRenderer>
  );
}

const TopologyLabeledEdge = memo(function TopologyLabeledEdge({
  id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  style, markerStart, markerEnd, interactionWidth, pathOptions, data,
}) {
  const [hover, setHover] = useState(false);
  const [path, fallbackLabelX, fallbackLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
    stepPosition: pathOptions?.stepPosition,
  });
  // Routed around the boxes when the router found a way; otherwise (or while a box is being dragged) the smooth-step path.
  const route = data?.route;
  const routed = Boolean(route && route.ok);
  const drawnPath = routed ? pathFromPoints(route.pts) : path;
  const labelPosition = data?.labelPosition;
  const numbers = data?.stepNumbers || [];
  const showWords = hover || Boolean(data?.showWords);

  return (
    <>
      <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <BaseEdge id={id} path={drawnPath} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      </g>
      {(numbers.length > 0 || showWords) && (
        <EdgeBadge
          x={labelPosition?.x ?? fallbackLabelX}
          y={labelPosition?.y ?? fallbackLabelY}
          numbers={numbers}
          words={data?.words}
          showWords={showWords}
          emphasized={Boolean(data?.emphasized)}
          extra={Boolean(data?.extraNumber)}
        />
      )}
    </>
  );
});
const edgeTypes = { topologyLabeled: TopologyLabeledEdge };

const PANE_SIZE_LIMITS = {
  flow: { initial: 92, min: 88, max: 300 },
  flowNarrow: { initial: 220, min: 180, max: 340 },
  detailsWidth: { initial: 340, min: 280, max: 520 },
  detailsHeight: { initial: 320, min: 220, max: 500 },
  notes: { initial: 64, min: 44, max: 180 },
  notesNarrow: { initial: 144, min: 112, max: 240 },
};

function clampPaneSize(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readPaneSize(key, limits) {
  const { initial, min, max } = limits;
  if (typeof window === "undefined") return initial;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return initial;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampPaneSize(parsed, min, max) : initial;
  } catch {
    return initial;
  }
}

function usePersistedPaneSize(key, limits) {
  const [size, setSize] = useState(() => readPaneSize(key, limits));
  const resize = useCallback((nextSize) => {
    setSize(clampPaneSize(nextSize, limits.min, limits.max));
  }, [limits.max, limits.min]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(size));
    } catch {
      // The pane remains resizable when storage is unavailable.
    }
  }, [key, size]);

  return [size, resize];
}

function useNarrowTopologyLayout() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth <= 1040);
  useEffect(() => {
    const updateLayout = () => setIsNarrow(window.innerWidth <= 1040);
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);
  return isNarrow;
}

function TopologyResizeHandle({ label, controls, value, min, max, axis, direction, onResize }) {
  const dragStart = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const coordinateFor = (event) => axis === "x" ? event.clientX : event.clientY;

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    const coordinate = coordinateFor(event);
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault();
    dragStart.current = { pointerId: event.pointerId, coordinate, value };
    if (Number.isInteger(event.pointerId)) event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
  };
  const onPointerMove = (event) => {
    const start = dragStart.current;
    if (!start || (start.pointerId != null && event.pointerId != null && start.pointerId !== event.pointerId)) return;
    const coordinate = coordinateFor(event);
    if (Number.isFinite(coordinate)) onResize(start.value + (coordinate - start.coordinate) * direction);
  };
  const onPointerUp = () => {
    dragStart.current = null;
    setIsDragging(false);
  };
  const onKeyDown = (event) => {
    const negativeKey = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const positiveKey = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (event.key !== negativeKey && event.key !== positiveKey) return;
    event.preventDefault();
    const sign = event.key === negativeKey ? -1 : 1;
    onResize(value + sign * direction * (event.shiftKey ? 64 : 16));
  };

  return (
    <div
      className={`stm-pane-resizer stm-pane-resizer--${axis}`}
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      data-resizing={isDragging || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    />
  );
}

function FitFilteredServices({ filter, flowOnly, playbackSteps, detailsOpen }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const inFlow = flowOnly ? flowNodeIds(playbackSteps) : null;
      const visible = SERVER_MAP.filter((node) => inFlow ? inFlow.has(node.id) : matchesFilter(node, filter)).map(({ id }) => ({ id }));
      fitView({ nodes: visible, padding: 0.1, minZoom: 0.2, maxZoom: 1, duration: 220 });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [detailsOpen, filter, fitView, flowOnly, playbackSteps]);
  return null;
}

function FitTopologyForPrint({ filter, flowOnly, playbackSteps }) {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const previousViewport = useRef(null);

  useEffect(() => {
    const fitForPrint = () => {
      previousViewport.current = getViewport();
      const inFlow = flowOnly ? flowNodeIds(playbackSteps) : null;
      const visible = SERVER_MAP
        .filter((node) => inFlow ? inFlow.has(node.id) : matchesFilter(node, filter))
        .map(({ id }) => ({ id }));
      fitView({ nodes: visible, padding: 0.1, minZoom: 0.12, maxZoom: 1, duration: 0 });
    };
    const restoreAfterPrint = () => {
      if (previousViewport.current) setViewport(previousViewport.current, { duration: 0 });
      previousViewport.current = null;
    };
    window.addEventListener("beforeprint", fitForPrint);
    window.addEventListener("afterprint", restoreAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", fitForPrint);
      window.removeEventListener("afterprint", restoreAfterPrint);
    };
  }, [filter, fitView, flowOnly, getViewport, playbackSteps, setViewport]);

  return null;
}

function standardsFor(item) {
  return [...(item.rfcs || []).map((key) => RFC[key]), ...(item.specs || []).map((key) => SPECS[key])].filter(Boolean);
}

function stepForEdge(playback, edgeId) {
  const index = playback.steps.findIndex((step) => step.edgeId === edgeId);
  return index < 0 ? null : { index, total: playback.steps.length, title: playback.steps[index].title };
}

const SECURITY_OPTION_STATUS = {
  optional: "Optional · deployment-dependent",
  candidate: "Candidate · not declared",
};

function SecurityOptionsPanel({ connection }) {
  const options = connection?.data.securityOptions || [];
  return (
    <section className="stm-detail-section stm-detail-section--security-options">
      <h3>Other security options</h3>
      <p className="stm-security-options__intro">These are static design options, not enabled settings. The topology security note above describes the declared path.</p>
      {options.length ? <ul className="stm-security-option-list">
        {options.map((option) => (
          <li className={`stm-security-option stm-security-option--${option.status}`} key={option.id}>
            <div className="stm-security-option__head">
              <strong>{option.title}</strong>
              <span className={`stm-security-option__status stm-security-option__status--${option.status}`}>{SECURITY_OPTION_STATUS[option.status] || "Review status"}</span>
            </div>
            <p><strong>Security layer:</strong> {option.layer}</p>
            <p><strong>Relationship:</strong> {option.relationship}</p>
            <p>{option.description}</p>
            <p><strong>Requires:</strong> {option.requirements}</p>
            {standardsFor(option).length > 0 && <div className="stm-security-option__refs" aria-label="Standards for this option">
              {standardsFor(option).map((standard) => <a key={standard.id} href={standard.url} target="_blank" rel="noreferrer">{standard.id}</a>)}
            </div>}
          </li>
        ))}
      </ul> : <p className="stm-subtle">No hop-specific options have been assessed for this connection.</p>}
      <p className="stm-security-options__note">Token exchange provides delegated, audience-specific authorization. Workload mTLS authenticates services and protects their connection; it can complement a token and does not replace user-level authorization.</p>
    </section>
  );
}

function CommunicationList({ direction, tone, edges, playback }) {
  const routeStepByEdge = new Map(playback.steps.map((step, index) => [step.edgeId, { ...step, index }]));
  const orderedEdges = [...edges].sort((a, b) => (routeStepByEdge.get(a.id)?.index ?? Number.MAX_SAFE_INTEGER) - (routeStepByEdge.get(b.id)?.index ?? Number.MAX_SAFE_INTEGER));
  return (
    <ul className={`stm-communication-list stm-communication-list--${tone}`}>
      {orderedEdges.map((item) => {
        const step = routeStepByEdge.get(item.id);
        return <li key={item.id}>
          <strong>{step ? `Step ${String(step.index + 1).padStart(2, "0")} · ${step.title}` : `${NODE_BY_ID[item.source]?.data.title} → ${NODE_BY_ID[item.target]?.data.title}`}</strong>
          <span>{item.data.protocol}</span>
          <span>{item.data.network}</span>
          <span>{item.data.security}</span>
          {(item.data.securityOptions || []).length > 0 && <span className="stm-communication-options"><strong>Other options:</strong> {(item.data.securityOptions || []).map((option) => `${option.status === "optional" ? "Optional" : "Candidate"}: ${option.title}`).join(" · ")}</span>}
          <small>{direction}</small>
        </li>;
      })}
    </ul>
  );
}

const KIND_LABEL = { rfc: "RFC", spec: "spec", emerging: "emerging" };

function WireSection({ connection }) {
  const form = formFor(connection.id);
  return (
    <section className="stm-detail-section stm-detail-section--wire">
      <h3>Request on the wire</h3>
      {form ? <pre className="stm-code stm-code--pre">{form}</pre> : <p className="stm-subtle">This hop is not a single HTTP request, so there is no request form to show.</p>}
      <p className="stm-subtle">Example values only; no real secrets.</p>
    </section>
  );
}

function TokenSection({ connection }) {
  const tokens = tokensFor(connection.id);
  return (
    <section className="stm-detail-section stm-detail-section--tokens">
      <h3>{tokens.length > 1 ? "Mock tokens in play" : "Mock token in play"}</h3>
      {tokens.length ? tokens.map((token) => (
        <div className="stm-token" key={token.label}>
          <p className="stm-token__label"><span className="stm-mock-tag">MOCK</span>{token.label}</p>
          <pre className="stm-code stm-code--pre">{JSON.stringify({ ...(token.header ? { header: token.header } : {}), claims: token.claims }, null, 2)}</pre>
        </div>
      )) : <p className="stm-subtle">{noTokenNote(connection)}</p>}
      {tokens.length > 0 && <p className="stm-subtle">Decoded claims, teaching values only. {tokenNoteFor(connection.id)}</p>}
    </section>
  );
}

function StepStandards({ connection }) {
  const refs = refsFor(connection.id);
  return (
    <section className="stm-detail-section stm-detail-section--standards"><h3>Standards behind this step</h3>
      {refs.length ? <div className="stm-ref-list">{refs.map((ref) => {
        const body = <><span className={`stm-ref stm-ref--${ref.kind}`}>{KIND_LABEL[ref.kind]}</span><strong>{ref.id}</strong><span className="stm-ref__title">{ref.title}</span></>;
        return ref.url
          ? <a key={ref.id} className="stm-ref-item" href={ref.url} target="_blank" rel="noreferrer">{body}</a>
          : <div key={ref.id} className="stm-ref-item">{body}</div>;
      })}</div> : <p className="stm-subtle">No references mapped for this item.</p>}
      <p className="stm-subtle">Emerging items are drafts or work in progress; their status changes, so verify before quoting. References describe related standards; they do not assert conformance. RFC 8705 is specific to OAuth client mTLS, not generic workload mTLS.</p>
    </section>
  );
}

function DetailPanel({ selectedNode, stepNode, selectedEdge, deployment, activeStep, playback, onClear, panelRef }) {
  const connection = selectedEdge ? EDGE_BY_ID[selectedEdge] : null;
  const server = selectedNode ? NODE_BY_ID[selectedNode]?.data : null;
  const stepBox = !server && stepNode ? NODE_BY_ID[stepNode]?.data : null;
  const group = server ? GROUPS[server.group] : null;
  const standards = standardsFor(connection?.data || server || {});
  const pathLabel = server ? server.title : connection ? `${NODE_BY_ID[connection.source]?.data.title} → ${NODE_BY_ID[connection.target]?.data.title}` : null;
  const address = server ? endpointFor(server ? NODE_BY_ID[selectedNode] : null, deployment) : null;
  const incoming = selectedNode ? SERVER_EDGES.filter((item) => item.target === selectedNode) : [];
  const outgoing = selectedNode ? SERVER_EDGES.filter((item) => item.source === selectedNode) : [];
  const mappedDemoSteps = connection
    ? [...new Set(playback.steps.find((step) => step.edgeId === connection.id)?.demoStepIds || [])]
    : selectedNode
      ? [...new Set(playback.steps.filter((step) => {
        const item = EDGE_BY_ID[step.edgeId];
        return item && (item.source === selectedNode || item.target === selectedNode);
      }).flatMap((step) => step.demoStepIds || []))]
      : [];

  return (
    <aside id="stm-topology-details" ref={panelRef} className="stm-details" aria-live="polite" aria-label="Selected topology details">
      <header className="stm-details__head">
        <span className="stm-details__dot" style={{ "--stm-accent": group?.color || "#388bfd" }} aria-hidden="true" />
        <div className="stm-details__titles">
          <h2>{pathLabel || "Select a server or connection"}</h2>
          <p>{server ? `${server.service} · ${group.label}` : connection ? "Connection · configured topology" : "No selection"}</p>
        </div>
        {(server || connection) && <button className="stm-icon-button" type="button" onClick={onClear} aria-label="Clear selection">Clear</button>}
      </header>
      <div className="stm-details__body">
        {activeStep && <p className="stm-step-context"><strong>Diagram step {String(activeStep.index + 1).padStart(2, "0")} of {activeStep.total}</strong><span>{activeStep.title}</span></p>}
        {server && <>
          <section className="stm-detail-section stm-detail-section--communications"><h3>Incoming communication</h3>
            {incoming.length ? <CommunicationList tone="incoming" direction="Inbound to this server" edges={incoming} playback={playback} /> : <p className="stm-subtle">No incoming connections are declared.</p>}
          </section>
          <section className="stm-detail-section stm-detail-section--communications"><h3>Outgoing communication</h3>
            {outgoing.length ? <CommunicationList tone="outgoing" direction="Outbound from this server" edges={outgoing} playback={playback} /> : <p className="stm-subtle">No outgoing connections are declared.</p>}
          </section>
        </>}
        {(connection || server) && <section className="stm-detail-section stm-detail-section--mapping"><h3>Demo Steps mapping</h3>
          {mappedDemoSteps.length ? <ul className="stm-use-case-list">{mappedDemoSteps.map((id) => <li key={id}><strong>{id}</strong><span>{DEMO_STEP_USE_CASES[id]}</span></li>)}</ul> : <p className="stm-subtle">No direct Demo Steps use case is represented by this selected connection in the current flow.</p>}
        </section>}
        {server && <section className="stm-detail-section"><h3>Role</h3><p>{server.role}</p></section>}
        {server && <section className="stm-detail-section"><h3>Endpoint</h3><div className="stm-code">{address}</div><p className="stm-subtle">{deployment === "local" ? "Local Docker address" : "Kubernetes service address"}</p></section>}
        {stepBox && <section className="stm-detail-section"><h3>Box in this step</h3><p><strong>{stepBox.title}</strong> · {stepBox.service}</p><p>{stepBox.role}</p><div className="stm-code">{endpointFor(NODE_BY_ID[stepNode], deployment)}</div></section>}
        {connection && <section className="stm-detail-section"><h3>Connection path</h3><p><strong>{NODE_BY_ID[connection.source]?.data.title} → {NODE_BY_ID[connection.target]?.data.title}</strong><br />{endpointFor(NODE_BY_ID[connection.source], deployment)}<br /><span className="stm-path-arrow">to</span><br />{endpointFor(NODE_BY_ID[connection.target], deployment)}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>Protocol</h3><p>{connection ? connection.data.protocol : server.protocol}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>Network path</h3><p>{connection ? connection.data.network : server.network}</p></section>}
        {(server || connection) && <section className="stm-detail-section"><h3>TLS / authentication</h3><p>{connection ? connection.data.security : server.security}</p></section>}
        {connection && <WireSection connection={connection} />}
        {connection && <TokenSection connection={connection} />}
        {connection && <SecurityOptionsPanel connection={connection} />}
        {connection && <StepStandards connection={connection} />}
        {server && <section className="stm-detail-section"><h3>Related RFCs & specs</h3>
          {standards.length ? <div className="stm-standard-list">{standards.map((standard) => <a key={standard.id} href={standard.url} target="_blank" rel="noreferrer"><strong>{standard.id}</strong><span>{standard.title}</span></a>)}</div> : <p className="stm-subtle">No references mapped for this item.</p>}
          <p className="stm-subtle">References describe related standards; they do not assert conformance. RFC 8705 is specific to OAuth client mTLS, not generic workload mTLS.</p>
        </section>}
        {!server && !connection && <p className="stm-empty-detail">Choose a card or line to see its declared endpoint, protocol, network path, security notes, and standards references.</p>}
        <div className="stm-evidence">Static, source-defined view. Runtime health is not queried.</div>
      </div>
    </aside>
  );
}

function ZoomControls({ onFit }) {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <Panel position="top-right" className="stm-zoom" aria-label="Diagram size">
      <button type="button" onClick={() => zoomOut({ duration: 120 })} aria-label="Zoom out">-</button>
      <input type="range" min={12} max={160} step={2} value={Math.round(zoom * 100)} aria-label="Diagram size" onChange={(event) => zoomTo(Number(event.target.value) / 100, { duration: 0 })} />
      <button type="button" onClick={() => zoomIn({ duration: 120 })} aria-label="Zoom in">+</button>
      <button type="button" className="stm-zoom__readout" onClick={() => zoomTo(1, { duration: 150 })} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={onFit}>Fit</button>
    </Panel>
  );
}

function TopologyCanvas({
  deployment, filter, flowOnly, activeLayer, selectedNode, stepNode, selectedEdge, activePlaybackEdge, playbackSteps, playing, stepIndex, detailsOpen, onSelectNode, onSelectEdge, onFit, onClearSelection,
}) {
  // The box tied to the step bar looks selected too, but never dims the rest of the map.
  const focusNode = selectedNode || stepNode;
  const { darkMode } = useThemeOptional();
  const lastDragEnd = useRef(0);
  const routeEdges = useMemo(() => new Set(playbackSteps.map((step) => step.edgeId)), [playbackSteps]);
  const routeNodes = useMemo(() => flowNodeIds(playbackSteps), [playbackSteps]);
  const graphNodes = useMemo(() => {
    const connectedNodeIds = new Set(selectedNode ? SERVER_EDGES.flatMap((item) => (
      item.source === selectedNode ? [item.target] : item.target === selectedNode ? [item.source] : []
    )) : []);
    const serviceNodes = SERVER_MAP.filter((node) => !flowOnly || routeNodes.has(node.id)).map((node) => {
      const isSelected = node.id === selectedNode;
      const inScope = isSelected || flowOnly || (filter === "flow" ? routeNodes.has(node.id) : matchesFilter(node, filter));
      const opacity = selectedNode
        ? (isSelected || connectedNodeIds.has(node.id) ? 1 : 0.28)
        : (inScope ? 1 : 0.035);
      return {
        ...node,
        selected: isSelected || node.id === stepNode,
        zIndex: isSelected || node.id === stepNode ? 10 : (node.zIndex ?? 0),
        data: { ...node.data, endpoint: endpointFor(node, deployment) },
        style: { opacity },
      };
    });
    const zones = selectedNode
      ? SERVER_ZONES.map((zone) => ({ ...zone, style: { ...zone.style, opacity: 0.12 } }))
      : SERVER_ZONES;
    return flowOnly ? serviceNodes : [...zones, ...serviceNodes];
  }, [deployment, filter, flowOnly, routeNodes, selectedNode, stepNode]);

  const offFlow = useMemo(() => offFlowNumbers(playbackSteps), [playbackSteps]);
  const graphEdges = useMemo(() => SERVER_EDGES.filter((item) => !flowOnly || routeEdges.has(item.id)).map((item) => {
    const edgeStep = playbackSteps.findIndex((step) => step.edgeId === item.id);
    const isOnPlayback = edgeStep >= 0;
    const isIncomingToSelection = selectedNode && item.target === selectedNode;
    const isOutgoingFromSelection = selectedNode && item.source === selectedNode;
    const isFocusedCommunication = isIncomingToSelection || isOutgoingFromSelection;
    const isSelectedEdge = selectedEdge === item.id;
    const matchesCategory = filter === "all" || filter === "flow" || matchesFilter(NODE_BY_ID[item.source], filter) || matchesFilter(NODE_BY_ID[item.target], filter) || (filter === "optional" && item.data.profile);
    const visible = isSelectedEdge || (flowOnly ? routeEdges.has(item.id) : matchesCategory || isFocusedCommunication);
    const isOffRoute = filter === "flow" && !isOnPlayback && !isFocusedCommunication && !isSelectedEdge;
    const isDimmed = !isSelectedEdge && (!visible || Boolean(selectedNode && !isFocusedCommunication) || isOffRoute);
    const active = activePlaybackEdge === item.id || isSelectedEdge || isFocusedCommunication || isOnPlayback;
    // Arrows in the flow carry their step number; every other arrow is numbered after the last step (outline badge).
    const flowNumbers = playbackSteps.flatMap((step, i) => (step.edgeId === item.id ? [String(i + 1).padStart(2, "0")] : []));
    const extraNumber = !isOnPlayback && !isDimmed;
    const stepNumbers = isOnPlayback ? flowNumbers : extraNumber ? [offFlow.get(item.id)] : [];
    // Dashed: later steps (also when stepping by hand), decisions, telemetry and optional profiles.
    const isFuture = isOnPlayback && !playbackSteps.some((step, i) => step.edgeId === item.id && i <= stepIndex);
    const isDashed = Boolean(item.data.kind === "telemetry" || item.data.profile || DECISION_EDGES.has(item.id) || isFuture);
    const inOut = isIncomingToSelection ? "IN · " : isOutgoingFromSelection ? "OUT · " : "";
    const stroke = isIncomingToSelection ? "#bc8cff" : isOutgoingFromSelection ? "#58a6ff" : EDGE_COLORS[item.data.kind] || EDGE_COLORS.mcp;
    const standards = [...(item.data.rfcs || []), ...(item.data.specs || [])];
    const label = labelForEdge(item, activeLayer);
    const className = [
      isFocusedCommunication && "stm-edge--focused",
      isIncomingToSelection && "stm-edge--incoming",
      isOutgoingFromSelection && "stm-edge--outgoing",
      isOnPlayback && "stm-edge--route",
      isOffRoute && "stm-edge--off-route",
      isDashed && "stm-edge--dashed",
      isDimmed && "stm-edge--dimmed",
    ].filter(Boolean).join(" ");
    return {
      ...item,
      className,
      selected: selectedEdge === item.id,
      animated: activePlaybackEdge === item.id,
      hidden: !visible,
      label: `${isIncomingToSelection ? "IN · " : isOutgoingFromSelection ? "OUT · " : ""}${isOnPlayback ? `${String(edgeStep + 1).padStart(2, "0")} · ` : ""}${label}`.slice(0, 48),
      style: {
        stroke,
        strokeWidth: isFocusedCommunication ? 7 : active ? 3.2 : 1.8,
        opacity: isSelectedEdge || isFocusedCommunication ? 1 : !visible ? 0.018 : selectedNode || isOffRoute ? 0.018 : 0.96,
        strokeDasharray: isDashed ? "7 5" : undefined,
      },
      // Light canvas: black arrowheads (blue on dashed lines) to match the lines; dark canvas keeps the per-kind colours.
      markerEnd: { type: MarkerType.ArrowClosed, color: darkMode ? stroke : isDashed ? "#1f5fbf" : "#111111" },
      data: {
        ...item.data,
        standards,
        emphasized: Boolean(isFocusedCommunication),
        stepNumbers,
        extraNumber,
        words: `${inOut}${label}`.slice(0, 48),
        // Words show for the arrow in focus; every other arrow shows them on hover, so labels never pile up.
        showWords: Boolean(activePlaybackEdge === item.id || isSelectedEdge || isFocusedCommunication),
      },
    };
  }), [activeLayer, activePlaybackEdge, darkMode, filter, flowOnly, offFlow, playbackSteps, routeEdges, selectedEdge, selectedNode, stepIndex]);

  // Routes depend on where the boxes really are (React Flow's absolute positions), so compute them once per layout,
  // from a string key that changes only when a box lands elsewhere. While a box is being dragged the cheap smooth-step path is drawn.
  const [dragging, setDragging] = useState(false);
  const nodeLookup = useStore((st) => st.nodeLookup);
  // The badge size the labels are laid out for, in quarter steps so a zoom drag re-lays them out only a few times.
  const badgeSize = useStore((st) => Math.round(badgeScale(st.transform[2]) * 4) / 4);
  // While any box is unmeasured (every step briefly) the previous key stands, so a step does not re-route.
  const lastKey = useRef("");
  const absKey = useStore((st) => (lastKey.current = rectsKey(st.nodeLookup.values()) ?? lastKey.current));
  const routing = useMemo(() => {
    if (dragging || !absKey) return { rects: {}, routes: {}, fallbacks: null };
    const rects = serverRects(nodeLookup.values());
    return { rects, ...routeTopologyEdges(rects, SERVER_EDGES) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absKey, dragging]);

  const positionedEdges = useMemo(() => {
    // Only arrows that draw a badge need a place for it, and only as much room as the badge really takes.
    const shownLabels = graphEdges.filter((item) => !item.hidden && ((item.data.stepNumbers || []).length > 0 || item.data.showWords)).map((item) => {
      const badgeText = [...(item.data.stepNumbers || []), ...(item.data.showWords ? [item.data.words] : [])].join(" ");
      return { item, text: badgeText, emphasized: item.data.emphasized };
    });
    const routedLabels = [];
    const looseLabels = [];
    for (const { item, text, emphasized } of shownLabels) {
      const pts = routing.routes[item.id]?.ok ? routing.routes[item.id].pts : null;
      if (pts) { routedLabels.push({ id: item.id, text, emphasized, pts, ...labelPoint(pts) }); continue; }
      const source = NODE_BY_ID[item.source];
      const target = NODE_BY_ID[item.target];
      const sourceScale = source.id === focusNode ? SELECTED_NODE_SCALE : 1;
      const targetScale = target.id === focusNode ? SELECTED_NODE_SCALE : 1;
      const sourceWidth = NODE_CARD_WIDTH * sourceScale;
      const targetWidth = NODE_CARD_WIDTH * targetScale;
      const [, x, y] = getSmoothStepPath({
        sourceX: source.position.x + NODE_CARD_WIDTH + (sourceWidth - NODE_CARD_WIDTH) / 2,
        sourceY: source.position.y + NODE_CARD_HEIGHT / 2,
        sourcePosition: Position.Right,
        targetX: target.position.x - (targetWidth - NODE_CARD_WIDTH) / 2,
        targetY: target.position.y + NODE_CARD_HEIGHT / 2,
        targetPosition: Position.Left,
      });
      looseLabels.push({ id: item.id, text, emphasized, x, y });
    }
    const measuredObstacles = Object.values(routing.rects).map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, width: r.w, height: r.h }));
    const serviceObstacles = measuredObstacles.length ? measuredObstacles : graphNodes
      .filter((node) => node.type === "server")
      .map((node) => {
        const scale = node.id === focusNode ? SELECTED_NODE_SCALE : 1;
        return {
          x: node.position.x + NODE_CARD_WIDTH / 2,
          y: node.position.y + NODE_CARD_HEIGHT / 2,
          width: NODE_CARD_WIDTH * scale,
          height: NODE_CARD_HEIGHT * scale,
        };
      });
    const labelPositions = new Map([
      ...layoutRoutedLabels(routedLabels, serviceObstacles, badgeSize),
      ...layoutEdgeLabels(looseLabels, serviceObstacles),
    ].map((label) => [label.id, label]));

    return graphEdges.map((item) => ({
      ...item,
      type: "topologyLabeled",
      // The selected box is drawn larger and would cover the arrowheads of its own arrows, so those arrows are drawn above it.
      zIndex: item.source === focusNode || item.target === focusNode ? FOCUS_EDGE_Z : undefined,
      data: { ...item.data, labelPosition: labelPositions.get(item.id), route: routing.routes[item.id] },
    }));
  }, [graphEdges, graphNodes, focusNode, routing, badgeSize]);

  const { nodes: dragNodes, onNodesChange: onDragNodes } = useDraggableNodes(graphNodes, carryZoneMembers);
  return (
    <div className="stm-canvas" aria-label="Interactive server topology graph" data-route-fallbacks={routing.fallbacks ?? undefined}>
      <ReactFlow
        nodes={dragNodes}
        onNodesChange={onDragNodes}
        edges={positionedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.2, maxZoom: 1 }}
        minZoom={0.12}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        // A small wiggle is still a click; only a deliberate drag (past 5 px) counts as a drag.
        nodeDragThreshold={5}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => { lastDragEnd.current = Date.now(); setDragging(false); }}
        onNodeClick={(_, node) => {
          // The click that ends a drag is not a selection.
          if (Date.now() - lastDragEnd.current < 300) return;
          if (node.type === "server") onSelectNode(node.id);
        }}
        onEdgeClick={(_, item) => onSelectEdge(item.id)}
        onPaneClick={onClearSelection}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "topologyLabeled" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--stm-dot)" />
        <ZoomControls onFit={onFit} />
        <FitFilteredServices filter={filter} flowOnly={flowOnly} playbackSteps={playbackSteps} detailsOpen={detailsOpen} />
        <FitTopologyForPrint filter={filter} flowOnly={flowOnly} playbackSteps={playbackSteps} />
      </ReactFlow>
    </div>
  );
}

function CanvasWithFit(props) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => {
    const inFlow = props.flowOnly ? flowNodeIds(props.playbackSteps) : null;
    const visible = SERVER_MAP.filter((node) => inFlow ? inFlow.has(node.id) : matchesFilter(node, props.filter)).map(({ id }) => ({ id }));
    fitView({ nodes: visible, padding: 0.1, minZoom: 0.2, maxZoom: 1, duration: 250 });
  }, [fitView, props.filter, props.flowOnly, props.playbackSteps]);
  return <TopologyCanvas {...props} onFit={handleFit} />;
}

function ServerTopologyContent() {
  const [flowSizeWide, resizeFlowWide] = usePersistedPaneSize("server-topology-flow-size", PANE_SIZE_LIMITS.flow);
  const [flowSizeNarrow, resizeFlowNarrow] = usePersistedPaneSize("server-topology-flow-size-narrow", PANE_SIZE_LIMITS.flowNarrow);
  const [detailsWidth, resizeDetailsWidth] = usePersistedPaneSize("server-topology-details-width", PANE_SIZE_LIMITS.detailsWidth);
  const [detailsHeight, resizeDetailsHeight] = usePersistedPaneSize("server-topology-details-height", PANE_SIZE_LIMITS.detailsHeight);
  const [notesSizeWide, resizeNotesWide] = usePersistedPaneSize("server-topology-notes-size", PANE_SIZE_LIMITS.notes);
  const [notesSizeNarrow, resizeNotesNarrow] = usePersistedPaneSize("server-topology-notes-size-narrow", PANE_SIZE_LIMITS.notesNarrow);
  const isNarrow = useNarrowTopologyLayout();
  const flowSize = isNarrow ? flowSizeNarrow : flowSizeWide;
  const resizeFlow = isNarrow ? resizeFlowNarrow : resizeFlowWide;
  const notesSize = isNarrow ? notesSizeNarrow : notesSizeWide;
  const resizeNotes = isNarrow ? resizeNotesNarrow : resizeNotesWide;
  const [deployment, setDeployment] = useState("local");
  const [filter, setFilter] = useState("flow");
  const [flowOnly, setFlowOnly] = useState(false);
  const [activeLayer, setActiveLayer] = useState("protocol");
  const [selectedNode, setSelectedNode] = useState(null);
  // The box tied to the step bar (the far end of the step's arrow); a box picked on the map takes precedence.
  const [stepNode, setStepNode] = useState(null);
  const detailsRef = useRef(null);
  const stepListRef = useRef(null);
  const [selectedEdge, setSelectedEdge] = useState("browser-ingress");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [scenario, setScenario] = useState("protectedApi");
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stepMs, setStepMs] = useState(1500);

  const playback = PLAYBACKS[scenario];
  const pageStyle = {
    "--stm-flow-size": `${flowSize}px`,
    "--stm-details-width": `${detailsWidth}px`,
    "--stm-details-height": `${detailsHeight}px`,
    "--stm-notes-size": `${notesSize}px`,
  };

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-server-topology-print", "");
    style.textContent = "@media print { @page { size: A4 landscape; margin: 8mm; } }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const activePlaybackEdge = playing ? playback.steps[stepIndex]?.edgeId : null;
  const currentStep = playback.steps[stepIndex];
  const stepDetails = playing
    ? { index: stepIndex, total: playback.steps.length, title: currentStep?.title }
    : stepForEdge(playback, selectedEdge);

  // While playing, the step bar drives the box too.
  useEffect(() => {
    if (!playing) return;
    const edge = EDGE_BY_ID[playback.steps[stepIndex]?.edgeId];
    if (edge) setStepNode((cur) => (cur === edge.source || cur === edge.target ? cur : edge.target));
  }, [playing, playback.steps, stepIndex]);
  // Keep the step in focus visible inside the (scrolling) step bar.
  useEffect(() => {
    // Scroll only the step list (scrollIntoView would also move the page).
    const list = stepListRef.current;
    const item = list?.children[stepIndex];
    if (!item) return;
    const box = list.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    if (at.top < box.top) list.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom;
    if (at.left < box.left) list.scrollLeft -= box.left - at.left;
    else if (at.right > box.right) list.scrollLeft += at.right - box.right;
  }, [stepIndex, scenario]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => {
      if (stepIndex >= playback.steps.length - 1) {
        setPlaying(false);
        setSelectedEdge(playback.steps[stepIndex]?.edgeId || null);
      }
      else setStepIndex((current) => current + 1);
    }, stepMs);
    return () => window.clearTimeout(timer);
  }, [playing, playback.steps, stepIndex, stepMs]);

  // A box click jumps the step bar to that box's first arrow (arrows into it first, else out of it) and brings the details into view.
  const selectNode = useCallback((id) => {
    setPlaying(false);
    setSelectedNode(id);
    setStepNode(null);
    setDetailsOpen(true);
    const steps = playback.steps;
    let first = steps.findIndex((step) => EDGE_BY_ID[step.edgeId]?.target === id);
    if (first < 0) first = steps.findIndex((step) => EDGE_BY_ID[step.edgeId]?.source === id);
    // The jumped-to step's connection is selected too, so its request, tokens and standards show beside the box detail.
    setSelectedEdge(first >= 0 ? steps[first].edgeId : null);
    if (first >= 0) setStepIndex(first);
    window.requestAnimationFrame(() => detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
  }, [playback.steps]);
  const selectEdge = useCallback((id) => { setPlaying(false); setSelectedNode(null); setStepNode(null); setSelectedEdge(id); setDetailsOpen(true); }, []);
  const clearSelection = useCallback(() => { setPlaying(false); setSelectedNode(null); setStepNode(null); setSelectedEdge(null); }, []);
  const toggleFlowOnly = useCallback((event) => {
    const enabled = event.target.checked;
    if (enabled) {
      const routeNodes = flowNodeIds(playback.steps);
      const routeEdges = new Set(playback.steps.map((step) => step.edgeId));
      if (selectedNode && !routeNodes.has(selectedNode)) setSelectedNode(null);
      if (selectedEdge && !routeEdges.has(selectedEdge)) setSelectedEdge(null);
    }
    setFlowOnly(enabled);
  }, [playback.steps, selectedEdge, selectedNode]);
  const selectScenario = useCallback((event) => {
    setScenario(event.target.value);
    setStepIndex(0);
    setPlaying(false);
    setFilter("flow");
    setSelectedNode(null);
    setStepNode(null);
    setSelectedEdge(PLAYBACKS[event.target.value].steps[0]?.edgeId || null);
  }, []);
  // One click to the agent-to-agent picture: pick the flow and show only its
  // boxes, so the map reads as that flow's own diagram.
  const showFlowDiagram = useCallback((key) => {
    setScenario(key);
    setStepIndex(0);
    setPlaying(false);
    setFilter("flow");
    setSelectedNode(null);
    setStepNode(null);
    setSelectedEdge(PLAYBACKS[key].steps[0]?.edgeId || null);
    setFlowOnly(true);
  }, []);
  // Moving the step bar selects that step's box, unless the box already picked is part of the step.
  const selectPlaybackStep = useCallback((index) => {
    const step = playback.steps[index];
    if (!step) return;
    const edge = EDGE_BY_ID[step.edgeId];
    const keepBox = Boolean(selectedNode && edge && (edge.source === selectedNode || edge.target === selectedNode));
    setPlaying(false);
    if (!keepBox) setSelectedNode(null);
    setStepNode(keepBox || !edge ? null : edge.target);
    setStepIndex(index);
    setSelectedEdge(step.edgeId);
    setDetailsOpen(true);
  }, [playback.steps, selectedNode]);
  const moveStep = useCallback((delta) => {
    selectPlaybackStep(Math.max(0, Math.min(playback.steps.length - 1, stepIndex + delta)));
  }, [playback.steps.length, selectPlaybackStep, stepIndex]);
  const togglePlaying = useCallback(() => {
    setSelectedNode(null);
    setDetailsOpen(true);
    if (playing) {
      setPlaying(false);
      setSelectedEdge(playback.steps[stepIndex]?.edgeId || null);
      return;
    }
    setFilter("flow");
    setSelectedEdge(null);
    if (stepIndex >= playback.steps.length - 1) setStepIndex(0);
    setPlaying(true);
  }, [playback.steps, playing, stepIndex]);
  // Reset clears the walkthrough: back to step 1 with nothing selected.
  const reset = useCallback(() => {
    setPlaying(false);
    setStepIndex(0);
    setSelectedNode(null);
    setStepNode(null);
    setSelectedEdge(null);
  }, []);

  return (
    <main className="server-topology-page" style={pageStyle}>
      <header className="stm-header">
        <div className="stm-heading">
          <div><h1>Server topology</h1><p>Configured services and their network paths across local Docker and hosted Kubernetes.</p></div>
          <span className="stm-static-badge">Static map · not live health</span>
        </div>
        <div className="stm-toolbar" aria-label="Topology display controls">
          <div className="stm-segmented" role="group" aria-label="Deployment view">
            {[ ["local", "Local Docker"], ["k8s", "Hosted Kubernetes"] ].map(([key, label]) => <button key={key} type="button" aria-pressed={deployment === key} onClick={() => setDeployment(key)}>{label}</button>)}
          </div>
          {!flowOnly && <>
            <label className="stm-service-filter" htmlFor="stm-service-filter">
              <span>Show</span>
              <select id="stm-service-filter" aria-label="Filter servers by category" value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTER_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <span className="stm-service-count" aria-live="polite">
              {filter === "all" || filter === "flow" ? `${SERVER_MAP.length} services` : `${SERVER_MAP.filter((node) => matchesFilter(node, filter)).length} shown`}
            </span>
          </>}
          <div className="stm-toolbar__spacer" />
          <div className="stm-layers" role="group" aria-label="Connection label detail">
            {LAYER_OPTIONS.map(([key, label]) => <button key={key} type="button" aria-pressed={activeLayer === key} onClick={() => setActiveLayer(key)}>{label}</button>)}
          </div>
          <label className="stm-flow-toggle" htmlFor="stm-flow-only">
            <input id="stm-flow-only" type="checkbox" checked={flowOnly} onChange={toggleFlowOnly} />
            <span>Flow boxes only</span>
          </label>
          <ServerTopologyExportControls />
        </div>
      </header>

      <section id="stm-topology-flow-pane" className="stm-flow-pane" aria-label="Playback and selected flow">
        <section className="stm-playback" aria-label="Flow playback controls">
          <div className="stm-segmented" role="group" aria-label="Privilege agent-to-agent diagrams">
            {A2A_FLOW_BUTTONS.map(([key, label]) => <button key={key} type="button" aria-pressed={scenario === key && flowOnly} onClick={() => showFlowDiagram(key)} title={PLAYBACKS[key].label}>{label}</button>)}
          </div>
          <label htmlFor="stm-playback-scenario">Choose a request flow</label>
          <select id="stm-playback-scenario" value={scenario} onChange={selectScenario}>
            {Object.entries(PLAYBACKS).map(([key, item]) => <option value={key} key={key}>{item.label} — {item.resultShort}</option>)}
          </select>
          <span className="stm-playback__progress" aria-live="polite">Step {stepIndex + 1} of {playback.steps.length}</span>
          <button type="button" onClick={() => moveStep(-1)} disabled={stepIndex === 0} aria-label="Previous hop">Previous</button>
          <button className="stm-play-button" type="button" onClick={togglePlaying}>{playing ? "Pause" : "Play"}</button>
          <button type="button" onClick={() => moveStep(1)} disabled={stepIndex >= playback.steps.length - 1} aria-label="Next hop">Next</button>
          <button type="button" onClick={reset} title="Clear the walkthrough and start over">Reset</button>
          <StepTimeSelector value={stepMs} options={STEP_TIME_OPTIONS} onChange={setStepMs} />
        </section>
        <section className="stm-flow-summary" aria-label="Selected flow and expected result" aria-live="polite">
          <div className="stm-flow-summary__outcome"><strong>Expected result</strong><span title={playback.result}>{playback.result}</span></div>
          <ol className="stm-flow-summary__steps" aria-label="Numbered flow steps" ref={stepListRef}>
            {playback.steps.map((step, index) => <li key={`${step.edgeId}-${index}`} aria-current={index === stepIndex ? "step" : undefined}><button type="button" aria-label={`Step ${String(index + 1).padStart(2, "0")}: ${step.title}`} onClick={() => selectPlaybackStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{step.title}</button></li>)}
          </ol>
        </section>
      </section>

      <TopologyResizeHandle
        label="Resize playback and results pane"
        controls="stm-topology-flow-pane"
        value={flowSize}
        min={isNarrow ? PANE_SIZE_LIMITS.flowNarrow.min : PANE_SIZE_LIMITS.flow.min}
        max={isNarrow ? PANE_SIZE_LIMITS.flowNarrow.max : PANE_SIZE_LIMITS.flow.max}
        axis="y"
        direction={1}
        onResize={resizeFlow}
      />

      <section id="stm-topology-workspace" className={`stm-workspace${detailsOpen ? "" : " stm-workspace--map-only"}`} aria-label="Server graph and selected details">
        <div className="stm-graph-panel">
          <div className="stm-graph-caption"><strong>{flowOnly ? "Current flow" : "Service map"}</strong><span>{deployment === "local" ? "Local Docker network" : "Kubernetes · ai-demo namespace"}</span><span className="stm-scroll-hint">Drag to pan · scroll to zoom</span><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Hide details" : "Show details"}</button></div>
          <ReactFlowProvider>
            <CanvasWithFit
              deployment={deployment} filter={filter} flowOnly={flowOnly} activeLayer={activeLayer} detailsOpen={detailsOpen} selectedNode={selectedNode} stepNode={stepNode}
              selectedEdge={selectedEdge} activePlaybackEdge={activePlaybackEdge} playbackSteps={playback.steps} playing={playing} stepIndex={stepIndex} onSelectNode={selectNode}
              onSelectEdge={selectEdge} onClearSelection={clearSelection}
            />
          </ReactFlowProvider>
          <div className="stm-legend" aria-label="Diagram legend">
            <strong className="stm-legend__heading">Boxes</strong>
            {NODE_TYPE_LABELS.map(([key, label]) => <span key={key}><i className="stm-legend__node" style={{ "--stm-accent": NODE_TYPE_COLORS[key] }} />{label}</span>)}
            <span><i className="stm-legend__card stm-legend__card--ping" />Ping product (identity, gateway)</span>
            <span><i className="stm-legend__card stm-legend__card--safety" />Safety / step-up (HITL)</span>
            <strong className="stm-legend__heading">Arrows</strong>
            <span><b className="stm-num-key">n</b>Step n, same number as in the step bar</span>
            <span><b className="stm-num-key stm-num-key--extra">n</b>Arrow outside this flow: numbered after the last step</span>
            <span><i className="stm-legend__solid" />Solid: request path</span>
            <span><i className="stm-legend__optional" />Dashed: a later step, a policy decision, optional profile or telemetry</span>
            <span className="stm-legend__kinds">{[["mcp", "MCP / HTTP"], ["oauth", "OAuth / identity"], ["agent", "Agent / model"], ["telemetry", "Telemetry"]].map(([key, label]) => <span key={key}><i style={{ "--stm-accent": EDGE_COLORS[key] }} />{label}</span>)}</span>
            <span>Words show for the step in focus or on hover</span>
          </div>
        </div>
        {detailsOpen && <TopologyResizeHandle
          label="Resize map and details pane"
          controls="stm-topology-details"
          value={isNarrow ? detailsHeight : detailsWidth}
          min={isNarrow ? PANE_SIZE_LIMITS.detailsHeight.min : PANE_SIZE_LIMITS.detailsWidth.min}
          max={isNarrow ? PANE_SIZE_LIMITS.detailsHeight.max : PANE_SIZE_LIMITS.detailsWidth.max}
          axis={isNarrow ? "y" : "x"}
          direction={-1}
          onResize={isNarrow ? resizeDetailsHeight : resizeDetailsWidth}
        />}
        {detailsOpen && <DetailPanel
          selectedNode={selectedNode} stepNode={stepNode} selectedEdge={playing ? activePlaybackEdge : selectedEdge} deployment={deployment}
          activeStep={stepDetails} playback={playback} onClear={clearSelection} panelRef={detailsRef}
        />}
      </section>

      <TopologyResizeHandle
        label="Resize network and mTLS notes"
        controls="stm-topology-notes"
        value={notesSize}
        min={isNarrow ? PANE_SIZE_LIMITS.notesNarrow.min : PANE_SIZE_LIMITS.notes.min}
        max={isNarrow ? PANE_SIZE_LIMITS.notesNarrow.max : PANE_SIZE_LIMITS.notes.max}
        axis="y"
        direction={-1}
        onResize={resizeNotes}
      />

      <footer id="stm-topology-notes" className="stm-notes">
        <span><strong>NetworkPolicy:</strong> <code>ai-demo-internal</code> allows ingress from <code>ai-demo</code> and <code>ingress-nginx</code>; egress to the namespace, DNS over TCP/UDP 53, and public TCP 80/443, excluding AWS metadata IPs.</span>
        <span><strong>mTLS:</strong> local MCP mTLS is opt-in; checked-in Kubernetes manifests do not declare workload mTLS for these service hops. RFC 8705 covers OAuth mTLS, not generic workload mTLS or SPIFFE.</span>
      </footer>
    </main>
  );
}

// A zone backdrop carries the servers sitting inside it (judged by where the layout first puts them).
const ZONE_MEMBERS = Object.fromEntries(SERVER_ZONES.map((zone) => [
  zone.id,
  SERVER_MAP.filter((n) => n.position.x >= zone.position.x && n.position.y >= zone.position.y
    && n.position.x <= zone.position.x + zone.style.width && n.position.y <= zone.position.y + zone.style.height).map((n) => n.id),
]));
const carryZoneMembers = (node) => (node.type === "zone" ? ZONE_MEMBERS[node.id] || [] : []);

export default function ServerTopologyPage() {
  return <ServerTopologyContent />;
}
