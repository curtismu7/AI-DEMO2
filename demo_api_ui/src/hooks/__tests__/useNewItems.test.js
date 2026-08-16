import { renderHook } from '@testing-library/react';
import { useNewItems } from '../useNewItems';

// BUGS.md #26 — prevLenRef only advanced on growth, so a shorter array
// (e.g. a fresh agent run resetting mcpTraffic/authorizeDecisions to [] before
// regrowing) computed a negative newCount forever and onNew never fired again.
describe('useNewItems', () => {
  it('fires onNew with the appended slice as the array grows', () => {
    const onNew = vi.fn();
    let items = ['a', 'b'];
    const { rerender } = renderHook(({ items }) => useNewItems(items, true, onNew), {
      initialProps: { items },
    });
    expect(onNew).toHaveBeenCalledWith(['a', 'b']);

    onNew.mockClear();
    items = ['a', 'b', 'c'];
    rerender({ items });
    expect(onNew).toHaveBeenCalledWith(['c']);
  });

  it('recovers after the array is reset to a shorter one by a new run', () => {
    const onNew = vi.fn();
    let items = ['a', 'b', 'c', 'd', 'e'];
    const { rerender } = renderHook(({ items }) => useNewItems(items, true, onNew), {
      initialProps: { items },
    });
    expect(onNew).toHaveBeenCalledWith(items);

    // New run starts: STATE_SNAPSHOT resets the array to empty, then it regrows
    // to a peak lower than the previous run's peak (5).
    onNew.mockClear();
    items = [];
    rerender({ items });
    expect(onNew).not.toHaveBeenCalled();

    items = ['x', 'y', 'z'];
    rerender({ items });
    expect(onNew).toHaveBeenCalledWith(['x', 'y', 'z']);
  });
});
