# Konva Editable Architecture Diagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/architecture/canvas` page that renders the full service topology as a Konva canvas diagram and lets demo users move boxes, disconnect/reconnect edges, add new boxes with custom names, and persist layout to localStorage.

**Architecture:** A single new React page (`ArchitectureCanvasPage`) owns a `react-konva` Stage with two Layers — one for edges (arrows), one for nodes (draggable rectangles). Node positions and custom nodes are persisted to localStorage under a versioned key. A separate lightweight `useCanvasLayout` hook owns layout state, persistence, and reset. The page is added to the `/architecture/*` route tree and linked from `AdminSideNav`.

**Tech Stack:** react-konva ^9, konva ^9, React 19, React Router v6, Vite, Vitest + React Testing Library

## Global Constraints

- Use `react-konva` v9 and `konva` v9 — install both explicitly.
- All new files go under `demo_api_ui/src/` — never touch `demo_api_server/`.
- Route path: `/architecture/canvas` — added to `EducationRoutes.js`.
- Nav entry added to `AdminSideNav.jsx` Diagrams group AND `SideNav.js` Tools group.
- Initial nodes seeded from `service-topology.json` (14 services at the project root) — import the JSON directly; do not fetch at runtime.
- Persist layout to `localStorage` key `arch-canvas-v1`.
- No TypeScript — `.jsx` files only.
- Do not modify any existing diagram pages or components.
- Test runner: `npm test` (Vitest) inside `demo_api_ui/`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `demo_api_ui/src/components/ArchitectureCanvasPage.jsx` | **Create** | Page wrapper — toolbar, Konva Stage, edit controls |
| `demo_api_ui/src/components/ArchitectureCanvasPage.css` | **Create** | Page layout + toolbar styles |
| `demo_api_ui/src/hooks/useCanvasLayout.js` | **Create** | State, persistence, reset logic |
| `demo_api_ui/src/components/__tests__/useCanvasLayout.test.js` | **Create** | Unit tests for the hook |
| `demo_api_ui/src/routes/EducationRoutes.js` | **Modify** | Add `canvas` route |
| `demo_api_ui/src/components/AdminSideNav.jsx` | **Modify** | Add Canvas Diagram nav entry |
| `demo_api_ui/src/components/SideNav.js` | **Modify** | Add Canvas Diagram to Tools group |

---

### Task 1: Install dependencies and scaffold the hook

**Files:**
- Modify: `demo_api_ui/package.json` (via npm install)
- Create: `demo_api_ui/src/hooks/useCanvasLayout.js`
- Create: `demo_api_ui/src/components/__tests__/useCanvasLayout.test.js`

**Interfaces:**
- Produces: `useCanvasLayout()` → `{ nodes, edges, moveNode, addNode, removeEdge, addEdge, resetLayout }`
  - `nodes`: `Array<{ id, label, sub, x, y, color }>` — initial positions from topology seed
  - `edges`: `Array<{ id, from, to }>` — initial connections from topology seed
  - `moveNode(id, x, y)`: updates a node's position in state + localStorage
  - `addNode(label)`: appends new node with auto-id, centers at (300, 300)
  - `removeEdge(id)`: removes edge from state + localStorage
  - `addEdge(fromId, toId)`: appends new edge, auto-id `e-${fromId}-${toId}-${Date.now()}`
  - `resetLayout()`: clears localStorage key, resets to seed

- [ ] **Step 1: Install react-konva and konva**

```bash
cd demo_api_ui && npm install konva react-konva
```

Expected: `package.json` now lists `"konva"` and `"react-konva"` in dependencies.

- [ ] **Step 2: Write the failing tests for useCanvasLayout**

Create `demo_api_ui/src/components/__tests__/useCanvasLayout.test.js`:

