import { useState, useCallback, useRef, useEffect } from 'react'; // v7
import topologyRaw from '../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v7';

// Layout — single Agent Gateway node (Node/IG modes are the same product),
// PingOne SSO added as IDP for RFC 8693 token exchange
//
// Columns (left → right):
//  0  Browser         x=30
//  1  BFF             x=220
//  2  Agent Layer     x=430   (langchain-agent top, agent-service bottom)
//  3  Gateway         x=640   (single Agent Gateway, centred)
//  4  Auth / Policy   x=855   (authz-server top, pingone-sso middle, hitl-service bottom)
//  5  MCP Backends    x=1075

const SEED_POSITIONS = {
  frontend:          { x: 30,   y: 220 },
  bff:               { x: 220,  y: 220 },
  'langchain-agent': { x: 430,  y: 80  },
  'agent-service':   { x: 430,  y: 340 },
  'mcp-gateway':     { x: 640,  y: 210 },
  'authz-server':    { x: 855,  y: 40  },
  'pingone-sso':     { x: 855,  y: 185 },
  'hitl-service':    { x: 855,  y: 360 },
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
  'authz-server':    'policy',
  'pingone-sso':     'policy',
  'hitl-service':    'tool',
  'mcp-server':      'backend',
  'mcp-invest':      'backend',
  'mortgage-service':'backend',
};

// Human-readable display labels (overrides the id as label)
const NODE_LABEL = {
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
  'mcp-gateway':     'http:3005 · Node / IG',
  'authz-server':    'http:9001 · P1AZ',
  'pingone-sso':     'IDP · Token Exchange',
  'hitl-service':    'http:3009',
  'mcp-server':      'http:8080 · OLB',
  'mcp-invest':      'http:8081',
  'mortgage-service':'http:8082',
};

function buildSeedNodes() {
  return Object.keys(SEED_POSITIONS).map(id => {
    const svc = topologyRaw.services?.[id];
    return {
      id,
      label: NODE_LABEL[id] ?? id,
      sub:   NODE_SUB[id] ?? (svc ? `${svc.scheme}:${svc.port}` : ''),
      x: SEED_POSITIONS[id].x,
      y: SEED_POSITIONS[id].y,
      layer: NODE_LAYER[id] ?? 'tool',
    };
  });
}

function buildSeedEdges(nodes) {
  const pairs = [
    ['frontend',        'bff',                  'Send message'],
    ['bff',             'langchain-agent',      'Dispatch (AG-UI)'],
    ['bff',             'agent-service',        'Dispatch (NL mode)'],
    // BFF → PingOne SSO for RFC 8693 token exchange before calling gateway
    ['bff',             'pingone-sso',          'Token exchange'],
    ['bff',             'mcp-gateway',          'Routing'],
    ['mcp-gateway',     'authz-server',         'Authorize request'],
    ['mcp-gateway',     'hitl-service',         'Challenge'],
    ['mcp-gateway',     'mcp-server',           'MCP API call'],
    ['mcp-gateway',     'mcp-invest',           'MCP API call'],
    ['mcp-gateway',     'mortgage-service',     'MCP API call'],
    ['authz-server',    'pingone-sso',          'Token introspection'],
  ];
  const nodeIds = new Set(nodes.map(n => n.id));
  return pairs
    .filter(([a, b]) => nodeIds.has(a) && nodeIds.has(b))
    .map(([from, to, label]) => ({ id: `e-${from}-${to}`, from, to, label }));
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

  const removeNode = useCallback((id) => {
    setNodes(prev => {
      const next = prev.filter(n => n.id !== id);
      persist(next, edgesRef.current);
      return next;
    });
    setEdges(prev => {
      const next = prev.filter(e => e.from !== id && e.to !== id);
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

  return { nodes, edges, moveNode, renameNode, addNode, removeEdge, addEdge, removeNode, resetLayout };
}
