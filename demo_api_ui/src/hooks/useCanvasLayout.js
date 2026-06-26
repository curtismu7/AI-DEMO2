import { useState, useCallback, useRef, useEffect } from 'react'; // v4
import topologyRaw from '../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v6';

// Layout reflects the ACTUAL call paths from code:
//
// AG-UI path:  browser → bff → langchain-agent ⟲(callback)→ bff → mcp-gateway → p1az → mcp-server
// NL path:     browser → bff → agent-service → llm ⟲(callback)→ bff → mcp-gateway → p1az → mcp-server
// Alt gateway: ping-gateway replaces mcp-gateway (same position, user-selectable)
// HITL:        mcp-gateway → hitl-service (on P1AZ INDETERMINATE)
//
// Columns (left → right):
//  0  Browser client        x=30
//  1  BFF                   x=220
//  2  Agent layer           x=430   (langchain-agent top, agent-service bottom)
//  3  Gateway layer         x=640   (mcp-gateway top, ping-gateway bottom)
//  4  Policy / HITL         x=850   (authz-server top, hitl-service bottom)
//  5  MCP backends          x=1060  (mcp-server, mcp-invest, mortgage-service)

const SEED_POSITIONS = {
  frontend:          { x: 30,   y: 220 },
  bff:               { x: 220,  y: 220 },
  'langchain-agent': { x: 430,  y: 80  },
  'agent-service':   { x: 430,  y: 340 },
  'mcp-gateway':     { x: 640,  y: 80  },
  'ping-gateway':    { x: 640,  y: 340 },
  'authz-server':    { x: 855,  y: 80  },
  'hitl-service':    { x: 855,  y: 340 },
  'mcp-server':      { x: 1075, y: 40  },
  'mcp-invest':      { x: 1075, y: 200 },
  'mortgage-service':{ x: 1075, y: 360 },
};

const NODE_LAYER = {
  frontend:          'client',
  bff:               'gateway',
  'langchain-agent': 'agent',
  'agent-service':   'agent',
  'mcp-gateway':     'mcp',
  'ping-gateway':    'mcp',
  'authz-server':    'policy',
  'hitl-service':    'tool',
  'mcp-server':      'backend',
  'mcp-invest':      'backend',
  'mortgage-service':'backend',
};

// Sub-labels shown under the service name
const NODE_SUB = {
  frontend:          'Browser',
  bff:               'https:3001',
  'langchain-agent': 'http:8888 · AG-UI',
  'agent-service':   'http:3006 · NL mode',
  'mcp-gateway':     'http:3005 · Node',
  'ping-gateway':    'http:8080 · IG',
  'authz-server':    'http:9001 · P1AZ',
  'hitl-service':    'http:3009',
  'mcp-server':      'http:8080 · OLB',
  'mcp-invest':      'http:8081',
  'mortgage-service':'http:8082',
};

function buildSeedNodes() {
  const all = Object.keys(SEED_POSITIONS);
  return all.map(id => {
    const svc = topologyRaw.services?.[id];
    return {
      id,
      label: id,
      sub: NODE_SUB[id] ?? (svc ? `${svc.scheme}:${svc.port}` : ''),
      x: SEED_POSITIONS[id].x,
      y: SEED_POSITIONS[id].y,
      layer: NODE_LAYER[id] ?? 'tool',
    };
  });
}

function buildSeedEdges(nodes) {
  const pairs = [
    // Main flow
    ['frontend',        'bff'],
    // AG-UI: BFF → langchain-agent (SSE stream)
    ['bff',             'langchain-agent'],
    // NL mode: BFF → agent-service → [LLM reasons] → callback to BFF
    ['bff',             'agent-service'],
    // Both paths converge: BFF → mcp-gateway (after token exchange)
    ['bff',             'mcp-gateway'],
    // ping-gateway is the alternative gateway (replaces mcp-gateway)
    ['bff',             'ping-gateway'],
    // mcp-gateway → P1AZ for policy decision
    ['mcp-gateway',     'authz-server'],
    // mcp-gateway → HITL on INDETERMINATE
    ['mcp-gateway',     'hitl-service'],
    // mcp-gateway → backends
    ['mcp-gateway',     'mcp-server'],
    ['mcp-gateway',     'mcp-invest'],
    ['mcp-gateway',     'mortgage-service'],
    // ping-gateway → P1AZ (same policy guard, different runtime)
    ['ping-gateway',    'authz-server'],
    // ping-gateway → backends (performs its own RFC 8693 re-exchange)
    ['ping-gateway',    'mcp-server'],
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
      const next = [...prev, { id, label, sub: '', x: 400, y: 500, layer: 'tool' }];
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
