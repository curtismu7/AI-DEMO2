// demo_api_ui/src/components/ArchitectureSimSvg.jsx
import { memo, useMemo } from 'react';
import { ReactFlow, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './ArchitectureSimSvg.css';

/**
 * React Flow architecture diagram for the simulation page.
 *
 * Node size: 130 × 52 flow units (unchanged from the original SVG geometry —
 * COL/ROW below are the same grid the hand-coded version used).
 *
 * Node IDs match architecture-sim-scenarios.js:
 *   n-browser, n-bff, n-mcp-gw, n-mcp-server, n-mcp-resource-server,
 *   n-agent, n-pingone, n-pingauthorize, n-hitl, n-mortgage, n-resource-server
 *
 * Edge IDs: e-{source}-{dest} e.g. e-browser-bff, e-bff-mcpgw, …
 * Colors are intentionally fixed regardless of theme — ArchitectureOverviewPage's
 * legend hardcodes this same palette and documents it as theme-independent.
 */

// ── Layout constants (same grid as the original hand-coded SVG) ────────────
const NW = 130;  // node width
const NH = 52;   // node height

const COL = { browser: 20, bff: 200, mcpGw: 400, services: 620, external: 830 };
const ROW = { top: 30, mid: 180, lower: 330, bot: 420 };
const cx = (x) => x + NW / 2;
const cy = (y) => y + NH / 2;
// Clear gap between the mortgage row (bottom = ROW.mid + NH + 10 + NH = 294)
// and the resource-server row (ROW.lower = 330) — edges that must not look
// like they route through the resource server cross here instead.
const ABOVE_RS = 308;

// ── Nodes — id, position and label copied from the original SimNode calls ──
const NODES = [
  { id: 'n-browser', x: COL.browser, y: ROW.top, label: 'Browser', sub: 'port 4000',
    tooltip: "User's browser — holds only an httpOnly session cookie; no tokens are ever stored client-side" },
  { id: 'n-bff', x: COL.bff, y: ROW.top, label: 'BFF', sub: 'demo_api_server :3001',
    tooltip: 'Backend For Frontend — sole OAuth token custodian; resolves session cookie to access token; never exposes tokens to the browser' },
  { id: 'n-mcp-gw', x: COL.mcpGw, y: ROW.top, label: 'Agent Gateway', sub: 'Agent Gateway :3036',
    tooltip: 'Agent Gateway — central enforcement point; default is the real product (:3036, ff_mcp_gateway_pinggateway=true); demo Node Gateway (:3005) is the opt-in demo-auth path; introspects token then consults PingOne Authorize before every tool call; validates aud (D-05 anti-bypass)' },
  { id: 'n-mcp-server', x: COL.services, y: ROW.top, label: 'MCP Server', sub: ':8080',
    tooltip: 'MCP Server (:8080) — executes banking tools; validates token aud and scopes per tool; checks act claim for delegated agent authority' },
  { id: 'n-agent', x: COL.mcpGw, y: ROW.mid, label: 'Agent Service', sub: ':3006 / :8888',
    tooltip: 'Agent Service — LangChain (:8888) / OpenAI Agents (:8891) / Mastra (:8892) / Pydantic AI (:8893) / LM Studio (:3006); translates natural language to MCP tool calls' },
  { id: 'n-mcp-resource-server', x: COL.services, y: ROW.mid, label: 'MCP Resource Server', sub: ':8081',
    tooltip: 'MCP Resource Server (:8081) — dedicated MCP resource server for investment and portfolio tools; separate instance for financial data' },
  { id: 'n-mortgage', x: COL.services, y: ROW.mid + NH + 10, label: 'API Resource Server', sub: ':8082',
    tooltip: 'API Resource Server (:8082) — REST API resource server using API key auth; reached via Ping Agent Gateway Path A (api_key disposition)' },
  { id: 'n-pingone', x: COL.external, y: ROW.mid, label: 'PingOne', sub: 'OAuth AS',
    tooltip: 'PingOne — OAuth 2.0 Authorization Server and Identity Provider; issues tokens, validates may_act for RFC 8693 token exchange, enforces PKCE' },
  { id: 'n-resource-server', x: COL.services, y: ROW.lower, label: 'Resource Server', sub: '/api/resource-server',
    tooltip: 'Resource Server (/api/resource-server) — validates access tokens independently; serves banking data; used in Path B (dual-token) and Path C (oauth_bearer) dispositions' },
  { id: 'n-pingauthorize', x: COL.external, y: ROW.lower, label: 'PingOne Authorization Server', sub: 'cloud PDP',
    tooltip: 'PingOne Authorization Server — policy decision point (PDP); returns PERMIT, DENY, or INDETERMINATE for every MCP tool call; real cloud Authorize by default (outage → fail-closed deny 503); mock at :9001 is opt-in via ff_authorize_real / AUTHORIZE_FAILOVER_MODE=fallback_simulated' },
  { id: 'n-hitl', x: COL.services, y: ROW.bot, label: 'HITL Service', sub: ':3009',
    tooltip: 'HITL Service (:3009) — Human-In-The-Loop consent; creates time-limited challenges after PingOne Authorization Server INDETERMINATE signals; binds each challenge to userId + agentId + tool' },
];

// Column headers. Plain flow nodes (not React Flow chrome) so they pan and
// zoom with the diagram instead of floating fixed over the viewport.
const COL_LABEL_Y = ROW.top - 22;
const COL_LABELS = [
  { id: 'label-browser', x: COL.browser, label: 'Client' },
  { id: 'label-bff', x: COL.bff, label: 'BFF' },
  { id: 'label-mcpgw', x: COL.mcpGw, label: 'MCP Layer' },
  { id: 'label-services', x: COL.services, label: 'Services' },
  { id: 'label-external', x: COL.external, label: 'PingOne / Authz' },
];

// ── Edges — id, endpoints and waypoints copied from the original <SimEdge>
// JSX. Multi-segment edges (routed around the resource-server row, or fanned
// out from the same node side) become one polyline each instead of two or
// three separate <line> elements sharing a state.
const EDGES = [
  { id: 'e-browser-bff', source: 'n-browser', target: 'n-bff',
    points: [[COL.browser + NW, cy(ROW.top)], [COL.bff, cy(ROW.top)]] },
  { id: 'e-bff-mcpgw', source: 'n-bff', target: 'n-mcp-gw',
    points: [[COL.bff + NW, cy(ROW.top)], [COL.mcpGw, cy(ROW.top)]] },
  { id: 'e-mcpgw-mcpserver', source: 'n-mcp-gw', target: 'n-mcp-server',
    points: [[COL.mcpGw + NW, cy(ROW.top)], [COL.services, cy(ROW.top)]] },
  { id: 'e-mcpgw-mortgage', source: 'n-mcp-gw', target: 'n-mortgage',
    points: [[cx(COL.mcpGw), ROW.top + NH], [cx(COL.mcpGw), cy(ROW.mid + NH + 10)], [COL.services, cy(ROW.mid + NH + 10)]] },
  { id: 'e-mcpgw-resourceserver', source: 'n-mcp-gw', target: 'n-resource-server',
    points: [[COL.mcpGw + NW, cy(ROW.lower)], [COL.services, cy(ROW.lower)]] },
  { id: 'e-bff-pingone', source: 'n-bff', target: 'n-pingone',
    points: [[cx(COL.bff), ROW.top + NH], [cx(COL.bff), cy(ROW.mid)], [COL.external, cy(ROW.mid)]] },
  { id: 'e-mcpgw-pingone', source: 'n-mcp-gw', target: 'n-pingone',
    points: [[cx(COL.mcpGw), ROW.top + NH], [cx(COL.mcpGw), cy(ROW.mid) + 15], [COL.external, cy(ROW.mid) + 15]] },
  { id: 'e-bff-pingauth', source: 'n-bff', target: 'n-pingauthorize',
    points: [[cx(COL.bff), ROW.top + NH], [cx(COL.bff), ABOVE_RS], [cx(COL.external), ABOVE_RS], [cx(COL.external), ROW.lower]] },
  { id: 'e-bff-hitl', source: 'n-bff', target: 'n-hitl',
    points: [[cx(COL.bff), ROW.top + NH], [cx(COL.bff), cy(ROW.bot)], [COL.services, cy(ROW.bot)]] },
  // Offset +12/+24 from the gateway's own center so this fans out visually
  // distinct from e-mcpgw-pingone / e-mcpgw-mortgage, which share its top edge.
  { id: 'e-mcpgw-pingauth', source: 'n-mcp-gw', target: 'n-pingauthorize',
    points: [[cx(COL.mcpGw) + 12, ROW.top + NH], [cx(COL.mcpGw) + 12, ABOVE_RS], [cx(COL.external), ABOVE_RS], [cx(COL.external), ROW.lower]] },
  { id: 'e-mcpgw-hitl', source: 'n-mcp-gw', target: 'n-hitl',
    points: [[cx(COL.mcpGw) + 24, ROW.top + NH], [cx(COL.mcpGw) + 24, cy(ROW.bot)], [COL.services, cy(ROW.bot)]] },
];

// React Flow needs a parent-before-children node order and a position per
// node; these are absolute (non-draggable) so the id list order doesn't
// matter here the way it does for sub-flows.
const FLOW_NODES = [
  ...COL_LABELS.map((c) => ({
    id: c.id, type: 'colLabel', position: { x: c.x, y: COL_LABEL_Y }, width: NW, height: 16,
    data: { label: c.label },
  })),
  ...NODES.map((n) => ({
    id: n.id, type: 'sim', position: { x: n.x, y: n.y }, width: NW, height: NH,
    data: { label: n.label, sub: n.sub, tooltip: n.tooltip },
  })),
];

// Edges below draw their own explicit polyline (see SimEdge) rather than
// connecting to a handle's position, so a single hidden source/target pair
// is enough — React Flow just needs one to exist to accept the edge at all.
function SimNode({ data }) {
  return (
    <div className="asim-node" data-state={data.state} title={data.tooltip}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="asim-node-label">{data.label}</span>
      {data.sub && <span className="asim-node-sub">{data.sub}</span>}
      {data.state === 'done' && <span className="asim-node-badge">✅</span>}
      {data.state === 'blocked' && <span className="asim-node-badge">❌</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

// One polyline per logical edge, replacing 1-3 <SimEdge> lines that used to
// share a state. React Flow's own source/target only drive its internal
// bookkeeping here — the drawn path is the exact waypoint list above, so the
// routing around the resource-server row survives unchanged.
function SimEdge({ data }) {
  const d = `M${data.points.map(([x, y]) => `${x},${y}`).join(' L')}`;
  return (
    <path d={d} className="asim-edge" data-state={data.state} markerEnd={`url(#asim-arrow-${data.state})`}>
      <title>{data.id}</title>
    </path>
  );
}

function ColLabel({ data }) {
  return <div className="asim-col-label">{data.label}</div>;
}

const NODE_TYPES = { sim: SimNode, colLabel: ColLabel };
const EDGE_TYPES = { sim: SimEdge };

function ArrowDefs() {
  // React Flow renders edges inside its own <svg>; a <defs> sibling among the
  // edge paths is enough for markerEnd url(#…) references to resolve.
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        {['idle', 'active', 'done', 'blocked'].map((state) => (
          <marker key={state} id={`asim-arrow-${state}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" className="asim-arrowhead" data-state={state} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function ArchitectureSimSvg({ nodeStates = {}, edgeStates = {} }) {
  const flowNodes = useMemo(
    () => FLOW_NODES.map((n) => ({ ...n, data: { ...n.data, state: nodeStates[n.id] ?? 'idle' } })),
    [nodeStates],
  );
  const flowEdges = useMemo(
    () => EDGES.map((e) => ({ ...e, type: 'sim', data: { ...e, state: edgeStates[e.id] ?? 'idle' } })),
    [edgeStates],
  );

  return (
    <div className="asim-canvas" aria-label="Banking demo architecture diagram">
      <ArrowDefs />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.5}
        maxZoom={2}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default memo(ArchitectureSimSvg);
