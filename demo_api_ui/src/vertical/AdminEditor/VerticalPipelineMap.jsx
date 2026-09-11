import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import bffAxios from '../../services/bffAxios';
import './VerticalPipelineMap.css';

// ── Node colours per pipeline stage — literal, not --th-*, see .css header ──
const STAGE_COLORS = {
  vertical: '#1a5276',
  chip:     '#117a65',
  tool:     '#784212',
  scope:    '#4a235a',
};

// ── Custom node: Vertical header ───────────────────────────────────────────
function VerticalNode({ data }) {
  return (
    <div
      className="vpm-node vpm-node--vertical"
      style={data.color ? { '--vpm-vertical-color': data.color } : undefined}
    >
      <div className="vpm-node-kind">Vertical</div>
      {data.label}
      {data.tagline && <div className="vpm-node--vertical-tagline">{data.tagline}</div>}
    </div>
  );
}

// ── Custom node: Chip ───────────────────────────────────────────────────────
function ChipNode({ data }) {
  const badge = data.decision === 'PERMIT'
    ? { text: '✅ PERMIT', kind: 'permit' }
    : data.decision === 'DENY'
      ? { text: '❌ DENY', kind: 'deny' }
      : { text: '…', kind: 'pending' };

  return (
    <div className={`vpm-node vpm-node--chip${data.isWrite ? ' vpm-node--write' : ''}`}>
      <div className="vpm-node-kind">Chip</div>
      <div className="vpm-node-chip-label">{data.label}</div>
      <div className={`vpm-node-badge vpm-node-badge--${badge.kind}`}>{badge.text}</div>
    </div>
  );
}

// ── Custom node: Tool ──────────────────────────────────────────────────────
function ToolNode({ data }) {
  return (
    <div className="vpm-node vpm-node--tool">
      <div className="vpm-node-kind">MCP Tool</div>
      <div className="vpm-node-tool-label">{data.label}</div>
    </div>
  );
}

// ── Custom node: Scope badge ───────────────────────────────────────────────
function ScopeNode({ data }) {
  return (
    <div className={`vpm-node vpm-node--scope${data.label === 'write' ? ' vpm-node--write' : ''}`}>
      {data.label}
    </div>
  );
}

const nodeTypes = {
  vertical: VerticalNode,
  chip: ChipNode,
  tool: ToolNode,
  scope: ScopeNode,
};

// ── Layout constants ───────────────────────────────────────────────────────
const X_VERTICAL = 0;
const X_CHIP     = 200;
const X_TOOL     = 420;
const X_SCOPE    = 620;
const Y_START    = 40;
const Y_GAP_VERT = 40;    // gap between verticals
const Y_GAP_CHIP = 70;    // gap between chips within a vertical
const SCOPE_H    = 36;

const STAGE_LABELS = ['Vertical', 'Chip / Action', 'MCP Tool', 'Required Scopes'];

