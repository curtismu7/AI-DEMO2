import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const W = 150;   // box width
const H = 58;    // box height
const R = 6;     // corner radius

// Layer → colour scheme: fill, stroke, label
const LAYER_STYLE = {
  client:       { fill: '#e0e7ff', stroke: '#4f46e5', label: '#1e1b4b', sub: '#6366f1' },
  gateway:      { fill: '#ede9fe', stroke: '#7c3aed', label: '#2e1065', sub: '#8b5cf6' },
  orchestrator: { fill: '#fef3c7', stroke: '#d97706', label: '#78350f', sub: '#b45309' },
  agent:        { fill: '#d1fae5', stroke: '#059669', label: '#064e3b', sub: '#10b981' },
  mcp:          { fill: '#e0f2fe', stroke: '#0284c7', label: '#0c4a6e', sub: '#0ea5e9' },
  tool:         { fill: '#f1f5f9', stroke: '#64748b', label: '#1e293b', sub: '#94a3b8' },
};

function portCentre(node) {
  return { x: node.x + W / 2, y: node.y + H / 2 };
}

function arrowPoints(src, tgt) {
  const s = portCentre(src);
  const t = portCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

// Column header labels rendered as plain text above each column group
const COL_LABELS = [
  { x: 30,   label: 'Browser Client' },
  { x: 210,  label: 'BFF / API' },
  { x: 400,  label: 'Orchestration' },
  { x: 590,  label: 'AI Agent' },
  { x: 800,  label: 'MCP Servers' },
  { x: 1010, label: 'Backend Tools' },
];

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [renaming, setRenaming] = useState(null);     // { id, value }
  const [stageSize, setStageSize] = useState({ width: 900, height: 600 });
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setStageSize({ width, height });
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

  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  const hint = renaming
    ? 'Press Enter or click Save to rename'
    : connectMode
    ? (connectFrom ? `Now click the target node to connect from "${connectFrom}"` : 'Click the source node')
    : selectedEdge
    ? 'Arrow selected — click Delete Edge to remove'
    : 'Drag to reposition · Double-click a box to rename · Click arrow to select';

  return (
    <div className="canvas-page">
      <div className="canvas-toolbar">
        <h2>Architecture Canvas</h2>
        {renaming ? (
          <>
            <input
              type="text"
              className="rename-input"
              value={renaming.value}
              autoFocus
              onChange={e => setRenaming(r => ({ ...r, value: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null); }}
            />
            <button className="btn-add" onClick={handleRenameSubmit}>Save</button>
            <button className="btn-reset" onClick={() => setRenaming(null)}>Cancel</button>
          </>
        ) : (
          <>
            <input
              type="text"
              placeholder="New box name…"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNode()}
            />
            <button className="btn-add" onClick={handleAddNode}>+ Add</button>
            <button
              className={`btn-connect${connectMode ? ' active' : ''}`}
              onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}
            >
              {connectMode ? '⬡ Connecting…' : '⬡ Connect'}
            </button>
            <button className="btn-delete" disabled={!selectedEdge} onClick={handleDeleteEdge}>
              ✕ Delete Edge
            </button>
            <button className="btn-reset" onClick={() => { if (window.confirm('Reset canvas to default layout?')) resetLayout(); }}>
              ↺ Reset
            </button>
          </>
        )}
      </div>
      <div className="canvas-hint">{hint}</div>
      <div className="canvas-stage-wrap" ref={wrapRef}>
        <Stage width={stageSize.width} height={stageSize.height}>
          {/* Background */}
          <Layer>
            <Rect x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#f8fafc" />
          </Layer>

          {/* Column header labels */}
          <Layer>
            {COL_LABELS.map(col => (
              <Text
                key={col.label}
                x={col.x} y={10}
                width={W}
                text={col.label}
                fontSize={10}
                fontStyle="600"
                fontFamily="system-ui, sans-serif"
                fill="#94a3b8"
                align="center"
                listening={false}
              />
            ))}
          </Layer>

          {/* Edges */}
          <Layer>
            {edges.map(edge => {
              const src = nodeMap[edge.from];
              const tgt = nodeMap[edge.to];
              if (!src || !tgt) return null;
              const pts = arrowPoints(src, tgt);
              const isSelected = selectedEdge === edge.id;
              return (
                <Arrow
                  key={edge.id}
                  points={pts}
                  stroke={isSelected ? '#ef4444' : '#94a3b8'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  fill={isSelected ? '#ef4444' : '#94a3b8'}
                  pointerLength={8}
                  pointerWidth={7}
                  hitStrokeWidth={16}
                  onClick={() => setSelectedEdge(edge.id === selectedEdge ? null : edge.id)}
                />
              );
            })}
          </Layer>

          {/* Nodes */}
          <Layer>
            {nodes.map(node => {
              const style = LAYER_STYLE[node.layer] ?? LAYER_STYLE.tool;
              const isConnectSrc = connectFrom === node.id;
              const strokeColor = isConnectSrc ? '#f59e0b' : (connectMode ? '#3b82f6' : style.stroke);
              const strokeWidth = (isConnectSrc || connectMode) ? 2.5 : 1.5;

              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable={!connectMode}
                  onDragEnd={e => handleDragEnd(node.id, e)}
                  onClick={() => handleNodeClick(node.id)}
                  onDblClick={() => handleNodeDblClick(node)}
                >
                  {/* Shadow */}
                  <Rect
                    x={2} y={3}
                    width={W} height={H}
                    cornerRadius={R}
                    fill="rgba(0,0,0,0.07)"
                  />
                  {/* Box */}
                  <Rect
                    width={W} height={H}
                    cornerRadius={R}
                    fill={style.fill}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  {/* Left accent bar */}
                  <Rect
                    width={5} height={H}
                    cornerRadius={[R, 0, 0, R]}
                    fill={style.stroke}
                  />
                  {/* Label */}
                  <Text
                    x={12} y={node.sub ? 10 : 19}
                    width={W - 16}
                    text={node.label}
                    fontSize={12}
                    fontStyle="bold"
                    fontFamily="system-ui, sans-serif"
                    fill={style.label}
                    ellipsis
                    listening={false}
                  />
                  {/* Sub-label */}
                  {node.sub ? (
                    <Text
                      x={12} y={30}
                      width={W - 16}
                      text={node.sub}
                      fontSize={10}
                      fontFamily="system-ui, sans-serif"
                      fill={style.sub}
                      ellipsis
                      listening={false}
                    />
                  ) : null}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
