import { useState, useCallback, useRef, useEffect } from 'react';
import topologyRaw from '../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v2';

// Horizontal left-to-right flow:
// frontend → bff → agent-service → [4 agents] → [4 MCP servers] → [3 tools]
// Single-node columns (frontend, bff, agent-service) are vertically centred
// relative to the 4-row fan-out columns (y range 25–355, centre ≈ 190 → top ≈ 178)
const SEED_POSITIONS = {
  frontend:          { x: 30,   y: 178 },
  bff:               { x: 210,  y: 178 },
  'agent-service':   { x: 400,  y: 178 },
  'langchain-agent': { x: 590,  y: 25  },
  'openai-agent':    { x: 590,  y: 135 },
  'mastra-agent':    { x: 590,  y: 245 },
  'pydantic-agent':  { x: 590,  y: 355 },
  'mcp-gateway':     { x: 790,  y: 25  },
  'mcp-server':      { x: 790,  y: 135 },
  'mcp-invest':      { x: 790,  y: 245 },
  'mcp-proxy':       { x: 790,  y: 355 },
  'ping-gateway':    { x: 990,  y: 25  },
  'mortgage-service':{ x: 990,  y: 135 },
  'hitl-service':    { x: 990,  y: 245 },
};

const NODE_META = {
  frontend:          { icon: '🌐', type: 'client',       color: '#3b82f6' },
  bff:               { icon: '💬', type: 'gateway',      color: '#8b5cf6' },
  'agent-service':   { icon: '🎯', type: 'orchestrator', color: '#f59e0b' },
  'langchain-agent': { icon: '⛓',  type: 'agent',        color: '#ec4899' },
  'openai-agent':    { icon: '🤖', type: 'agent',        color: '#ec4899' },
  'mastra-agent':    { icon: '✦',  type: 'agent',        color: '#ec4899' },
  'pydantic-agent':  { icon: '🐍', type: 'agent',        color: '#ec4899' },
  'mcp-gateway':     { icon: '⚡', type: 'mcp',          color: '#10b981' },
  'mcp-server':      { icon: '⬡',  type: 'mcp',          color: '#10b981' },
  'mcp-invest':      { icon: '📊', type: 'mcp',          color: '#10b981' },
  'mcp-proxy':       { icon: '🔌', type: 'mcp',          color: '#10b981' },
  'ping-gateway':    { icon: '🔐', type: 'server',       color: '#6366f1' },
  'mortgage-service':{ icon: '🏠', type: 'tool',         color: '#334155' },
  'hitl-service':    { icon: '👤', type: 'tool',         color: '#334155' },
};

function buildSeedNodes() {
  let autoY = 460;
  return Object.entries(topologyRaw.services).map(([id, svc]) => {
    const pos = SEED_POSITIONS[id] ?? { x: 60, y: (autoY += 100) };
    const meta = NODE_META[id] ?? { icon: '●', type: 'mcp', color: '#94a3b8' };
    return {
      id,
      label: id,
      sub: `${svc.scheme}:${svc.port}`,
      x: pos.x,
      y: pos.y,
      color: meta.color,
      icon: meta.icon,
      type: meta.type,
    };
  });
}

function buildSeedEdges(nodes) {
  const pairs = [
    ['frontend',        'bff'],
    ['bff',             'agent-service'],
    ['agent-service',   'langchain-agent'],
    ['agent-service',   'openai-agent'],
    ['agent-service',   'mastra-agent'],
    ['agent-service',   'pydantic-agent'],
    ['langchain-agent', 'mcp-gateway'],
    ['openai-agent',    'mcp-server'],
    ['mastra-agent',    'mcp-invest'],
    ['pydantic-agent',  'mcp-proxy'],
    ['mcp-gateway',     'ping-gateway'],
    ['mcp-server',      'mortgage-service'],
    ['mcp-invest',      'hitl-service'],
  ];
  const nodeIds = new Set(nodes.map(n => n.id));
  return pairs
    .filter(([a, b]) => nodeIds.has(a) && nodeIds.has(b))
    .map(([from, to]) => ({ id: `e-${from}-${to}`, from, to }));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function saveToStorage(nodes, edges) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  } catch (_) {}
}

export default function useCanvasLayout() {
  const seed = buildSeedNodes();
  const seedEdges = buildSeedEdges(seed);

  const [nodes, setNodes] = useState(() => {
    const persisted = loadFromStorage();
    return persisted ? persisted.nodes : seed;
  });

  const [edges, setEdges] = useState(() => {
    const persisted = loadFromStorage();
    return persisted ? persisted.edges : seedEdges;
  });

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const persist = useCallback((nextNodes, nextEdges) => {
    saveToStorage(nextNodes, nextEdges);
  }, []);

  const moveNode = useCallback((id, x, y) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, x, y } : n);
      persist(next, edgesRef.current);
      return next;
    });
  }, [persist]);

  const addNode = useCallback((label) => {
    const id = `custom-${Date.now()}`;
    const newNode = { id, label, sub: '', x: 300, y: 300, color: '#94a3b8', icon: '●', type: 'mcp' };
    setNodes(prev => {
      const next = [...prev, newNode];
      persist(next, edgesRef.current);
      return next;
    });
  }, [persist]);

  const removeEdge = useCallback((id) => {
    setEdges(prev => {
      const next = prev.filter(e => e.id !== id);
      persist(nodesRef.current, next);
      return next;
    });
  }, [persist]);

  const addEdge = useCallback((fromId, toId) => {
    const newEdge = { id: `e-${fromId}-${toId}-${Date.now()}`, from: fromId, to: toId };
    setEdges(prev => {
      const next = [...prev, newEdge];
      persist(nodesRef.current, next);
      return next;
    });
  }, [persist]);

  const resetLayout = useCallback(() => {
    const freshNodes = buildSeedNodes();
    const freshEdges = buildSeedEdges(freshNodes);
    setNodes(freshNodes);
    setEdges(freshEdges);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }, []);

  return { nodes, edges, moveNode, addNode, removeEdge, addEdge, resetLayout };
}
