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
