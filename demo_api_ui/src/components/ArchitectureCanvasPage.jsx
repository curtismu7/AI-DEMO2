import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const W = 155;
const H = 86;
const H_ICON = 36;   // colored icon strip height
const R = 8;
const STAGE_W = 1400;  // fixed wide canvas — wrapper scrolls on small screens

const LAYER_STYLE = {
  client:   { fill: '#f0f4ff', stroke: '#4f46e5', label: '#1e1b4b', sub: '#6366f1', icon: '#4f46e5' },
  gateway:  { fill: '#f5f3ff', stroke: '#7c3aed', label: '#2e1065', sub: '#8b5cf6', icon: '#7c3aed' },
  agent:    { fill: '#f0fdf4', stroke: '#059669', label: '#064e3b', sub: '#10b981', icon: '#059669' },
  mcp:      { fill: '#fffbeb', stroke: '#d97706', label: '#78350f', sub: '#b45309', icon: '#d97706' },
  policy:   { fill: '#fdf2f8', stroke: '#db2777', label: '#831843', sub: '#ec4899', icon: '#db2777' },
  backend:  { fill: '#f0f9ff', stroke: '#0284c7', label: '#0c4a6e', sub: '#0ea5e9', icon: '#0284c7' },
  tool:     { fill: '#f8fafc', stroke: '#475569', label: '#1e293b', sub: '#64748b', icon: '#475569' },
};

// Per-node icon — falls back to LAYER_ICON
const NODE_ICON = {
  frontend:          '🌐',
  bff:               '⚡',
  'langchain-agent': '🤖',
  'agent-service':   '🤖',
  'mcp-gateway':     '🔀',
  'ping-gateway':    '🔀',
  'authz-server':    '🛡️',
  'hitl-service':    '✋',
  'mcp-server':      '🏦',
  'mcp-invest':      '📈',
  'mortgage-service':'🏠',
};

const LAYER_ICON = {
  client: '🌐', gateway: '⚡', agent: '🤖', mcp: '🔀',
  policy: '🛡️', tool: '✋', backend: '🗄️',
};

const STATUS_COLOR = {
  up: '#22c55e', down: '#ef4444', timeout: '#f59e0b',
  error: '#f97316', unknown: '#94a3b8', pinging: '#3b82f6',
};

// Column definitions — which node IDs anchor each header
const COL_DEFS = [
  { ids: ['frontend'],                               label: 'Browser' },
  { ids: ['bff'],                                    label: 'BFF' },
  { ids: ['langchain-agent', 'agent-service'],       label: 'Agent Layer' },
  { ids: ['mcp-gateway', 'ping-gateway'],            label: 'Gateway' },
  { ids: ['authz-server', 'hitl-service'],           label: 'Policy / HITL' },
  { ids: ['mcp-server', 'mcp-invest', 'mortgage-service'], label: 'MCP Backends' },
];

