import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const W = 150;
const H = 58;
const R = 6;
const STAGE_W = 1400;  // fixed wide canvas — wrapper scrolls on small screens

const LAYER_STYLE = {
  client:   { fill: '#e0e7ff', stroke: '#4f46e5', label: '#1e1b4b', sub: '#6366f1' },
  gateway:  { fill: '#ede9fe', stroke: '#7c3aed', label: '#2e1065', sub: '#8b5cf6' },
  agent:    { fill: '#d1fae5', stroke: '#059669', label: '#064e3b', sub: '#10b981' },
  mcp:      { fill: '#fef3c7', stroke: '#d97706', label: '#78350f', sub: '#b45309' },
  policy:   { fill: '#fce7f3', stroke: '#db2777', label: '#831843', sub: '#ec4899' },
  backend:  { fill: '#e0f2fe', stroke: '#0284c7', label: '#0c4a6e', sub: '#0ea5e9' },
  tool:     { fill: '#f1f5f9', stroke: '#64748b', label: '#1e293b', sub: '#94a3b8' },
};

const STATUS_COLOR = {
  up: '#22c55e', down: '#ef4444', timeout: '#f59e0b',
  error: '#f97316', unknown: '#94a3b8', pinging: '#3b82f6',
};

const COL_LABELS = [
  { x: 30,   label: 'Browser' },
  { x: 220,  label: 'BFF' },
  { x: 430,  label: 'Agent Layer' },
  { x: 640,  label: 'Gateway' },
  { x: 850,  label: 'Policy / HITL' },
  { x: 1060, label: 'MCP Backends' },
];

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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function buildDrawio(nodes, edges, flow) {
  const activeNodes = flow
    ? nodes.filter(n => flow.steps.some(s => s.from === n.id || s.to === n.id))
    : nodes;
  const activeEdges = flow
    ? flow.steps.map((step, i) => ({ id: `flow-e-${i}`, from: step.from, to: step.to, label: String(i + 1) }))
    : edges.map(e => ({ id: e.id, from: e.from, to: e.to, label: '' }));
  const nodeSet = new Set(activeNodes.map(n => n.id));

  let cells = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
  activeNodes.forEach(n => {
    const s = LAYER_STYLE[n.layer] || LAYER_STYLE.tool;
    const lbl = n.sub ? `${n.label}&lt;br/&gt;&lt;font style="font-size:10px;color:${s.sub}"&gt;${n.sub}&lt;/font&gt;` : n.label;
    cells += `<mxCell id="${escapeXml(n.id)}" value="${escapeXml(lbl)}" `
      + `style="rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=${s.fill};strokeColor=${s.stroke};`
      + `fontColor=${s.label};fontStyle=1;fontSize=12;" `
      + `vertex="1" parent="1">`
      + `<mxGeometry x="${n.x}" y="${n.y}" width="${W}" height="${H}" as="geometry"/>`
      + `</mxCell>`;
  });
  activeEdges.forEach((e, i) => {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) return;
    cells += `<mxCell id="${escapeXml(e.id || `edge-${i}`)}" value="${escapeXml(e.label || '')}" `
      + `style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;" `
      + `edge="1" source="${escapeXml(e.from)}" target="${escapeXml(e.to)}" parent="1">`
      + `<mxGeometry relative="1" as="geometry"/>`
      + `</mxCell>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<mxfile><diagram name="Architecture">`
    + `<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" `
    + `connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169">`
    + `<root>${cells}</root></mxGraphModel></diagram></mxfile>`;
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

function portCentre(node) {
  return { x: node.x + W / 2, y: node.y + H / 2 };
}

function arrowPoints(src, tgt) {
  const s = portCentre(src);
  const t = portCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

function midpoint(pts) {
  return { x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 };
}

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [stageH, setStageH] = useState(580);
  const [pingStatus, setPingStatus] = useState({});
  const [pinging, setPinging] = useState(false);
  const [resultPanel, setResultPanel] = useState(null);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(entries => {
      setStageH(Math.max(entries[0].contentRect.height, 400));
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const handleDragEnd = useCallback((id, e) => {
    moveNode(id, e.target.x(), e.target.y());
  }, [moveNode]);

  const handleNodeClick = useCallback((id) => {
    if (!connectMode) return;
    if (!connectFrom) { setConnectFrom(id); return; }
    if (connectFrom === id) { setConnectFrom(null); return; }
    addEdge(connectFrom, id);
    setConnectFrom(null);
    setConnectMode(false);
  }, [connectMode, connectFrom, addEdge]);

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
    ? (connectFrom ? `Now click the target node` : 'Click the source node')
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
              onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}>
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
              downloadFile(buildDrawio(nodes, edges, flow), `architecture${slug}.drawio`, 'application/xml');
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
        <Stage width={STAGE_W} height={stageH}>
          {/* Background */}
          <Layer>
            <Rect x={0} y={0} width={STAGE_W} height={stageH} fill="#f8fafc" />
          </Layer>

          {/* Column labels */}
          <Layer>
            {COL_LABELS.map(col => (
              <Text key={col.label} x={col.x} y={10} width={W}
                text={col.label} fontSize={10} fontStyle="600"
                fontFamily="system-ui, sans-serif" fill="#94a3b8" align="center" listening={false} />
            ))}
          </Layer>

          {/* Base edges — dimmed when a flow is active */}
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
                  stroke={isSelected ? '#ef4444' : dimmed ? '#d1d5db' : '#94a3b8'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  fill={isSelected ? '#ef4444' : dimmed ? '#d1d5db' : '#94a3b8'}
                  pointerLength={8} pointerWidth={7} hitStrokeWidth={16}
                  opacity={dimmed && !isSelected ? 0.4 : 1}
                  onClick={() => setSelectedEdge(edge.id === selectedEdge ? null : edge.id)}
                />
              );
            })}
          </Layer>

          {/* Nodes — dimmed when a flow is active */}
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

              return (
                <Group key={node.id} x={node.x} y={node.y}
                  draggable={!connectMode} opacity={dimmed ? 0.25 : 1}
                  onDragEnd={e => handleDragEnd(node.id, e)}
                  onClick={() => handleNodeClick(node.id)}
                  onDblClick={() => handleNodeDblClick(node)}
                >
                  <Rect x={2} y={3} width={W} height={H} cornerRadius={R} fill="rgba(0,0,0,0.07)" />
                  <Rect width={W} height={H} cornerRadius={R} fill={style.fill}
                    stroke={strokeColor} strokeWidth={strokeWidth} />
                  <Rect width={5} height={H} cornerRadius={[R, 0, 0, R]} fill={style.stroke} />
                  <Text x={12} y={node.sub ? 10 : 19} width={W - 20}
                    text={node.label} fontSize={12} fontStyle="bold"
                    fontFamily="system-ui, sans-serif" fill={style.label} ellipsis listening={false} />
                  {node.sub && (
                    <Text x={12} y={30} width={W - 20} text={node.sub}
                      fontSize={10} fontFamily="system-ui, sans-serif"
                      fill={style.sub} ellipsis listening={false} />
                  )}
                  {dotColor && (
                    <Circle x={W - 8} y={8} radius={5} fill={dotColor}
                      stroke="#fff" strokeWidth={1.5} listening={false} />
                  )}
                </Group>
              );
            })}
          </Layer>

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
