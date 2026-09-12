import { describe, test, expect, vi } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import useZoomPanViewport from '../useZoomPanViewport';

// Real component, not renderHook: the wheel listener is attached natively
// to containerRef.current in a useEffect, which only exists once React has
// actually committed the ref to a DOM node — renderHook alone never does that.
function TestViewport(props) {
  const { zoom, containerRef, viewportProps } = useZoomPanViewport(props);
  return <div data-testid="viewport" ref={containerRef} {...viewportProps}>{zoom}</div>;
}

describe('useZoomPanViewport', () => {
  test('zoomIn/zoomOut step and clamp at min/max', () => {
    const { result } = renderHook(() => useZoomPanViewport({ initialZoom: 1, min: 0.5, max: 1.5, step: 0.25 }));

    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(1.25);

    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(1.5); // clamped at max, not 1.75

    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(0.5); // clamped at min, not below
  });

  test('zoomReset restores the initial zoom and clears pan', () => {
    const { result } = renderHook(() => useZoomPanViewport({ initialZoom: 1.2 }));
    act(() => result.current.zoomIn());
    expect(result.current.zoom).not.toBe(1.2);

    act(() => result.current.zoomReset());
    expect(result.current.zoom).toBe(1.2);
    expect(result.current.pan).toEqual({ x: 0, y: 0 });
  });

  // React attaches `wheel` as a passive listener, so a plain React onWheel
  // prop can never actually preventDefault in a real browser — the page
  // would scroll underneath the zooming diagram. The fix attaches a real,
  // non-passive listener straight to containerRef.current, which is why
  // this test mounts a real component instead of using renderHook: the
  // listener only exists once React has committed the ref to a DOM node.
  test('a real (non-passive) wheel listener zooms and suppresses the native scroll', () => {
    render(<TestViewport initialZoom={1} step={0.25} />);
    const el = screen.getByTestId('viewport');

    const zoomOutEvent = new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true });
    act(() => { el.dispatchEvent(zoomOutEvent); });
    expect(screen.getByTestId('viewport').textContent).toBe('0.75');
    expect(zoomOutEvent.defaultPrevented).toBe(true);

    const zoomInEvent = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    act(() => { el.dispatchEvent(zoomInEvent); });
    expect(screen.getByTestId('viewport').textContent).toBe('1');
  });

  test('right-click starts a pan; left-click does not (stays free for clicking diagram content)', () => {
    const { result } = renderHook(() => useZoomPanViewport());
    const preventDefault = vi.fn();

    act(() => result.current.viewportProps.onMouseDown({ button: 0, preventDefault }));
    expect(result.current.isPanning).toBe(false);

    act(() => result.current.viewportProps.onMouseDown({ button: 2, clientX: 10, clientY: 10, preventDefault }));
    expect(result.current.isPanning).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  test('contentStyle applies pan and zoom as a single CSS transform', () => {
    const { result } = renderHook(() => useZoomPanViewport({ initialZoom: 2 }));
    expect(result.current.contentStyle.transform).toBe('translate(0px, 0px) scale(2)');
  });
});
