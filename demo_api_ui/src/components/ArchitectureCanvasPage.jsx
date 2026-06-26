import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const NODE_W = 140;
const NODE_H = 54;
const NODE_R = 8;

function nodeCentre(node) {
  return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
}

function edgePoints(src, tgt) {
  const s = nodeCentre(src);
  const t = nodeCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

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
    if (!connectFrom) {
      setConnectFrom(id);
      return;
    }
    if (connectFrom === id) {
      setConnectFrom(null);
      return;
    }
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
    ? connectFrom
      ? `Click a second node to connect from "${connectFrom}"`
      : 'Click the first node to start a connection'
    : selectedEdge
    ? `Edge "${selectedEdge}" selected — click Delete Edge to remove`
    : 'Drag nodes to reposition · Click an arrow to select it';

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
        <button className="btn-add" onClick={handleAddNode}>+ Add Box</button>

        <button
          className={`btn-connect${connectMode ? ' active' : ''}`}
          onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}
        >
          {connectMode ? '⬡ Connecting…' : '⬡ Connect Nodes'}
        </button>

        <button
          className="btn-delete"
          disabled={!selectedEdge}
          onClick={handleDeleteEdge}
        >
          ✕ Delete Edge
        </button>

        <button
          className="btn-reset"
          onClick={() => { if (window.confirm('Reset canvas to default layout?')) resetLayout(); }}
        >
          ↺ Reset
        </button>
      </div>

      <div className="canvas-hint">{hint}</div>

      <div className="canvas-stage-wrap" ref={wrapRef}>
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          style={{ background: '#f8fafc' }}
        >
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
                  strokeWidth={isSelected ? 3 : 1.5}
                  fill={isSelected ? '#ef4444' : '#94a3b8'}
                  pointerLength={10}
                  pointerWidth={8}
                  hitStrokeWidth={14}
                  onClick={() => setSelectedEdge(edge.id === selectedEdge ? null : edge.id)}
                />
              );
            })}
          </Layer>

          <Layer>
            {nodes.map(node => {
              const isConnectSource = connectFrom === node.id;
              const strokeColor = isConnectSource ? '#f59e0b' : (connectMode ? '#3b82f6' : node.color);
              const strokeWidth = isConnectSource || connectMode ? 2.5 : 1.5;
              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable={!connectMode}
                  onDragEnd={e => handleDragEnd(node.id, e)}
                  onClick={() => handleNodeClick(node.id)}
                >
                  <Rect
                    x={2} y={3}
                    width={NODE_W} height={NODE_H}
                    cornerRadius={NODE_R}
                    fill="rgba(0,0,0,0.08)"
                  />
                  <Rect
                    width={NODE_W} height={NODE_H}
                    cornerRadius={NODE_R}
                    fill="#fff"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  <Rect
                    width={6} height={NODE_H}
                    cornerRadius={[NODE_R, 0, 0, NODE_R]}
                    fill={node.color}
                  />
                  <Text
                    x={12} y={node.sub ? 10 : 18}
                    width={NODE_W - 14}
                    text={node.label}
                    fontSize={12}
                    fontStyle="bold"
                    fontFamily="system-ui, sans-serif"
                    fill="#1e293b"
                    ellipsis
                  />
                  {node.sub && (
                    <Text
                      x={12} y={30}
                      width={NODE_W - 14}
                      text={node.sub}
                      fontSize={10}
                      fontFamily="system-ui, sans-serif"
                      fill="#94a3b8"
                      ellipsis
                    />
                  )}
                  {connectMode && (
                    <Circle
                      x={NODE_W - 10} y={10}
                      radius={5}
                      fill={isConnectSource ? '#f59e0b' : '#3b82f6'}
                      opacity={0.85}
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