// ── Build nodes + edges from pipeline data ─────────────────────────────────
function buildGraph(pipeline, decisions) {
  const nodes = [];
  const edges = [];
  let y = Y_START;

  for (const vert of pipeline) {
    const chips = vert.chips || [];
    const vertHeight = Math.max(chips.length * Y_GAP_CHIP, 60);
    const vertY = y + vertHeight / 2 - 20;
    const baseY = y; // capture loop var for closures

    // Vertical node
    const vertId = `v-${vert.id}`;
    nodes.push({
      id: vertId,
      type: 'vertical',
      position: { x: X_VERTICAL, y: vertY },
      data: {
        label: vert.displayName || vert.id,
        tagline: vert.tagline,
        color: vert.theme?.cssVars?.['--accent'] || STAGE_COLORS.vertical,
      },
    });

    // Chip + tool + scope nodes
    chips.forEach((chip, ci) => {
      const chipY = baseY + ci * Y_GAP_CHIP;
      const chipId = `chip-${vert.id}-${chip.action}`;
      const decision = decisions[`${vert.id}::${chip.action}`];

      nodes.push({
        id: chipId,
        type: 'chip',
        position: { x: X_CHIP, y: chipY },
        data: {
          label: chip.label,
          isWrite: chip.isWrite,
          decision,
        },
      });

      edges.push({
        id: `e-${vertId}-${chipId}`,
        source: vertId,
        target: chipId,
        animated: false,
        style: { stroke: '#555', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#555' },
      });

      // Tool node (same name as chip action = MCP tool)
      const toolId = `tool-${vert.id}-${chip.action}`;
      nodes.push({
        id: toolId,
        type: 'tool',
        position: { x: X_TOOL, y: chipY },
        data: { label: chip.action },
      });
      edges.push({
        id: `e-${chipId}-${toolId}`,
        source: chipId,
        target: toolId,
        animated: decision === 'PERMIT',
        style: { stroke: decision === 'DENY' ? '#922b21' : '#117a65', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: decision === 'DENY' ? '#922b21' : '#117a65' },
      });

      // Scope nodes
      const scopes = chip.scopes || ['read'];
      scopes.forEach((scope, si) => {
        const scopeId = `scope-${vert.id}-${chip.action}-${scope}`;
        const scopeY = chipY + si * SCOPE_H - (scopes.length - 1) * SCOPE_H / 2;
        nodes.push({
          id: scopeId,
          type: 'scope',
          position: { x: X_SCOPE, y: scopeY },
          data: { label: scope },
        });
        edges.push({
          id: `e-${toolId}-${scopeId}`,
          source: toolId,
          target: scopeId,
          style: { stroke: '#777', strokeWidth: 1, strokeDasharray: '4 3' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#777' },
        });
      });
    });

    y += vertHeight + Y_GAP_VERT;
  }

  return { nodes, edges };
}

// ── Main component ─────────────────────────────────────────────────────────
export function VerticalPipelineMap() {
  const [pipeline, setPipeline] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Fetch pipeline mapping
  useEffect(() => {
    setLoading(true);
    bffAxios.get('/api/vertical/pipeline')
      .then(r => { setPipeline(r.data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Check authorization for all chips
  const checkAllChips = useCallback(async (pipelineData) => {
    setChecking(true);
    const results = {};
    const calls = [];
    for (const vert of pipelineData) {
      for (const chip of (vert.chips || [])) {
        calls.push(
          bffAxios.post('/api/vertical/check-chip', { vertical: vert.id, toolName: chip.action })
            .then(r => { results[`${vert.id}::${chip.action}`] = r.data.decision; })
            .catch(() => { results[`${vert.id}::${chip.action}`] = 'DENY'; })
        );
      }
    }
    await Promise.all(calls);
    setDecisions(results);
    setChecking(false);
  }, []);

  // Build graph whenever pipeline or decisions change
  useEffect(() => {
    if (!pipeline.length) return;
    const { nodes: n, edges: e } = buildGraph(pipeline, decisions);
    setNodes(n);
    setEdges(e);
  }, [pipeline, decisions, setNodes, setEdges]);

  // Auto-check on load
  useEffect(() => {
    if (pipeline.length > 0) checkAllChips(pipeline);
  }, [pipeline, checkAllChips]);

  if (loading) return <div className="vpm-loading">Loading pipeline map…</div>;
  if (error) return <div className="vpm-error">Error: {error}</div>;

  return (
    <div className="vpm-root">
      {/* Header */}
      <div className="vpm-header">
        <div>
          <div className="vpm-header-title">Vertical Pipeline Map</div>
          <div className="vpm-header-sub">
            Vertical → Chip → MCP Tool → Required Scopes — with live PingOne Authorize decisions
          </div>
        </div>
        <div className="vpm-header-actions">
          {/* Legend */}
          <div className="vpm-legend">
            <span className="vpm-legend-swatch--read">● Read chip</span>
            <span className="vpm-legend-swatch--write">● Write chip</span>
            <span>✅ PERMIT</span>
            <span>❌ DENY</span>
          </div>
          <button
            type="button"
            className="vpm-recheck-btn"
            onClick={() => checkAllChips(pipeline)}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Re-check Authorization'}
          </button>
        </div>
      </div>

      {/* Stage labels */}
      <div className="vpm-stage-labels">
        {STAGE_LABELS.map((label) => (
          <div key={label} className="vpm-stage-label">{label}</div>
        ))}
      </div>

      {/* React Flow canvas */}
      <div className="vpm-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background gap={20} />
          <Controls />
          <MiniMap
            nodeColor={n => {
              if (n.type === 'vertical') return '#1a5276';
              if (n.type === 'chip') return n.data?.isWrite ? '#6e2f0a' : '#117a65';
              if (n.type === 'tool') return '#784212';
              return '#4a235a';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