```js
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

import useCanvasLayout from '../../hooks/useCanvasLayout';

beforeEach(() => localStorageMock.clear());

describe('useCanvasLayout', () => {
  it('seeds nodes from topology on first load', () => {
    const { result } = renderHook(() => useCanvasLayout());
    expect(result.current.nodes.length).toBeGreaterThan(0);
    expect(result.current.nodes[0]).toMatchObject({ id: expect.any(String), label: expect.any(String), x: expect.any(Number), y: expect.any(Number) });
  });

  it('moveNode updates position', () => {
    const { result } = renderHook(() => useCanvasLayout());
    const firstId = result.current.nodes[0].id;
    act(() => result.current.moveNode(firstId, 999, 888));
    const moved = result.current.nodes.find(n => n.id === firstId);
    expect(moved.x).toBe(999);
    expect(moved.y).toBe(888);
  });

  it('addNode appends a new node', () => {
    const { result } = renderHook(() => useCanvasLayout());
    const before = result.current.nodes.length;
    act(() => result.current.addNode('My Service'));
    expect(result.current.nodes.length).toBe(before + 1);
    expect(result.current.nodes.at(-1).label).toBe('My Service');
  });

  it('removeEdge removes the edge', () => {
    const { result } = renderHook(() => useCanvasLayout());
    const firstEdgeId = result.current.edges[0]?.id;
    if (!firstEdgeId) return; // skip if no edges seeded
    act(() => result.current.removeEdge(firstEdgeId));
    expect(result.current.edges.find(e => e.id === firstEdgeId)).toBeUndefined();
  });

  it('addEdge appends edge between two nodes', () => {
    const { result } = renderHook(() => useCanvasLayout());
    const [a, b] = result.current.nodes;
    act(() => result.current.addEdge(a.id, b.id));
    const last = result.current.edges.at(-1);
    expect(last.from).toBe(a.id);
    expect(last.to).toBe(b.id);
  });

  it('resetLayout restores original node count', () => {
    const { result } = renderHook(() => useCanvasLayout());
    const original = result.current.nodes.length;
    act(() => result.current.addNode('Temp'));
    act(() => result.current.resetLayout());
    expect(result.current.nodes.length).toBe(original);
  });

  it('persists layout to localStorage on moveNode', () => {
    const { result } = renderHook(() => useCanvasLayout());
    act(() => result.current.moveNode(result.current.nodes[0].id, 42, 42));
    const stored = JSON.parse(localStorageMock.getItem('arch-canvas-v1'));
    expect(stored.nodes[0].x === 42 || stored.nodes.find(n => n.x === 42)).toBeTruthy();
  });

  it('loads persisted layout on mount', () => {
    const seed = { nodes: [{ id: 'n-test', label: 'Test', sub: '', x: 55, y: 77, color: '#aaa' }], edges: [] };
    localStorageMock.setItem('arch-canvas-v1', JSON.stringify(seed));
    const { result } = renderHook(() => useCanvasLayout());
    expect(result.current.nodes.find(n => n.id === 'n-test')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests — expect all to fail (hook not written yet)**

```bash
cd demo_api_ui && npm test -- --run src/components/__tests__/useCanvasLayout.test.js
```

Expected: Multiple failures — `useCanvasLayout` not found.

- [ ] **Step 4: Implement useCanvasLayout**

Create `demo_api_ui/src/hooks/useCanvasLayout.js`:

```js
import { useState, useCallback } from 'react';
import topologyRaw from '../../service-topology.json';

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

  const persist = useCallback((nextNodes, nextEdges) => {
    saveToStorage(nextNodes, nextEdges);
  }, []);

  const moveNode = useCallback((id, x, y) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, x, y } : n);
      persist(next, edges);
      return next;
    });
  }, [edges, persist]);

  const addNode = useCallback((label) => {
    const id = `custom-${Date.now()}`;
    const newNode = { id, label, sub: '', x: 300, y: 300, color: '#94a3b8' };
    setNodes(prev => {
      const next = [...prev, newNode];
      persist(next, edges);
      return next;
    });
  }, [edges, persist]);

  const removeEdge = useCallback((id) => {
    setEdges(prev => {
      const next = prev.filter(e => e.id !== id);
      persist(nodes, next);
      return next;
    });
  }, [nodes, persist]);

  const addEdge = useCallback((fromId, toId) => {
    const newEdge = { id: `e-${fromId}-${toId}-${Date.now()}`, from: fromId, to: toId };
    setEdges(prev => {
      const next = [...prev, newEdge];
      persist(nodes, next);
      return next;
    });
  }, [nodes, persist]);

  const resetLayout = useCallback(() => {
    const freshNodes = buildSeedNodes();
    const freshEdges = buildSeedEdges(freshNodes);
    setNodes(freshNodes);
    setEdges(freshEdges);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }, []);

  return { nodes, edges, moveNode, addNode, removeEdge, addEdge, resetLayout };
}
```

- [ ] **Step 5: Run tests — expect all to pass**

```bash
cd demo_api_ui && npm test -- --run src/components/__tests__/useCanvasLayout.test.js
```

Expected: All 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd demo_api_ui && git add package.json package-lock.json src/hooks/useCanvasLayout.js src/components/__tests__/useCanvasLayout.test.js
git commit -m "feat: add useCanvasLayout hook with Konva topology seed and localStorage persistence"
```

