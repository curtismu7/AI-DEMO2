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
});
