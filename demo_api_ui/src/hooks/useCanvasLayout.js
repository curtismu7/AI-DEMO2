import { useState, useCallback, useRef, useEffect } from 'react'; // v7
import topologyRaw from '../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v8';

// Layout — single Agent Gateway node (Node/IG modes are the same product),
// PingOne SSO added as IDP for RFC 8693 token exchange.
//
// Positions are computed deterministically from NODE_GRID rather than
// hard-coded, so the default layout is guaranteed overlap-free and stays
// clean as nodes are added. Each node has a column index (left → right) and
// a row offset from the horizontal "spine" (row 0). Column pitch and row
// pitch both exceed the box size (W=155, H=86), so no two nodes overlap.
//
// Columns (left → right):
//  0 Browser  1 BFF  2 Agent Layer  3 Gateway  4 Auth / Policy  5 MCP Backends

const COL_PITCH = 208;  // horizontal gap between columns (> W = 155)
const ROW_PITCH = 140;  // vertical gap between stacked nodes (> H = 86)
const X0 = 30;          // left margin of column 0
const SPINE_Y = 210;    // y of the primary (row 0) flow nodes

const NODE_GRID = {
  frontend:          { col: 0, row: 0 },
  bff:               { col: 1, row: 0 },
  'langchain-agent': { col: 2, row: -1 },
  'agent-service':   { col: 2, row: 1 },
  // A2A delegation subsystem (agent layer)
  'a2a-orchestrator':{ col: 2, row: 2 },
  'a2a-specialist':  { col: 3, row: 2 },
  'mcp-gateway':     { col: 3, row: 0 },
  'authz-server':    { col: 4, row: -1 },
  'pingone-sso':     { col: 4, row: 0 },
  'hitl-service':    { col: 4, row: 1 },
  'mcp-server':      { col: 5, row: -1 },
  'mcp-invest':      { col: 5, row: 0 },
  'mortgage-service':{ col: 5, row: 1 },
};

// Deterministic, overlap-free positions keyed by node id. NODE_GRID is static,
// so this is computed once at module load rather than on every render.
function computeAutoLayout() {
  const out = {};
  for (const [id, { col, row }] of Object.entries(NODE_GRID)) {
    out[id] = { x: X0 + col * COL_PITCH, y: SPINE_Y + row * ROW_PITCH };
  }
  return out;
}
const AUTO_POSITIONS = computeAutoLayout();

const NODE_LAYER = {
  frontend:          'client',
  bff:               'gateway',
  'langchain-agent': 'agent',
  'agent-service':   'agent',
  'a2a-orchestrator':'agent',
  'a2a-specialist':  'agent',
  'mcp-gateway':     'mcp',
  'authz-server':    'policy',
  'pingone-sso':     'policy',
  'hitl-service':    'tool',
  'mcp-server':      'backend',
  'mcp-invest':      'backend',
  'mortgage-service':'backend',
};

// Human-readable display labels (overrides the id as label)
const NODE_LABEL = {
  'a2a-orchestrator': 'A2A Orchestrator',
  'a2a-specialist':   'Specialist Agent',
  'mcp-gateway':  'Ping Agent Gateway',
  'authz-server': 'PingOne Authorize',
  'pingone-sso':  'PingOne SSO',
  'hitl-service': 'HITL Service',
};

const NODE_SUB = {
  frontend:          'Browser',
  bff:               'https:3001',
  'langchain-agent': 'http:8888 · AG-UI',
  'agent-service':   'http:3006 · NL mode',
  'a2a-orchestrator':'CrewAI · decide/authorize',
  'a2a-specialist':  'Investment / Records / Purchase',
  'mcp-gateway':     'http:3005 · Node / IG',
  'authz-server':    'http:9001 · P1AZ',
  'pingone-sso':     'IDP · Token Exchange',
  'hitl-service':    'http:3009',
  'mcp-server':      'http:8080 · OLB',
  'mcp-invest':      'http:8081',
  'mortgage-service':'http:8082',
};

function buildSeedNodes() {
  return Object.keys(AUTO_POSITIONS).map(id => {
    const svc = topologyRaw.services?.[id];
    return {
      id,
      label: NODE_LABEL[id] ?? id,
      sub:   NODE_SUB[id] ?? (svc ? `${svc.scheme}:${svc.port}` : ''),
      x: AUTO_POSITIONS[id].x,
      y: AUTO_POSITIONS[id].y,
      layer: NODE_LAYER[id] ?? 'tool',
    };
  });
}

function buildSeedEdges(nodes) {
  const pairs = [
    ['frontend',        'bff'],
    ['bff',             'langchain-agent'],
    ['bff',             'agent-service'],
    // A2A — agent-to-agent delegation subsystem
    ['agent-service',   'a2a-orchestrator'],
    ['a2a-orchestrator','authz-server'],
    ['a2a-orchestrator','a2a-specialist'],
    ['a2a-specialist',  'mcp-gateway'],
    // BFF → PingOne SSO for RFC 8693 token exchange before calling gateway
    ['bff',             'pingone-sso'],
    ['bff',             'mcp-gateway'],
    ['mcp-gateway',     'authz-server'],
    ['mcp-gateway',     'hitl-service'],
    ['mcp-gateway',     'mcp-server'],
    ['mcp-gateway',     'mcp-invest'],
    ['mcp-gateway',     'mortgage-service'],
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
