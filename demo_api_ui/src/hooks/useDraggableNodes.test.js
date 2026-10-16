import { act, renderHook } from '@testing-library/react';
import { useDraggableNodes } from './useDraggableNodes';

const computed = [
  { id: 'a', position: { x: 0, y: 0 } },
  { id: 'b', position: { x: 10, y: 10 } },
];

describe('useDraggableNodes', () => {
  it('keeps a dragged node where it was dropped, even when the layout recomputes', () => {
    const { result, rerender } = renderHook(({ nodes }) => useDraggableNodes(nodes), { initialProps: { nodes: computed } });
    act(() => result.current.onNodesChange([{ type: 'position', id: 'a', position: { x: 50, y: 60 } }]));
    expect(result.current.nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(result.current.nodes[1].position).toEqual({ x: 10, y: 10 });
    rerender({ nodes: computed.map((n) => ({ ...n, data: { hot: true } })) });
    expect(result.current.nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(result.current.nodes[0].data).toEqual({ hot: true });
  });

  it('ignores changes that are not drags', () => {
    const { result } = renderHook(() => useDraggableNodes(computed));
    act(() => result.current.onNodesChange([{ type: 'select', id: 'a', selected: true }, { type: 'dimensions', id: 'b' }]));
    expect(result.current.nodes).toEqual(computed);
  });

  it('carries the nodes named by carry() along with a dragged backdrop', () => {
    const list = [
      { id: 'g', position: { x: 0, y: 0 } },
      { id: 'm1', position: { x: 5, y: 5 } },
      { id: 'other', position: { x: 100, y: 100 } },
    ];
    const carry = (node) => (node.id === 'g' ? ['m1'] : []);
    const { result } = renderHook(() => useDraggableNodes(list, carry));
    act(() => result.current.onNodesChange([{ type: 'position', id: 'g', position: { x: 30, y: 40 } }]));
    const at = (id) => result.current.nodes.find((n) => n.id === id).position;
    expect(at('g')).toEqual({ x: 30, y: 40 });
    expect(at('m1')).toEqual({ x: 35, y: 45 });
    expect(at('other')).toEqual({ x: 100, y: 100 });
  });
});
