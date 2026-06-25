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

// ── Node colours per pipeline stage ────────────────────────────────────────
const STAGE_COLORS = {
  vertical: '#1a5276',
  chip:     '#117a65',
  tool:     '#784212',
  scope:    '#4a235a',
  authz:    '#922b21',
};

// ── Custom node: Vertical header ───────────────────────────────────────────
function VerticalNode({ data }) {
  return (
    <div style={{
      background: data.color || STAGE_COLORS.vertical,
      color: '#fff',
      padding: '8px 14px',
      borderRadius: 8,
      minWidth: 130,
      fontWeight: 600,
      fontSize: 13,
      textAlign: 'center',
      boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Vertical</div>
      {data.label}
      {data.tagline && <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{data.tagline}</div>}
    </div>
  );
}

// ── Custom node: Chip ───────────────────────────────────────────────────────
function ChipNode({ data }) {
  const badge = data.decision === 'PERMIT'
    ? { text: '✅ PERMIT', bg: '#145a32' }
    : data.decision === 'DENY'
      ? { text: '❌ DENY', bg: '#7b241c' }
      : { text: '…', bg: '#555' };

  return (
    <div style={{
      background: data.isWrite ? '#6e2f0a' : STAGE_COLORS.chip,
      color: '#fff',
      padding: '6px 12px',
      borderRadius: 20,
      minWidth: 110,
      fontSize: 12,
      textAlign: 'center',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.15)',
    }}>
      <div style={{ fontSize: 10, opacity: 0.75, marginBottom: 1 }}>Chip</div>
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      <div style={{
        marginTop: 4,
        background: badge.bg,
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 10,
        display: 'inline-block',
      }}>{badge.text}</div>
    </div>
  );
}

// ── Custom node: Tool ──────────────────────────────────────────────────────
function ToolNode({ data }) {
  return (
    <div style={{
      background: STAGE_COLORS.tool,
      color: '#fff',
      padding: '6px 12px',
      borderRadius: 6,
      minWidth: 120,
      fontSize: 11,
      textAlign: 'center',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    }}>
      <div style={{ fontSize: 10, opacity: 0.75, marginBottom: 1 }}>MCP Tool</div>
      <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{data.label}</div>
    </div>
  );
}

// ── Custom node: Scope badge ───────────────────────────────────────────────
function ScopeNode({ data }) {
  const color = data.label === 'write' ? '#6c1f1f' : '#1a3a5c';
  return (
    <div style={{
      background: color,
      color: '#fff',
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    }}>
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

  if (loading) return <div style={{ padding: 24, color: '#888' }}>Loading pipeline map…</div>;
  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>Error: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Vertical Pipeline Map</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            Vertical → Chip → MCP Tool → Required Scopes — with live PingOne Authorize decisions
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#aaa' }}>
            <span style={{ color: '#117a65' }}>● Read chip</span>
            <span style={{ color: '#6e2f0a' }}>● Write chip</span>
            <span style={{ color: '#145a32' }}>✅ PERMIT</span>
            <span style={{ color: '#7b241c' }}>❌ DENY</span>
          </div>
          <button
            onClick={() => checkAllChips(pipeline)}
            disabled={checking}
            style={{
              background: checking ? '#333' : '#1a5276',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: checking ? 'not-allowed' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : 'Re-check Authorization'}
          </button>
        </div>
      </div>

      {/* Stage labels */}
      <div style={{ display: 'flex', padding: '6px 16px', gap: 0, background: '#111', borderBottom: '1px solid #222' }}>
        {[['Vertical', X_VERTICAL + 16], ['Chip / Action', X_CHIP + 16], ['MCP Tool', X_TOOL + 16], ['Required Scopes', X_SCOPE + 16]].map(([label, x]) => (
          <div key={label} style={{ position: 'absolute', left: x + 16, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label}
          </div>
        ))}
      </div>

      {/* React Flow canvas */}
      <div style={{ flex: 1, minHeight: 400 }}>
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
          <Background color="#2a2a2a" gap={20} />
          <Controls style={{ background: '#1a1a1a', border: '1px solid #333' }} />
          <MiniMap
            nodeColor={n => {
              if (n.type === 'vertical') return '#1a5276';
              if (n.type === 'chip') return n.data?.isWrite ? '#6e2f0a' : '#117a65';
              if (n.type === 'tool') return '#784212';
              return '#4a235a';
            }}
            style={{ background: '#111', border: '1px solid #333' }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
