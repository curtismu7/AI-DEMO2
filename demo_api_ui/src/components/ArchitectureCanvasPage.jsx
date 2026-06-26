import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle, Line } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

// Node dimensions — icon circle above, label below (like Okta diagram)
const ICON_R = 30;       // circle radius
const NODE_W = 100;      // total clickable/drag width
const NODE_H = 90;       // total height (circle + label area)
const ICON_CX = NODE_W / 2;
const ICON_CY = ICON_R + 4;

function nodePortCentre(node) {
  return { x: node.x + ICON_CX, y: node.y + ICON_CY };
}

function edgePoints(src, tgt) {
  const s = nodePortCentre(src);
  const t = nodePortCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

// TYPE_COLORS maps node.type → circle fill (matches Okta card palette)
const TYPE_FILL = {
  client:       '#1e1e2e',
  gateway:      '#1e1e2e',
  orchestrator: '#1e1e2e',
  agent:        '#7c3aed',
  mcp:          '#0d9488',
  server:       '#0d9488',
  tool:         '#1e293b',
};

const TYPE_LABEL_COLOR = {
  client:       '#6366f1',
  gateway:      '#8b5cf6',
  orchestrator: '#f59e0b',
  agent:        '#a78bfa',
  mcp:          '#2dd4bf',
  server:       '#818cf8',
  tool:         '#94a3b8',
};

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
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

  const hint = connectMode
    ? (connectFrom ? `Click a second node to connect from "${connectFrom}"` : 'Click the first node')
    : selectedEdge
    ? 'Arrow selected — click Delete Edge to remove'
    : 'Drag nodes · Click an arrow to select · Use toolbar to add or connect';

  return (
    <div className="canvas-page">
      <div className="canvas-toolbar">
        <h2>Architecture Canvas</h2>
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
      </div>
      <div className="canvas-hint">{hint}</div>
      <div className="canvas-stage-wrap" ref={wrapRef}>
        <Stage width={stageSize.width} height={stageSize.height}>
          {/* Cream background */}
          <Layer>
            <Rect x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#f5f0eb" />
          </Layer>

          {/* Edge layer */}
          <Layer>
            {edges.map(edge => {
              const src = nodeMap[edge.from];
              const tgt = nodeMap[edge.to];
              if (!src || !tgt) return null;
              const pts = edgePoints(src, tgt);
              const isSelected = selectedEdge === edge.id;
              return (
                <Arrow
                  key={edge.id}
                  points={pts}
                  stroke={isSelected ? '#ef4444' : '#94a3b8'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  fill={isSelected ? '#ef4444' : '#94a3b8'}
                  pointerLength={9}
                  pointerWidth={7}
                  hitStrokeWidth={16}
                  tension={0}
                  onClick={() => setSelectedEdge(edge.id === selectedEdge ? null : edge.id)}
                />
              );
            })}
          </Layer>

          {/* Node layer */}
          <Layer>
            {nodes.map(node => {
              const isConnectSource = connectFrom === node.id;
              const circleFill = TYPE_FILL[node.type] ?? '#1e293b';
              const ringColor = isConnectSource ? '#f59e0b'
                : connectMode ? '#3b82f6'
                : (TYPE_LABEL_COLOR[node.type] ?? node.color);
              const ringWidth = (isConnectSource || connectMode) ? 3 : 2;

              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable={!connectMode}
                  onDragEnd={e => handleDragEnd(node.id, e)}
                  onClick={() => handleNodeClick(node.id)}
                >
                  {/* Drop shadow */}
                  <Circle
                    x={ICON_CX + 2} y={ICON_CY + 3}
                    radius={ICON_R}
                    fill="rgba(0,0,0,0.18)"
                  />
                  {/* Icon circle */}
                  <Circle
                    x={ICON_CX} y={ICON_CY}
                    radius={ICON_R}
                    fill={circleFill}
                    stroke={ringColor}
                    strokeWidth={ringWidth}
                  />
                  {/* Emoji icon */}
                  <Text
                    x={ICON_CX - 14} y={ICON_CY - 12}
                    width={28}
                    text={node.icon ?? '●'}
                    fontSize={18}
                    align="center"
                    listening={false}
                  />
                  {/* Label below circle */}
                  <Text
                    x={0} y={ICON_CY + ICON_R + 8}
                    width={NODE_W}
                    text={node.label}
                    fontSize={10}
                    fontStyle="600"
                    fontFamily="system-ui, sans-serif"
                    fill="#1e293b"
                    align="center"
                    wrap="word"
                    listening={false}
                  />
                  {/* Sub-label (port) */}
                  <Text
                    x={0} y={ICON_CY + ICON_R + 22}
                    width={NODE_W}
                    text={node.sub}
                    fontSize={9}
                    fontFamily="system-ui, sans-serif"
                    fill="#94a3b8"
                    align="center"
                    listening={false}
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
