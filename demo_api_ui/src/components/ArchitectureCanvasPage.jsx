import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const W = 150;
const H = 58;
const R = 6;

const LAYER_STYLE = {
  client:   { fill: '#e0e7ff', stroke: '#4f46e5', label: '#1e1b4b', sub: '#6366f1' },
  gateway:  { fill: '#ede9fe', stroke: '#7c3aed', label: '#2e1065', sub: '#8b5cf6' },
  agent:    { fill: '#d1fae5', stroke: '#059669', label: '#064e3b', sub: '#10b981' },
  mcp:      { fill: '#fef3c7', stroke: '#d97706', label: '#78350f', sub: '#b45309' },
  policy:   { fill: '#fce7f3', stroke: '#db2777', label: '#831843', sub: '#ec4899' },
  backend:  { fill: '#e0f2fe', stroke: '#0284c7', label: '#0c4a6e', sub: '#0ea5e9' },
  tool:     { fill: '#f1f5f9', stroke: '#64748b', label: '#1e293b', sub: '#94a3b8' },
};

// Status dot colour
const STATUS_COLOR = {
  up:      '#22c55e',
  down:    '#ef4444',
  timeout: '#f59e0b',
  error:   '#f97316',
  unknown: '#94a3b8',
  pinging: '#3b82f6',
};

function portCentre(node) {
  return { x: node.x + W / 2, y: node.y + H / 2 };
}

function arrowPoints(src, tgt) {
  const s = portCentre(src);
  const t = portCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

const COL_LABELS = [
  { x: 30,   label: 'Browser' },
  { x: 220,  label: 'BFF' },
  { x: 430,  label: 'Agent Layer' },
  { x: 640,  label: 'Gateway' },
  { x: 850,  label: 'Policy / HITL' },
  { x: 1060, label: 'MCP Backends' },
];

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 900, height: 600 });
  const [pingStatus, setPingStatus] = useState({});   // { [nodeId]: 'up'|'down'|'timeout'|'pinging' }
  const [pinging, setPinging] = useState(false);
  const [resultPanel, setResultPanel] = useState(null); // { id, status, ms, statusCode }
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

  const handlePingAll = async () => {
    setPinging(true);
    setResultPanel(null);
    // Mark all as pinging
    const pingingMap = {};
    nodes.forEach(n => { pingingMap[n.id] = 'pinging'; });
    setPingStatus(pingingMap);

    try {
      const res = await fetch('/api/canvas/ping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: nodes.map(n => n.id) }),
      });
      const data = await res.json();
      const statusMap = {};
      (data.results || []).forEach(r => { statusMap[r.id] = r; });
      // Build display map
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

  const hint = renaming
    ? 'Press Enter or click Save to rename'
    : connectMode
    ? (connectFrom ? `Now click the target node` : 'Click the source node')
    : selectedEdge
    ? 'Arrow selected — click Delete Edge to remove'
    : 'Drag to reposition · Double-click to rename · Click arrow to select';

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
            <button
              className={`btn-ping${pinging ? ' pinging' : ''}`}
              onClick={handlePingAll}
              disabled={pinging}
            >
              {pinging ? '⏳ Pinging…' : '⚡ Ping All'}
            </button>
            <button className="btn-reset" onClick={() => { if (window.confirm('Reset canvas to default layout?')) { resetLayout(); setPingStatus({}); setResultPanel(null); } }}>
              ↺ Reset
            </button>
          </>
        )}
      </div>
      <div className="canvas-hint">{hint}</div>

      {/* Results panel */}
      {resultPanel && (
        <div className="canvas-results">
          {resultPanel.map(r => (
            <span key={r.id} className={`ping-badge ping-badge--${r.status}`}>
              <span className="ping-dot" style={{ background: STATUS_COLOR[r.status] ?? '#94a3b8' }} />
              {r.id}
              {r.ms != null ? ` ${r.ms}ms` : ''}
            </span>
          ))}
          <button className="ping-dismiss" onClick={() => setResultPanel(null)}>✕</button>
        </div>
      )}

      <div className="canvas-stage-wrap" ref={wrapRef}>
        <Stage width={stageSize.width} height={stageSize.height}>
          <Layer>
            <Rect x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#f8fafc" />
          </Layer>

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

          <Layer>
            {nodes.map(node => {
              const style = LAYER_STYLE[node.layer] ?? LAYER_STYLE.tool;
              const isConnectSrc = connectFrom === node.id;
              const strokeColor = isConnectSrc ? '#f59e0b' : connectMode ? '#3b82f6' : style.stroke;
              const strokeWidth = (isConnectSrc || connectMode) ? 2.5 : 1.5;
              const status = pingStatus[node.id];
              const dotColor = STATUS_COLOR[status];

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
                  <Rect x={2} y={3} width={W} height={H} cornerRadius={R} fill="rgba(0,0,0,0.07)" />
                  <Rect
                    width={W} height={H}
                    cornerRadius={R}
                    fill={style.fill}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  <Rect width={5} height={H} cornerRadius={[R, 0, 0, R]} fill={style.stroke} />
                  <Text
                    x={12} y={node.sub ? 10 : 19}
                    width={W - 20}
                    text={node.label}
                    fontSize={12}
                    fontStyle="bold"
                    fontFamily="system-ui, sans-serif"
                    fill={style.label}
                    ellipsis
                    listening={false}
                  />
                  {node.sub ? (
                    <Text
                      x={12} y={30}
                      width={W - 20}
                      text={node.sub}
                      fontSize={10}
                      fontFamily="system-ui, sans-serif"
                      fill={style.sub}
                      ellipsis
                      listening={false}
                    />
                  ) : null}
                  {/* Status dot — top-right corner */}
                  {dotColor && (
                    <Circle
                      x={W - 8} y={8}
                      radius={5}
                      fill={dotColor}
                      stroke="#fff"
                      strokeWidth={1.5}
                      listening={false}
                    />
                  )}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
