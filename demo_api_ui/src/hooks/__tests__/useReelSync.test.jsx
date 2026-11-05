import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { useReelSync } from '../useReelSync';

function Probe({ reelSync, goTo, count }) {
  const ref = useRef(null);
  useReelSync(reelSync, goTo, count, ref);
  return <details><summary>Expand</summary><div ref={ref} /></details>;
}
const announce = (stepId) => act(() => { window.dispatchEvent(new CustomEvent('token-chain-step-select', { detail: { stepId } })); });

describe('useReelSync', () => {
  it('walks the diagram to the mapped step and opens the <details> around it', () => {
    const goTo = vi.fn();
    const { container } = render(<Probe reelSync={(id) => (id === 'mcp' ? 4 : -1)} goTo={goTo} count={6} />);
    announce('nope');
    expect(goTo).not.toHaveBeenCalled();
    expect(container.querySelector('details').open).toBe(false);
    announce('mcp');
    expect(goTo).toHaveBeenCalledWith(4);
    expect(container.querySelector('details').open).toBe(true);
  });
  it('ignores a step outside the diagram and stops listening after unmount', () => {
    const goTo = vi.fn();
    const { unmount } = render(<Probe reelSync={() => 99} goTo={goTo} count={6} />);
    announce('x');
    expect(goTo).not.toHaveBeenCalled();
    unmount();
    announce('x');
    expect(goTo).not.toHaveBeenCalled();
  });
});