---

### Task 2: Build the ArchitectureCanvasPage component

**Files:**
- Create: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx`
- Create: `demo_api_ui/src/components/ArchitectureCanvasPage.css`

**Interfaces:**
- Consumes: `useCanvasLayout()` from `../hooks/useCanvasLayout`
- Consumes: `Stage, Layer, Rect, Text, Arrow, Group, Circle` from `react-konva`
- Produces: `default export ArchitectureCanvasPage` — a page component, no required props

- [ ] **Step 1: Create the CSS file**

Create `demo_api_ui/src/components/ArchitectureCanvasPage.css`:

```css
.canvas-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 600px;
  background: #f8fafc;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
}

.canvas-toolbar h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
  flex: 1;
}

.canvas-toolbar input[type="text"] {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  width: 160px;
}

.canvas-toolbar button {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.btn-add    { background: #3b82f6; color: #fff; }
.btn-add:hover    { background: #2563eb; }
.btn-connect { background: #10b981; color: #fff; }
.btn-connect.active { background: #059669; box-shadow: 0 0 0 3px rgba(16,185,129,0.3); }
.btn-connect:hover { background: #059669; }
.btn-reset  { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.btn-reset:hover  { background: #e2e8f0; }
.btn-delete { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.btn-delete:hover { background: #fca5a5; }

.canvas-hint {
  font-size: 12px;
  color: #94a3b8;
  padding: 4px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
}

.canvas-stage-wrap {
  flex: 1;
  overflow: hidden;
}

.canvas-edge-label {
  font-size: 11px;
  color: #64748b;
}
```

- [ ] **Step 2: Create ArchitectureCanvasPage.jsx**

Create `demo_api_ui/src/components/ArchitectureCanvasPage.jsx`:

```jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Arrow, Group, Circle } from 'react-konva';
import useCanvasLayout from '../hooks/useCanvasLayout';
import './ArchitectureCanvasPage.css';

const NODE_W = 140;
const NODE_H = 54;
const NODE_R = 8;

// Find the centre of a node for edge attachment
function nodeCentre(node) {
  return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
}

// Build arrow points from source node edge to target node edge
function edgePoints(src, tgt) {
  const s = nodeCentre(src);
  const t = nodeCentre(tgt);
  return [s.x, s.y, t.x, t.y];
}

export default function ArchitectureCanvasPage() {
  const { nodes, edges, moveNode, addNode, removeEdge, addEdge, resetLayout } = useCanvasLayout();
  const [newLabel, setNewLabel] = useState('');
  const [connectMode, setConnectMode] = useState(false); // select 2 nodes to connect
  const [connectFrom, setConnectFrom] = useState(null);  // first selected node id
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 900, height: 600 });
  const wrapRef = useRef(null);

  // Resize stage to fill container
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

        {/* Add node */}
        <input
          type="text"
          placeholder="New box name…"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddNode()}
        />
        <button className="btn-add" onClick={handleAddNode}>+ Add Box</button>

        {/* Connect mode */}
        <button
          className={`btn-connect${connectMode ? ' active' : ''}`}
          onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}
        >
          {connectMode ? '⬡ Connecting…' : '⬡ Connect Nodes'}
        </button>

        {/* Delete selected edge */}
        <button
          className="btn-delete"
          disabled={!selectedEdge}
          onClick={handleDeleteEdge}
        >
          ✕ Delete Edge
        </button>

        {/* Reset */}
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
          {/* Edge layer — drawn behind nodes */}
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

          {/* Node layer */}
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
                  {/* Drop shadow rect */}
                  <Rect
                    x={2} y={3}
                    width={NODE_W} height={NODE_H}
                    cornerRadius={NODE_R}
                    fill="rgba(0,0,0,0.08)"
                  />
                  {/* Main box */}
                  <Rect
                    width={NODE_W} height={NODE_H}
                    cornerRadius={NODE_R}
                    fill="#fff"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  {/* Colour accent bar */}
                  <Rect
                    width={6} height={NODE_H}
                    cornerRadius={[NODE_R, 0, 0, NODE_R]}
                    fill={node.color}
                  />
                  {/* Label */}
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
                  {/* Connect-mode indicator dot */}
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
```

- [ ] **Step 3: Verify it compiles (no runtime needed)**

```bash
cd demo_api_ui && npx vite build --mode development 2>&1 | grep -E "error|warn|ArchitectureCanvas" | head -20
```

Expected: No errors mentioning `ArchitectureCanvasPage`.

- [ ] **Step 4: Commit**

```bash
cd demo_api_ui && git add src/components/ArchitectureCanvasPage.jsx src/components/ArchitectureCanvasPage.css
git commit -m "feat: add ArchitectureCanvasPage with react-konva draggable nodes and edge editing"
```

---

### Task 3: Wire the page into routing and navigation

**Files:**
- Modify: `demo_api_ui/src/routes/EducationRoutes.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/components/SideNav.js`

**Interfaces:**
- Consumes: `ArchitectureCanvasPage` default export from `../components/ArchitectureCanvasPage`

- [ ] **Step 1: Add route to EducationRoutes.js**

Open `demo_api_ui/src/routes/EducationRoutes.js`. Current content:

```js
import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ArchitectureFlowPage from "../components/ArchitectureFlowPage";
import ArchitectureOverviewPage from "../components/ArchitectureOverviewPage";
import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel";
import ArchitectureTokenFlowPage from "../components/ArchitectureTokenFlowPage";
import Phase266ArchitecturePage from "../components/Phase266ArchitecturePage";

export default function EducationRoutes({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <Routes>
        <Route path="system" element={<ArchitectureTabsPanel user={user} />} />
        <Route path="overview" element={<ArchitectureOverviewPage user={user} />} />
        <Route path="token-flow" element={<ArchitectureTokenFlowPage user={user} />} />
        <Route path="flow" element={<ArchitectureFlowPage user={user} />} />
        <Route path="phase-266" element={<Phase266ArchitecturePage />} />
      </Routes>
    </AppShell>
  );
}
```

Add the import and route:

```js
import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ArchitectureFlowPage from "../components/ArchitectureFlowPage";
import ArchitectureOverviewPage from "../components/ArchitectureOverviewPage";
import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel";
import ArchitectureTokenFlowPage from "../components/ArchitectureTokenFlowPage";
import Phase266ArchitecturePage from "../components/Phase266ArchitecturePage";
import ArchitectureCanvasPage from "../components/ArchitectureCanvasPage";

export default function EducationRoutes({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <Routes>
        <Route path="system" element={<ArchitectureTabsPanel user={user} />} />
        <Route path="overview" element={<ArchitectureOverviewPage user={user} />} />
        <Route path="token-flow" element={<ArchitectureTokenFlowPage user={user} />} />
        <Route path="flow" element={<ArchitectureFlowPage user={user} />} />
        <Route path="phase-266" element={<Phase266ArchitecturePage />} />
        <Route path="canvas" element={<ArchitectureCanvasPage />} />
      </Routes>
    </AppShell>
  );
}
```

- [ ] **Step 2: Add nav entry to AdminSideNav.jsx**

In `demo_api_ui/src/components/AdminSideNav.jsx`, find the Diagrams sub-items array (around line 578). It currently ends with the `hitl` entry. Add the canvas entry before the closing bracket:

Find this pattern:
```js
{ label: "Sequence Diagram", path: "/sequence-diagram", icon: "log" },
```

Add after it (inside the same array):
```js
{ label: "Canvas Diagram", path: "/architecture/canvas", icon: "⬡" },
```

- [ ] **Step 3: Add nav entry to SideNav.js**

In `demo_api_ui/src/components/SideNav.js`, the Tools group was already updated in a prior session to include Token Flow Diagram and Sequence Diagram. Add the Canvas Diagram entry:

Find in `ADMIN_NAV` Tools group:
```js
{ to: "/sequence-diagram", label: "Sequence Diagram", icon: "MdSwapCalls" },
```

Add after it:
```js
{ to: "/architecture/canvas", label: "Canvas Diagram", icon: "MdAccountTree" },
```

Do the same in `buildUserNav` Tools group:
Find:
```js
{ to: "/sequence-diagram", label: "Sequence Diagram", icon: "MdSwapCalls" },
```

Add after it:
```js
{ to: "/architecture/canvas", label: "Canvas Diagram", icon: "MdAccountTree" },
```

- [ ] **Step 4: Smoke-test build**

```bash
cd demo_api_ui && npx vite build --mode development 2>&1 | grep -E "^✓|error" | head -10
```

Expected: Build succeeds (✓ built) with no errors.

- [ ] **Step 5: Commit**

```bash
cd demo_api_ui && git add src/routes/EducationRoutes.js src/components/AdminSideNav.jsx src/components/SideNav.js
git commit -m "feat: wire /architecture/canvas route and nav links for Konva editable diagram"
```

---

### Task 4: Fix stale closure bug in useCanvasLayout (edges/nodes cross-dependency)

The `moveNode` callback in Task 1 closes over `edges` but `edges` may be stale when both change. Same for `removeEdge`/`addEdge` closing over `nodes`. This task fixes it using functional state updates.

**Files:**
- Modify: `demo_api_ui/src/hooks/useCanvasLayout.js`

- [ ] **Step 1: Add regression test for stale closure**

Add to `useCanvasLayout.test.js`:

```js
it('moveNode after addEdge persists both correctly', () => {
  const { result } = renderHook(() => useCanvasLayout());
  const [a, b] = result.current.nodes;
  act(() => result.current.addEdge(a.id, b.id));
  act(() => result.current.moveNode(a.id, 11, 22));
  const stored = JSON.parse(localStorageMock.getItem('arch-canvas-v1'));
  // Both the new edge AND the moved position must be in the stored state
  expect(stored.edges.some(e => e.from === a.id && e.to === b.id)).toBe(true);
  expect(stored.nodes.find(n => n.id === a.id)?.x).toBe(11);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd demo_api_ui && npm test -- --run src/components/__tests__/useCanvasLayout.test.js 2>&1 | tail -15
```

Expected: The new test fails (stale closure drops the edge from persisted state).

- [ ] **Step 3: Fix useCanvasLayout — use refs for cross-state persistence**

Replace the `persist`, `moveNode`, `removeEdge`, and `addEdge` implementations in `demo_api_ui/src/hooks/useCanvasLayout.js`:

```js
import { useState, useCallback, useRef, useEffect } from 'react';
import topologyRaw from '../../service-topology.json';

const STORAGE_KEY = 'arch-canvas-v1';

// ... (keep all seed helpers identical from Task 1) ...

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
```

- [ ] **Step 4: Run all useCanvasLayout tests**

```bash
cd demo_api_ui && npm test -- --run src/components/__tests__/useCanvasLayout.test.js
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd demo_api_ui && git add src/hooks/useCanvasLayout.js src/components/__tests__/useCanvasLayout.test.js
git commit -m "fix: use refs in useCanvasLayout to prevent stale closure in persist calls"
```

---

### Task 5: Manual browser verification

This task has no code changes — it verifies the feature end-to-end in the running app.

**Pre-condition:** Docker stack is running (`docker compose up -d`). You are logged in as `demoAdmin`.

- [ ] **Step 1: Navigate to the canvas page**

Open `https://api.ping.demo:4000/architecture/canvas`. You should see the Architecture Canvas page with 14 service boxes arranged in 3 columns, connected by arrows.

- [ ] **Step 2: Verify drag-to-reposition**

Drag the `frontend` box to a new position. Reload the page. Confirm the box stays in its new position (localStorage persisted).

- [ ] **Step 3: Verify add node**

Type `My Custom Service` in the text input and click `+ Add Box`. Confirm a grey box appears at (300, 300) with the label "My Custom Service".

- [ ] **Step 4: Verify connect nodes**

Click `⬡ Connect Nodes`. Click `My Custom Service`, then click `bff`. Confirm a new arrow appears between them. Click the arrow — confirm it turns red and "Delete Edge" becomes enabled. Click `✕ Delete Edge` — confirm the arrow disappears.

- [ ] **Step 5: Verify reset**

Click `↺ Reset` and confirm in the dialog. Confirm the canvas returns to the default 14-node layout and the custom box is gone.

- [ ] **Step 6: Verify nav links**

Check the Admin sidebar Diagrams group shows "Canvas Diagram". Click it — confirm navigation to `/architecture/canvas`. Log out, log in as `demoUser` — check the Tools section in the SideNav also shows "Canvas Diagram".

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Konva canvas diagram of app flow | Task 2 (Stage + Layer + nodes) |
| Show servers/services as boxes | Task 1 (seed from service-topology.json) |
| Move boxes around | Task 2 (draggable Group) |
| Disconnect lines | Task 2 (click Arrow → selectedEdge → removeEdge) |
| Add new boxes and name them | Task 2 (addNode + input), Task 1 (addNode hook) |
| Persist edits | Task 1 (localStorage), Task 4 (stale closure fix) |
| Nav links for demo users | Task 3 (AdminSideNav + SideNav) |
| Route wired | Task 3 (EducationRoutes) |

**Placeholder scan:** None found — all steps have actual code.

**Type consistency:** `useCanvasLayout` returns same shape in all tasks. `ArchitectureCanvasPage` uses `moveNode(id, x, y)`, `addNode(label)`, `removeEdge(id)`, `addEdge(fromId, toId)` — all match hook definition.