function colLabelX(colDef, nodeMap) {
  const xs = colDef.ids.map(id => nodeMap[id]?.x).filter(x => x != null);
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Named flows — each step maps to an arrow on the canvas
const FLOWS = {
  agui: {
    label: 'AG-UI · Streaming',
    color: '#059669',
    steps: [
      { from: 'frontend',        to: 'bff',             desc: 'User sends a message. Browser POSTs to BFF (/api/agent/run) and opens an SSE stream for the response.' },
      { from: 'bff',             to: 'langchain-agent', desc: 'BFF forwards to LangChain agent (POST :8888/run) with tool schemas, thread ID, and a callback URL for tool execution.' },
      { from: 'langchain-agent', to: 'bff',             desc: 'Agent decides to call a tool. It POSTs back to BFF (/internal/agent-tool) with the tool name and arguments.' },
      { from: 'bff',             to: 'mcp-gateway',     desc: 'BFF performs RFC 8693 token exchange (user token → mcp-gateway-scoped delegated token with act claim), then POSTs JSON-RPC tools/call.' },
      { from: 'mcp-gateway',     to: 'authz-server',    desc: 'Gateway sends 18-parameter policy decision to PingAuthorize (P1AZ): user, tool, scopes, amounts, act chain. Expects PERMIT / DENY / INDETERMINATE.' },
      { from: 'mcp-gateway',     to: 'mcp-server',      desc: 'PERMIT received. Gateway opens a WebSocket to mcp-server and proxies the tools/call. Result travels back up the chain to the browser.' },
    ],
  },
  nl: {
    label: 'NL Mode · Agent service',
    color: '#7c3aed',
    steps: [
      { from: 'frontend',      to: 'bff',          desc: 'User sends a natural-language message. Browser POSTs to BFF (/api/demo-agent/message).' },
      { from: 'bff',           to: 'agent-service', desc: 'BFF dispatches to agent-service (/api/agent/reason) with tool schemas only — no user tokens leave the BFF.' },
      { from: 'agent-service', to: 'bff',           desc: 'Agent-service returns tool_calls from the LLM. BFF executes each tool via its own MCP pipeline and loops until it gets a final answer.' },
      { from: 'bff',           to: 'mcp-gateway',   desc: 'BFF performs RFC 8693 exchange then calls mcp-gateway with the delegated token.' },
      { from: 'mcp-gateway',   to: 'authz-server',  desc: 'PingAuthorize evaluates the request (user identity, tool, scopes, transaction amount).' },
      { from: 'mcp-gateway',   to: 'mcp-server',    desc: 'PERMIT → gateway proxies the tool call over WebSocket to the mcp-server backend.' },
    ],
  },
  hitl: {
    label: 'HITL · Human approval',
    color: '#db2777',
    steps: [
      { from: 'frontend',     to: 'bff',          desc: 'High-value action triggered (e.g. large transfer). BFF initiates the MCP tool call pipeline.' },
      { from: 'bff',          to: 'mcp-gateway',   desc: 'BFF calls mcp-gateway with RFC 8693 delegated token and full transaction context.' },
      { from: 'mcp-gateway',  to: 'authz-server',  desc: 'PingAuthorize evaluates policy and returns INDETERMINATE — the transaction requires explicit human approval.' },
      { from: 'mcp-gateway',  to: 'hitl-service',  desc: 'Gateway creates a challenge (POST /challenges) and returns JSON-RPC error -32002 to BFF with challengeId.' },
      { from: 'hitl-service', to: 'bff',           desc: 'User approves the challenge in the UI. HITL service notifies BFF; agent retries the tool call with _hitl_challenge_id.' },
      { from: 'mcp-gateway',  to: 'mcp-server',    desc: 'P1AZ now returns PERMIT for the approved challenge. Tool executes on mcp-server and result returns to user.' },
    ],
  },
  pinggateway: {
    label: 'ping-gateway · IG path',
    color: '#d97706',
    steps: [
      { from: 'frontend',        to: 'bff',          desc: 'User action with ff_mcp_gateway_pinggateway=true. BFF selects PingGateway (IG) instead of the Node mcp-gateway.' },
      { from: 'bff',             to: 'langchain-agent', desc: 'BFF routes to LangChain agent for reasoning (AG-UI SSE path).' },
      { from: 'langchain-agent', to: 'bff',          desc: 'Agent calls back to BFF (/internal/agent-tool) to execute a tool.' },
      { from: 'bff',             to: 'ping-gateway', desc: 'BFF routes to PingGateway (IG) with the same RFC 8693 delegated token.' },
      { from: 'ping-gateway',    to: 'authz-server', desc: 'IG runs p1az-decision.groovy filter — calls PingAuthorize for the same PERMIT/DENY decision.' },
      { from: 'ping-gateway',    to: 'mcp-server',   desc: 'PERMIT → IG performs its own RFC 8693 re-exchange to backend audience, then HTTP-proxies to mcp-server.' },
    ],
  },
};

// ── Export helpers ────────────────────────────────────────────────────────────


function sanitizeMermaidId(id) {
  return id.replace(/-/g, '_');
}

function buildMermaid(nodes, edges, flow) {
  const activeNodes = flow
    ? nodes.filter(n => flow.steps.some(s => s.from === n.id || s.to === n.id))
    : nodes;
  const activeEdges = flow
    ? flow.steps.map((step, i) => ({ from: step.from, to: step.to, label: String(i + 1) }))
    : edges.map(e => ({ from: e.from, to: e.to, label: null }));
  const nodeSet = new Set(activeNodes.map(n => n.id));

  const lines = ['flowchart LR'];
  activeNodes.forEach(n => {
    const sid = sanitizeMermaidId(n.id);
    const label = n.sub ? `${n.label}\\n${n.sub}` : n.label;
    lines.push(`  ${sid}["${label}"]:::${n.layer || 'tool'}`);
  });
  activeEdges.forEach(e => {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) return;
    const src = sanitizeMermaidId(e.from);
    const tgt = sanitizeMermaidId(e.to);
    lines.push(e.label ? `  ${src} -->|"${e.label}"| ${tgt}` : `  ${src} --> ${tgt}`);
  });
  const usedLayers = [...new Set(activeNodes.map(n => n.layer || 'tool'))];
  usedLayers.forEach(layer => {
    const s = LAYER_STYLE[layer] || LAYER_STYLE.tool;
    lines.push(`  classDef ${layer} fill:${s.fill},stroke:${s.stroke},color:${s.label}`);
  });
  return lines.join('\n');
}

