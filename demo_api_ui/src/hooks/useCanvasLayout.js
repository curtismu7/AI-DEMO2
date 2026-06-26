import { useState, useCallback, useRef, useEffect } from 'react'; // v3
import topologyRaw from '../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v3';

// Only these services appear in the default layout.
// openai/mastra/pydantic agents are excluded — one agent (langchain) represents them all.
const SEED_POSITIONS = {
  frontend:          { x: 30,   y: 210 },
  bff:               { x: 210,  y: 210 },
  'agent-service':   { x: 400,  y: 210 },
  'langchain-agent': { x: 590,  y: 210 },
  'mcp-gateway':     { x: 800,  y: 60  },
  'mcp-server':      { x: 800,  y: 170 },
  'mcp-invest':      { x: 800,  y: 280 },
  'mcp-proxy':       { x: 800,  y: 390 },
  'ping-gateway':    { x: 1010, y: 60  },
  'mortgage-service':{ x: 1010, y: 170 },
  'hitl-service':    { x: 1010, y: 280 },
};

// Visual layer — drives box color
const NODE_LAYER = {
  frontend:          'client',
  bff:               'gateway',
  'agent-service':   'orchestrator',
  'langchain-agent': 'agent',
  'mcp-gateway':     'mcp',
  'mcp-server':      'mcp',
  'mcp-invest':      'mcp',
  'mcp-proxy':       'mcp',
  'ping-gateway':    'tool',
  'mortgage-service':'tool',
  'hitl-service':    'tool',
};

function buildSeedNodes() {
  return Object.entries(topologyRaw.services)
    .filter(([id]) => id in SEED_POSITIONS)
    .map(([id, svc]) => ({
      id,
      label: id,
      sub: `${svc.scheme}:${svc.port}`,
      x: SEED_POSITIONS[id].x,
      y: SEED_POSITIONS[id].y,
      layer: NODE_LAYER[id] ?? 'tool',
    }));
}

function buildSeedEdges(nodes) {
  const pairs = [
    ['frontend',        'bff'],
    ['bff',             'agent-service'],
    ['agent-service',   'langchain-agent'],
    ['langchain-agent', 'mcp-gateway'],
    ['langchain-agent', 'mcp-server'],
    ['langchain-agent', 'mcp-invest'],
    ['langchain-agent', 'mcp-proxy'],
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
    const p = loadFromStorage();
    return p ? p.nodes : seed;
  });

  const [edges, setEdges] = useState(() => {
    const p = loadFromStorage();
    return p ? p.edges : seedEdges;
  });

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const persist = useCallback((n, e) => saveToStorage(n, e), []);

  const moveNode = useCallback((id, x, y) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, x, y } : n);
      persist(next, edgesRef.current);
      return next;
    });
  }, [persist]);

  const renameNode = useCallback((id, label) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, label } : n);
      persist(next, edgesRef.current);
      return next;
    });
  }, [persist]);

  const addNode = useCallback((label) => {
    const id = `custom-${Date.now()}`;
    setNodes(prev => {
      const next = [...prev, { id, label, sub: '', x: 400, y: 450, layer: 'tool' }];
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
    setNodes(freshNodes);
    setEdges(buildSeedEdges(freshNodes));
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }, []);

  return { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, resetLayout };
}
