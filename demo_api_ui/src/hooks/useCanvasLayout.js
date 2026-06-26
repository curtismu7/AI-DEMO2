import { useState, useCallback, useRef, useEffect } from 'react';
import topologyRaw from '../../../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v1';

// ── Seed layout from service-topology.json ───────────────────────────────────
// Arrange services in 3 columns based on role:
//   col 0 (x=60):  frontend, bff, ping-gateway
//   col 1 (x=280): mcp-gateway, mcp-server, mcp-invest, mcp-proxy, agent-service
//   col 2 (x=500): langchain-agent, openai-agent, mastra-agent, pydantic-agent,
//                  mortgage-service, hitl-service
const COL_X = [60, 280, 500];
const ROW_H = 90;
const NODE_COLORS = {
  frontend:         '#3b82f6',
  bff:              '#8b5cf6',
  'ping-gateway':   '#6366f1',
  'mcp-gateway':    '#f59e0b',
  'mcp-server':     '#10b981',
  'mcp-invest':     '#06b6d4',
  'mcp-proxy':      '#84cc16',
  'agent-service':  '#f97316',
  'langchain-agent':'#ec4899',
  'openai-agent':   '#14b8a6',
  'mastra-agent':   '#a855f7',
  'pydantic-agent': '#64748b',
  'mortgage-service':'#78716c',
  'hitl-service':   '#ef4444',
};

const COL_ASSIGN = {
  frontend:          0,
  bff:               0,
  'ping-gateway':    0,
  'mcp-gateway':     1,
  'mcp-server':      1,
  'mcp-invest':      1,
  'mcp-proxy':       1,
  'agent-service':   1,
  'langchain-agent': 2,
  'openai-agent':    2,
  'mastra-agent':    2,
  'pydantic-agent':  2,
  'mortgage-service':2,
  'hitl-service':    2,
};

function buildSeedNodes() {
  const colCounts = [0, 0, 0];
  return Object.entries(topologyRaw.services).map(([id, svc]) => {
    const col = COL_ASSIGN[id] ?? 1;
    const row = colCounts[col]++;
    return {
      id,
      label: id,
      sub: `${svc.scheme}:${svc.port}`,
      x: COL_X[col],
      y: 40 + row * ROW_H,
      color: NODE_COLORS[id] ?? '#94a3b8',
    };
  });
}

function buildSeedEdges(nodes) {
  // Canonical flow: browser→bff→mcp-gateway→mcp-server + agents
  const pairs = [
    ['frontend',       'bff'],
    ['bff',            'mcp-gateway'],
    ['bff',            'agent-service'],
    ['mcp-gateway',    'mcp-server'],
    ['mcp-gateway',    'mcp-invest'],
    ['mcp-gateway',    'mortgage-service'],
    ['agent-service',  'langchain-agent'],
    ['agent-service',  'openai-agent'],
    ['agent-service',  'mastra-agent'],
    ['agent-service',  'pydantic-agent'],
    ['bff',            'hitl-service'],
    ['ping-gateway',   'mcp-gateway'],
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

  // Refs always hold latest values — solves stale closure for persist calls
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
    const newNode = { id, label, sub: '', x: 300, y: 300, color: '#94a3b8' };
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