// LucidChart CSV import format — Insert → Import Data → CSV in LucidChart
// Nodes: Id, Name, Notes (layer + sub-label)
// Edges: Id, Line Source, Line Destination, Label
function buildLucidCsv(nodes, edges, flow) {
  const activeNodes = flow
    ? nodes.filter(n => flow.steps.some(s => s.from === n.id || s.to === n.id))
    : nodes;
  const activeEdges = flow
    ? flow.steps.map((step, i) => ({ id: `e${i + 1}`, from: step.from, to: step.to, label: String(i + 1) }))
    : edges.map(e => ({ id: e.id, from: e.from, to: e.to, label: '' }));
  const nodeSet = new Set(activeNodes.map(n => n.id));

  // Assign numeric IDs LucidChart requires
  const idMap = {};
  activeNodes.forEach((n, i) => { idMap[n.id] = i + 1; });

  const csvEsc = v => `"${String(v).replace(/"/g, '""')}"`;

  const header = 'Id,Name,Notes,Shape Library,Line Source,Line Destination,Source Arrow,Destination Arrow,Label';
  const nodeRows = activeNodes.map(n =>
    [idMap[n.id], csvEsc(n.label), csvEsc(`${n.layer}${n.sub ? ' · ' + n.sub : ''}`), '', '', '', '', '', ''].join(',')
  );
  let edgeIdx = activeNodes.length + 1;
  const edgeRows = activeEdges
    .filter(e => nodeSet.has(e.from) && nodeSet.has(e.to))
    .map(e =>
      [edgeIdx++, '', '', '', idMap[e.from], idMap[e.to], 'none', 'arrow', csvEsc(e.label || '')].join(',')
    );

  return [header, ...nodeRows, ...edgeRows].join('\n');
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────

// Returns the point on node's bounding box edge in the direction of (toX, toY).
// outset > 0 pushes the point outside the box (so arrowhead tip sits on the border).
function boxEdgePoint(node, toX, toY, outset = 0) {
  const cx = node.x + W / 2;
  const cy = node.y + H / 2;
  const dx = toX - cx;
  const dy = toY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.5) return { x: cx, y: cy };
  const nx = dx / dist;
  const ny = dy / dist;
  const hw = W / 2;
  const hh = H / 2;
  // distance along unit vector to each edge
  let t = Infinity;
  if (Math.abs(nx) > 0.001) t = Math.min(t, hw / Math.abs(nx));
  if (Math.abs(ny) > 0.001) t = Math.min(t, hh / Math.abs(ny));
  return { x: cx + (t - outset) * nx, y: cy + (t - outset) * ny };
}

function arrowPoints(src, tgt) {
  const scx = src.x + W / 2;
  const scy = src.y + H / 2;
  const tcx = tgt.x + W / 2;
  const tcy = tgt.y + H / 2;
  // outset=1 pushes the tip 1px outside the border so the arrowhead is fully visible
  const s = boxEdgePoint(src, tcx, tcy, -1);
  const e = boxEdgePoint(tgt, scx, scy, 1);
  return [s.x, s.y, e.x, e.y];
}

