import React, { useState, useCallback, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import useCanvasLayout from '../hooks/useCanvasLayout';
import { useDiagramStepper, stepEdges, markNodes } from '../hooks/useDiagramStepper';
import { useThemeOptional } from '../context/ThemeContext';
import DiagramStepBar from './DiagramStepBar';
import DiagramReel from './DiagramReel';
import FitOnResize from './FitOnResize';
import './ArchitectureCanvasPage.css';

const W = 155;
const H = 86;

// React Flow draws edge strokes and arrowheads as SVG attributes, which can't take --th-*
// tokens, so those need their own light/dark pair. Kept
// separate from the exported Mermaid/LucidChart files below, which stay on
// the light palette regardless of the app's theme (a downloaded diagram is a
// standalone artifact, not a themed page).
const LAYER_STYLE = {
  client:   { fill: '#f0f4ff', stroke: '#d20e0f', label: '#7f1d1d', sub: '#d20e0f', icon: '#d20e0f' },
  gateway:  { fill: '#fee2e2', stroke: '#d20e0f', label: '#7f1d1d', sub: '#d20e0f', icon: '#d20e0f' },
  agent:    { fill: '#f0fdf4', stroke: '#059669', label: '#064e3b', sub: '#10b981', icon: '#059669' },
  mcp:      { fill: '#fffbeb', stroke: '#d97706', label: '#78350f', sub: '#b45309', icon: '#d97706' },
  policy:   { fill: '#fdf2f8', stroke: '#db2777', label: '#831843', sub: '#ec4899', icon: '#db2777' },
  backend:  { fill: '#f0f9ff', stroke: '#0284c7', label: '#0c4a6e', sub: '#0ea5e9', icon: '#0284c7' },
  tool:     { fill: '#f8fafc', stroke: '#475569', label: '#1e293b', sub: '#64748b', icon: '#475569' },
};

const LAYER_STYLE_DARK = {
  client:   { fill: '#151a33', stroke: '#f87171', label: '#fecaca', sub: '#fca5a5', icon: '#f87171' },
  gateway:  { fill: '#2a0909', stroke: '#fca5a5', label: '#fee2e2', sub: '#fca5a5', icon: '#fca5a5' },
  agent:    { fill: '#0f2a20', stroke: '#34d399', label: '#d1fae5', sub: '#6ee7b7', icon: '#34d399' },
  mcp:      { fill: '#2a1f0a', stroke: '#fbbf24', label: '#fef3c7', sub: '#fcd34d', icon: '#fbbf24' },
  policy:   { fill: '#2a1220', stroke: '#f472b6', label: '#fce7f3', sub: '#f9a8d4', icon: '#f472b6' },
  backend:  { fill: '#0c1f2e', stroke: '#38bdf8', label: '#e0f2fe', sub: '#7dd3fc', icon: '#38bdf8' },
  tool:     { fill: '#1b2540', stroke: '#94a3b8', label: '#e2e8f0', sub: '#cbd5e1', icon: '#94a3b8' },
};

// Per-node icon — falls back to LAYER_ICON
const NODE_ICON = {
  frontend:          '🌐',
  bff:               '⚡',
  'langchain-agent': '🤖',
  'agent-service':   '🤖',
  'privilege-gateway':'🛡',
  'mcp-gateway':     '🔀',
  'authz-server':    '🛡️',
  'pingone-sso':     '🔑',
  'hitl-service':    '✋',
  'mcp-server':      '🏦',
  'mcp-resource-server':      '📊',
  'api-resource-server':'🌐',
};

const LAYER_ICON = {
  client: '🌐', gateway: '⚡', agent: '🤖', mcp: '🔀',
  policy: '🛡️', tool: '✋', backend: '📋',
};

// Dash pattern per source layer — makes lines visually distinct beyond color
const LAYER_DASH = {
  client:  null,          // solid
  gateway: [8, 4],        // long dash
  agent:   [4, 4],        // short dash
  mcp:     [12, 3, 3, 3], // dash-dot
  policy:  [2, 4],        // dotted
  tool:    [6, 6],        // dashed
  backend: null,          // solid
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
  { ids: ['privilege-gateway', 'mcp-gateway'],        label: 'Gateways' },
  { ids: ['authz-server', 'pingone-sso', 'hitl-service'], label: 'Auth / Policy' },
  { ids: ['mcp-server', 'mcp-resource-server', 'api-resource-server'], label: 'MCP Backends' },
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
      { from: 'frontend',        to: 'bff',             desc: 'User sends a message. Browser POSTs to BFF (/api/agent/run) and opens an SSE stream for the response.', duration: 500 },
      { from: 'bff',             to: 'langchain-agent', desc: 'BFF forwards to LangChain agent (POST :8888/run) with tool schemas, thread ID, and a callback URL for tool execution.', duration: 1500 },
      { from: 'langchain-agent', to: 'bff',             desc: 'Agent decides to call a tool. It POSTs back to BFF (/internal/agent-tool) with the tool name and arguments.', duration: 300 },
      { from: 'bff',             to: 'pingone-sso',     desc: 'BFF performs RFC 8693 token exchange with PingOne SSO — minting a delegated mcp-gateway-scoped token with act claim.', duration: 800 },
      { from: 'bff',             to: 'mcp-gateway',     desc: 'BFF calls PingOne Agent Gateway (POST JSON-RPC tools/call) with the delegated token.', duration: 1000 },
      { from: 'mcp-gateway',     to: 'authz-server',    desc: 'Gateway sends 18-parameter policy decision to PingOne Authorize (P1AZ): user, tool, scopes, amounts, act chain. Expects PERMIT / DENY / INDETERMINATE.', duration: 1200 },
      { from: 'mcp-gateway',     to: 'mcp-server',      desc: 'PERMIT received. Gateway opens a WebSocket to mcp-server and proxies the tools/call. Result travels back up the chain to the browser.', duration: 2000 },
    ],
  },
  nl: {
    label: 'NL Mode · Agent service',
    color: '#d20e0f',
    steps: [
      { from: 'frontend',      to: 'bff',          desc: 'User sends a natural-language message. Browser POSTs to BFF (/api/demo-agent/message).', duration: 400 },
      { from: 'bff',           to: 'agent-service', desc: 'BFF dispatches to agent-service (/api/agent/reason) with tool schemas only — no user tokens leave the BFF.', duration: 1000 },
      { from: 'agent-service', to: 'bff',           desc: 'Agent-service returns tool_calls from the LLM. BFF executes each tool via its own MCP pipeline and loops until it gets a final answer.', duration: 800 },
      { from: 'bff',           to: 'pingone-sso',   desc: 'BFF performs RFC 8693 token exchange with PingOne SSO to obtain a delegated mcp-scoped token.', duration: 700 },
      { from: 'bff',           to: 'mcp-gateway',   desc: 'BFF calls PingOne Agent Gateway with the delegated token.', duration: 900 },
      { from: 'mcp-gateway',   to: 'authz-server',  desc: 'PingOne Authorize evaluates the request (user identity, tool, scopes, transaction amount).', duration: 1100 },
      { from: 'mcp-gateway',   to: 'mcp-server',    desc: 'PERMIT → gateway proxies the tool call over WebSocket to the mcp-server backend.', duration: 1800 },
    ],
  },
  hitl: {
    label: 'HITL · Human approval',
    color: '#db2777',
    steps: [
      { from: 'frontend',     to: 'bff',          desc: 'High-value action triggered (e.g. large transfer). BFF initiates the MCP tool call pipeline.', duration: 500 },
      { from: 'bff',          to: 'pingone-sso',   desc: 'BFF mints a delegated token via RFC 8693 with PingOne SSO before calling the gateway.', duration: 750 },
      { from: 'bff',          to: 'mcp-gateway',   desc: 'BFF calls PingOne Agent Gateway with the delegated token and full transaction context.', duration: 1000 },
      { from: 'mcp-gateway',  to: 'authz-server',  desc: 'PingOne Authorize evaluates policy and returns INDETERMINATE — the transaction requires explicit human approval.', duration: 1300 },
      { from: 'mcp-gateway',  to: 'hitl-service',  desc: 'Gateway creates a challenge (POST /challenges) and returns JSON-RPC error -32002 to BFF with challengeId.', duration: 600 },
      { from: 'hitl-service', to: 'bff',           desc: 'User approves the challenge in the UI. HITL service notifies BFF; agent retries the tool call with _hitl_challenge_id.', duration: 3000 },
      { from: 'mcp-gateway',  to: 'mcp-server',    desc: 'P1AZ now returns PERMIT for the approved challenge. Tool executes on mcp-server and result returns to user.', duration: 2000 },
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

// Draw.io XML — drag into LucidChart's import dialog (File → Import or drag to canvas)
// Supported format: Draw.io (.xml, .drawio) per LucidChart import dialog
function buildDrawio(nodes, edges, flow) {
  const escX = str => String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
    const lbl = n.sub
      ? `${escX(n.label)}&lt;br/&gt;&lt;font style="font-size:10px;color:${s.sub}"&gt;${escX(n.sub)}&lt;/font&gt;`
      : escX(n.label);
    cells += `<mxCell id="${escX(n.id)}" value="${lbl}" `
      + `style="rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=${s.fill};strokeColor=${s.stroke};`
      + `fontColor=${s.label};fontStyle=1;fontSize=12;" vertex="1" parent="1">`
      + `<mxGeometry x="${n.x}" y="${n.y}" width="${W}" height="${H}" as="geometry"/>`
      + `</mxCell>`;
  });
  activeEdges.forEach((e, i) => {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) return;
    cells += `<mxCell id="${escX(e.id || `edge-${i}`)}" value="${escX(e.label || '')}" `
      + `style="edgeStyle=orthogonalEdgeStyle;rounded=0;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" `
      + `edge="1" source="${escX(e.from)}" target="${escX(e.to)}" parent="1">`
      + `<mxGeometry relative="1" as="geometry"/>`
      + `</mxCell>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<mxfile><diagram name="Architecture">`
    + `<mxGraphModel><root>${cells}</root></mxGraphModel>`
    + `</diagram></mxfile>`;
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

// ── React Flow editor ────────────────────────────────────────────────────────

// Card colours live in ArchitectureCanvasPage.css (.cv-card--<layer>, light + dark); edge strokes and
// arrowheads are SVG attributes React Flow draws itself, so they take the matching palette from JS.
function CanvasCard({ data }) {
  return (
    <div className={`cv-card cv-card--${data.layer}${data.dimmed ? ' cv-card--dim' : ''}`}>
      <Handle type="target" position={Position.Left} id="l" className="cv-handle" />
      <div className="cv-card__icon" aria-hidden="true">{data.icon}</div>
      <div className="cv-card__label">{data.label}</div>
      {data.sub && <div className="cv-card__sub">{data.sub}</div>}
      {data.status && <span className={`cv-card__dot cv-card__dot--${data.status}`} title={data.status} />}
      <Handle type="source" position={Position.Right} id="r" className="cv-handle" />
    </div>
  );
}

function ColumnLabel({ data }) {
  return <div className="cv-collabel">{data.label}</div>;
}

const NODE_TYPES = { card: CanvasCard, colLabel: ColumnLabel };
const DASH = (layer) => (LAYER_DASH[layer] ? LAYER_DASH[layer].join(' ') : undefined);

function CanvasEditor() {
  const { darkMode } = useThemeOptional();
  const layerStyle = darkMode ? LAYER_STYLE_DARK : LAYER_STYLE;
  const { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [pingStatus, setPingStatus] = useState({});
  // Column headers are synthesised per render (not in the node store), so where the user drops one is kept here.
  const [labelPos, setLabelPos] = useState({});
  const [pinging, setPinging] = useState(false);
  const [resultPanel, setResultPanel] = useState(null);
  const [selectedFlow, setSelectedFlow] = useState(null);

  const flow = selectedFlow ? FLOWS[selectedFlow] : null;
  const stepper = useDiagramStepper(flow ? flow.steps.length : 0);
  const step = flow ? stepper.step : -1;
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);

  const rfNodes = useMemo(() => {
    const inFlow = (id) => flow.steps.some(s => s.from === id || s.to === id);
    const cards = nodes.map(n => ({
      id: n.id,
      type: 'card',
      position: { x: n.x, y: n.y },
      deletable: false,
      data: {
        label: n.label,
        sub: n.sub,
        layer: n.layer || 'tool',
        icon: NODE_ICON[n.id] ?? LAYER_ICON[n.layer] ?? '📄',
        status: pingStatus[n.id],
        dimmed: !!flow && !inFlow(n.id),
      },
    }));
    const hot = step >= 0 ? [flow.steps[step].from, flow.steps[step].to] : [];
    const labels = COL_DEFS.map(col => ({
      id: `col-${col.label}`,
      type: 'colLabel',
      position: labelPos[`col-${col.label}`] || { x: colLabelX(col, nodeMap), y: 20 },
      data: { label: col.label.toUpperCase() },
      selectable: false,
      focusable: false,
      deletable: false,
    }));
    return [...markNodes(cards, hot), ...labels];
  }, [nodes, nodeMap, pingStatus, flow, step, labelPos]);

  const rfEdges = useMemo(() => {
    const base = edges
      .filter(e => nodeMap[e.from] && nodeMap[e.to])
      .map(e => {
        const layer = nodeMap[e.from].layer || 'tool';
        const selected = selectedEdge === e.id;
        const color = selected ? '#ef4444' : layerStyle[layer]?.stroke ?? layerStyle.tool.stroke;
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: 'r',
          targetHandle: 'l',
          selected,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth: selected ? 2.5 : 1.5,
            strokeDasharray: DASH(layer),
            opacity: flow && !selected ? 0.35 : 1,
          },
        };
      });
    if (!flow) return base;
    const overlay = flow.steps
      .filter(s => nodeMap[s.from] && nodeMap[s.to])
      .map((s, i) => ({
        id: `fs-${i}`,
        source: s.from,
        target: s.to,
        sourceHandle: 'r',
        targetHandle: 'l',
        selectable: false,
        focusable: false,
        deletable: false,
        label: String(i + 1),
        labelStyle: { fill: '#ffffff', fontWeight: 700 },
        labelBgStyle: { fill: flow.color },
        labelBgBorderRadius: 10,
        labelBgPadding: [6, 3],
        markerEnd: { type: MarkerType.ArrowClosed, color: flow.color },
        style: { stroke: flow.color, strokeWidth: 2.5 },
      }));
    return [...base, ...stepEdges(overlay, step)];
  }, [edges, nodeMap, selectedEdge, layerStyle, flow, step]);

  const reelSteps = useMemo(
    () => (flow ? flow.steps.map((s, i) => ({
      n: i + 1,
      from: s.from,
      to: s.to,
      label: '',
      title: `${nodeMap[s.from]?.label ?? s.from} → ${nodeMap[s.to]?.label ?? s.to}`,
      lines: [{ who: '', text: s.desc }],
    })) : []),
    [flow, nodeMap],
  );

  const onNodesChange = useCallback((changes) => {
    changes.forEach(c => {
      if (c.type !== 'position' || !c.position) return;
      if (c.id.startsWith('col-')) setLabelPos(p => ({ ...p, [c.id]: c.position }));
      else moveNode(c.id, c.position.x, c.position.y);
    });
  }, [moveNode]);

  const onConnect = useCallback(({ source, target }) => {
    if (source && target && source !== target) addEdge(source, target);
  }, [addEdge]);

  const onEdgesDelete = useCallback((deleted) => {
    deleted.forEach(e => removeEdge(e.id));
    setSelectedEdge(null);
  }, [removeEdge]);

  const onEdgeClick = useCallback((_e, edge) => {
    if (edge.id.startsWith('fs-')) return;
    setSelectedEdge(prev => (prev === edge.id ? null : edge.id));
  }, []);

  const onNodeDoubleClick = useCallback((_e, node) => {
    if (node.type !== 'card') return;
    setRenaming({ id: node.id, value: node.data.label });
  }, []);

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

  const handleSelectFlow = (value) => {
    stepper.stop();
    setSelectedFlow(value || null);
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
      if (!res.ok) throw new Error(`ping ${res.status}`);
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

  const hint = renaming
    ? 'Press Enter or click Save to rename'
    : selectedEdge
    ? 'Arrow selected — click Delete Edge (or press Backspace) to remove'
    : selectedFlow
    ? 'Simulate walks this flow’s arrows in order — Pause/Resume, Prev/Next and Reset appear while it runs'
    : 'Drag to reposition · Double-click to rename · Drag from a box’s right dot to another box’s left dot to connect · Click an arrow to select it · Pick a Flow above for the Simulate bar';

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
            <select
              className="flow-select"
              aria-label="Flow"
              value={selectedFlow || ''}
              onChange={e => handleSelectFlow(e.target.value)}
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
            <button className="btn-delete" disabled={!selectedEdge} onClick={handleDeleteEdge}>✕ Delete Edge</button>
            <button className={`btn-ping${pinging ? ' pinging' : ''}`} onClick={handlePingAll} disabled={pinging}>
              {pinging ? 'Pinging…' : 'Ping All'}
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
            }}>↺ Reset layout</button>
          </>
        )}
      </div>

      <div className="canvas-hint">{hint}</div>

      {/* Ping results bar */}
      {resultPanel && (
        <div className="canvas-results">
          {resultPanel.map(r => (
            <span key={r.id} className={`ping-badge ping-badge--${r.status}`}>
              <span className={`ping-dot cv-card__dot--${r.status}`} />
              {r.id}{r.ms != null ? ` ${r.ms}ms` : ''}
            </span>
          ))}
          <button className="ping-dismiss" onClick={() => setResultPanel(null)}>✕</button>
        </div>
      )}

      {flow && (
        <DiagramStepBar
          stepper={stepper}
          caption={step >= 0 ? reelSteps[step]?.title : undefined}
          testId="canvas-step-bar"
        />
      )}

      <div className="canvas-stage-wrap" data-testid="canvas-flow">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onEdgeClick={onEdgeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => setSelectedEdge(null)}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          minZoom={0.3}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <FitOnResize />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {flow && <DiagramReel steps={reelSteps} stepper={stepper} testId="canvas-reel" />}
    </div>
  );
}

export default function ArchitectureCanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasEditor />
    </ReactFlowProvider>
  );
}
