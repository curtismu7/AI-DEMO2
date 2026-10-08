import { describe, test, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

const fitView = vi.fn();
let hookOptions;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReactFlow: () => ({ fitView }) };
});

import { useFitOnSource } from '../useFitOnResize';

function Probe({ source, options }) {
  hookOptions = options;
  useFitOnSource(source, options);
  return null;
}

describe('useFitOnSource', () => {
  test('refits when the diagram source changes; skips empty sources', () => {
    vi.useFakeTimers();
    fitView.mockClear();
    const opts = { padding: 0.04 };

    const { rerender } = render(
      <ReactFlowProvider>
        <Probe source="sequenceDiagram A->>B: hi" options={opts} />
      </ReactFlowProvider>,
    );
    // rAF fires the fit for the first source
    act(() => { vi.advanceTimersByTime(50); }); // flush rAF (jsdom + fake timers: rAF stubbed in setup)
    const afterFirst = fitView.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(fitView.mock.calls.at(-1)[0]).toBe(opts);

    // Same source again: no refit
    rerender(
      <ReactFlowProvider>
        <Probe source="sequenceDiagram A->>B: hi" options={opts} />
      </ReactFlowProvider>,
    );
    act(() => { vi.advanceTimersByTime(50); });
    expect(fitView.mock.calls.length).toBe(afterFirst);

    // New source (protocol swap): refit
    rerender(
      <ReactFlowProvider>
        <Probe source="sequenceDiagram A->>B: hi\nC->>D: more" options={opts} />
      </ReactFlowProvider>,
    );
    act(() => { vi.advanceTimersByTime(50); });
    expect(fitView.mock.calls.length).toBeGreaterThan(afterFirst);

    // Empty source: no fit, no crash
    fitView.mockClear();
    rerender(
      <ReactFlowProvider>
        <Probe source="" options={opts} />
      </ReactFlowProvider>,
    );
    act(() => { vi.advanceTimersByTime(50); });
    expect(fitView).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