function midpoint(pts) {
  return { x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 };
}

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);  // kept for keyboard/click fallback
  const [dragWire, setDragWire] = useState(null);         // { fromId, x1,y1, x2,y2 } while dragging
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [stageH, setStageH] = useState(620);
  const [pingStatus, setPingStatus] = useState({});
  const [pinging, setPinging] = useState(false);
  const [resultPanel, setResultPanel] = useState(null);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const wrapRef = useRef(null);
  const dragWireRef = useRef(null);  // mirrors dragWire for mousemove closure

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(entries => {
      setStageH(Math.max(entries[0].contentRect.height, 400));
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const handleDragMove = useCallback((id, e) => {
    moveNode(id, e.target.x(), e.target.y());
  }, [moveNode]);

  const handleDragEnd = useCallback((id, e) => {
    moveNode(id, e.target.x(), e.target.y());
  }, [moveNode]);

  const handleNodeClick = useCallback((id) => {
    // kept for non-drag interactions; drag path uses handleWireStart/End
    if (!connectMode || dragWireRef.current) return;
  }, [connectMode]);

  const handleWireStart = useCallback((node, e) => {
    if (!connectMode) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const cx = node.x + W / 2;
    const cy = node.y + H / 2;
    const wire = { fromId: node.id, x1: cx, y1: cy, x2: pos.x, y2: pos.y };
    dragWireRef.current = wire;
    setDragWire(wire);
  }, [connectMode]);

  const handleWireMove = useCallback((e) => {
    if (!dragWireRef.current) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const next = { ...dragWireRef.current, x2: pos.x, y2: pos.y };
    dragWireRef.current = next;
    setDragWire(next);
  }, []);

  const handleWireEnd = useCallback((targetId) => {
    const wire = dragWireRef.current;
    if (!wire) return;
    dragWireRef.current = null;
    setDragWire(null);
    if (targetId && targetId !== wire.fromId) {
      addEdge(wire.fromId, targetId);
    }
    setConnectMode(false);
  }, [addEdge]);

  const handleNodeDblClick = useCallback((node) => {
    if (connectMode) return;
    setRenaming({ id: node.id, value: node.label });
  }, [connectMode]);

  const handleRenameSubmit = () => {
    if (!renaming) return;
    const label = renaming.value.trim();
    if (label) renameNode(renaming.id, label);
    setRenaming(null);
  };

  const handleAddNode = () => {
    const label = newLabel.trim();
    if (!label) return;
    addNode(label);
    setNewLabel('');
  };

  const handleDeleteEdge = () => {
    if (!selectedEdge) return;
    removeEdge(selectedEdge);
    setSelectedEdge(null);
  };

  const handlePingAll = async () => {
    setPinging(true);
    setResultPanel(null);
    const pingingMap = {};
    nodes.forEach(n => { pingingMap[n.id] = 'pinging'; });
    setPingStatus(pingingMap);
    try {
      const res = await fetch('/api/canvas/ping', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: nodes.map(n => n.id) }),
      });
      const data = await res.json();
      const displayMap = {};
      (data.results || []).forEach(r => { displayMap[r.id] = r.status; });
      setPingStatus(displayMap);
      setResultPanel(data.results || []);
    } catch {
      const errMap = {};
      nodes.forEach(n => { errMap[n.id] = 'down'; });
      setPingStatus(errMap);
    } finally {
      setPinging(false);
    }
  };

  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const flow = selectedFlow ? FLOWS[selectedFlow] : null;

  const hint = renaming
    ? 'Press Enter or click Save to rename'
    : connectMode
    ? (dragWire ? 'Release on target node to connect' : 'Drag from any box to draw a connection')
    : selectedEdge
    ? 'Arrow selected — click Delete Edge to remove'
    : 'Drag to reposition · Double-click to rename · Click arrow to select';

  return (
    <div className="canvas-page">
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <h2>Architecture Canvas</h2>
        {renaming ? (
          <>
            <input className="rename-input" type="text" autoFocus value={renaming.value}
              onChange={e => setRenaming(r => ({ ...r, value: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null); }}
            />
            <button className="btn-add" onClick={handleRenameSubmit}>Save</button>
            <button className="btn-reset" onClick={() => setRenaming(null)}>Cancel</button>
          </>
        ) : (
          <>
            {/* Flow selector */}
            <select
              className="flow-select"
              value={selectedFlow || ''}
              onChange={e => setSelectedFlow(e.target.value || null)}
            >
              <option value="">All flows</option>
              {Object.entries(FLOWS).map(([k, f]) => (
                <option key={k} value={k}>{f.label}</option>
              ))}
            </select>

            <div className="toolbar-divider" />

            <input type="text" placeholder="New box name…" value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNode()}
            />
            <button className="btn-add" onClick={handleAddNode}>+ Add</button>
            <button className={`btn-connect${connectMode ? ' active' : ''}`}
              onClick={() => { setConnectMode(m => !m); setDragWire(null); dragWireRef.current = null; }}>
              {connectMode ? '⬡ Connecting…' : '⬡ Connect'}
            </button>
            <button className="btn-delete" disabled={!selectedEdge} onClick={handleDeleteEdge}>✕ Delete Edge</button>
            <button className={`btn-ping${pinging ? ' pinging' : ''}`} onClick={handlePingAll} disabled={pinging}>
              {pinging ? '⏳ Pinging…' : '⚡ Ping All'}
            </button>
            <button className="btn-export" onClick={() => {
              const slug = selectedFlow ? `-${selectedFlow}` : '-full';
              downloadFile(buildMermaid(nodes, edges, flow), `architecture${slug}.mmd`, 'text/plain');
            }}>⬇ Mermaid</button>
            <button className="btn-export" onClick={() => {
              const slug = selectedFlow ? `-${selectedFlow}` : '-full';
              downloadFile(buildLucidCsv(nodes, edges, flow), `architecture${slug}-lucid.csv`, 'text/csv');
            }}>⬇ LucidChart</button>
            <button className="btn-reset" onClick={() => {
              if (window.confirm('Reset canvas to default layout?')) {
                resetLayout(); setPingStatus({}); setResultPanel(null);
              }
            }}>↺ Reset</button>
          </>
        )}
      </div>

      <div className="canvas-hint">{hint}</div>

      {/* Ping results bar */}
      {resultPanel && (
        <div className="canvas-results">
          {resultPanel.map(r => (
            <span key={r.id} className={`ping-badge ping-badge--${r.status}`}>
              <span className="ping-dot" style={{ background: STATUS_COLOR[r.status] ?? '#94a3b8' }} />
              {r.id}{r.ms != null ? ` ${r.ms}ms` : ''}
            </span>
          ))}
          <button className="ping-dismiss" onClick={() => setResultPanel(null)}>✕</button>
        </div>
      )}

      {/* Scrollable canvas */}
      <div className="canvas-stage-wrap" ref={wrapRef}>
        <Stage width={STAGE_W} height={stageH}
          onMouseMove={connectMode ? handleWireMove : undefined}
          onMouseUp={connectMode ? () => handleWireEnd(null) : undefined}
          style={{ cursor: connectMode ? (dragWire ? 'crosshair' : 'cell') : 'default' }}
        >
          {/* Background */}
          <Layer>
            <Rect x={0} y={0} width={STAGE_W} height={stageH} fill="#f8fafc" />
          </Layer>

          {/* Column labels — x tracks the average position of member nodes */}
          <Layer>
            {COL_DEFS.map(col => {
              const lx = colLabelX(col, nodeMap);
              return (
                <Text key={col.label} x={lx} y={8} width={W}
                  text={col.label.toUpperCase()} fontSize={11} fontStyle="bold"
                  fontFamily="system-ui, sans-serif" fill="#64748b"
                  letterSpacing={1} align="center" listening={false} />
              );
            })}
          </Layer>

          {/* Nodes — Okta-style two-zone cards (drawn before edges so arrowheads sit on top) */}
          <Layer>
            {nodes.map(node => {
              const style = LAYER_STYLE[node.layer] ?? LAYER_STYLE.tool;
              const isConnectSrc = connectFrom === node.id;
              const strokeColor = isConnectSrc ? '#f59e0b' : connectMode ? '#3b82f6' : style.stroke;
              const strokeWidth = (isConnectSrc || connectMode) ? 2.5 : 1.5;
              const status = pingStatus[node.id];
              const dotColor = STATUS_COLOR[status];
              const inFlow = flow && flow.steps.some(s => s.from === node.id || s.to === node.id);
              const dimmed = !!flow && !inFlow;
              const icon = NODE_ICON[node.id] ?? LAYER_ICON[node.layer] ?? '📦';

              return (
                <Group key={node.id} x={node.x} y={node.y}
                  draggable={!connectMode} opacity={dimmed ? 0.2 : 1}
                  onDragMove={e => handleDragMove(node.id, e)}
                  onDragEnd={e => handleDragEnd(node.id, e)}
                  onClick={() => handleNodeClick(node.id)}
                  onDblClick={() => handleNodeDblClick(node)}
                  onMouseDown={connectMode ? e => handleWireStart(node, e) : undefined}
                  onMouseUp={connectMode ? () => handleWireEnd(node.id) : undefined}
                >
                  {/* Drop shadow */}
                  <Rect x={2} y={3} width={W} height={H} cornerRadius={R} fill="rgba(0,0,0,0.10)" />
                  {/* Card outline */}
                  <Rect width={W} height={H} cornerRadius={R}
                    fill={style.fill} stroke={strokeColor} strokeWidth={strokeWidth} />
                  {/* Colored icon zone (top strip) */}
                  <Rect width={W} height={H_ICON} cornerRadius={[R, R, 0, 0]} fill={style.icon} />
                  {/* Icon emoji centred in the strip */}
                  <Text x={0} y={5} width={W} text={icon}
                    fontSize={20} align="center" listening={false} />
                  {/* Node label */}
                  <Text x={8} y={H_ICON + 7} width={W - 16}
                    text={node.label} fontSize={11} fontStyle="bold"
                    fontFamily="system-ui, sans-serif" fill={style.label}
                    align="center" ellipsis listening={false} />
                  {/* Sub-label */}
                  {node.sub && (
                    <Text x={8} y={H_ICON + 22} width={W - 16} text={node.sub}
                      fontSize={9} fontFamily="ui-monospace, monospace"
                      fill={style.sub} align="center" ellipsis listening={false} />
                  )}
                  {/* Ping status dot */}
                  {dotColor && (
                    <Circle x={W - 9} y={9} radius={6} fill={dotColor}
                      stroke="#fff" strokeWidth={1.5} listening={false} />
                  )}
                </Group>
              );
            })}
          </Layer>

          {/* Base edges — drawn above nodes so arrowheads are never obscured */}
          <Layer>
            {edges.map(edge => {
              const src = nodeMap[edge.from];
              const tgt = nodeMap[edge.to];
              if (!src || !tgt) return null;
              const pts = arrowPoints(src, tgt);
              const isSelected = selectedEdge === edge.id;
              const dimmed = !!flow;
              return (
                <Arrow key={edge.id} points={pts}
                  stroke={isSelected ? '#ef4444' : dimmed ? '#d1d5db' : '#64748b'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  fill={isSelected ? '#ef4444' : dimmed ? '#d1d5db' : '#64748b'}
                  pointerLength={9} pointerWidth={8} hitStrokeWidth={16}
                  opacity={dimmed && !isSelected ? 0.35 : 1}
                  onClick={() => setSelectedEdge(edge.id === selectedEdge ? null : edge.id)}
                />
              );
            })}
          </Layer>

          {/* Rubber-band wire while dragging a connection */}
          {dragWire && (
            <Layer listening={false}>
              <Arrow
                points={[dragWire.x1, dragWire.y1, dragWire.x2, dragWire.y2]}
                stroke="#3b82f6" strokeWidth={2} fill="#3b82f6"
                pointerLength={9} pointerWidth={8} dash={[6, 4]}
              />
            </Layer>
          )}

          {/* Flow overlay — colored arrows + number badges */}
          {flow && (
            <Layer>
              {flow.steps.map((step, i) => {
                const src = nodeMap[step.from];
                const tgt = nodeMap[step.to];
                if (!src || !tgt) return null;
                const pts = arrowPoints(src, tgt);
                const mid = midpoint(pts);
                const num = String(i + 1);
                return (
                  <React.Fragment key={`fs-${i}`}>
                    <Arrow points={pts}
                      stroke={flow.color} strokeWidth={2.5} fill={flow.color}
                      pointerLength={9} pointerWidth={8} listening={false}
                      shadowColor={flow.color} shadowBlur={6} shadowOpacity={0.35}
                    />
                    {/* Number badge */}
                    <Circle x={mid.x} y={mid.y} radius={11}
                      fill={flow.color} stroke="#fff" strokeWidth={2} listening={false} />
                    <Text x={mid.x - 11} y={mid.y - 7} width={22}
                      text={num} fontSize={11} fontStyle="bold"
                      fontFamily="system-ui, sans-serif" fill="#fff"
                      align="center" listening={false} />
                  </React.Fragment>
                );
              })}
            </Layer>
          )}
        </Stage>
      </div>

      {/* Step explanation panel */}
      {flow && (
        <div className="canvas-steps">
          <div className="canvas-steps-header">
            <span className="canvas-steps-title" style={{ borderColor: flow.color, color: flow.color }}>
              {flow.label}
            </span>
            <span className="canvas-steps-sub">Numbered steps map to arrows on the diagram above</span>
            <button className="canvas-steps-close" onClick={() => setSelectedFlow(null)}>✕ Close</button>
          </div>
          <div className="canvas-steps-list">
            {flow.steps.map((step, i) => (
              <div key={i} className="canvas-step">
                <span className="canvas-step-num" style={{ background: flow.color }}>{i + 1}</span>
                <div className="canvas-step-body">
                  <span className="canvas-step-route">{step.from} → {step.to}</span>
                  <span className="canvas-step-desc">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
