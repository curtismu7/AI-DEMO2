import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import A2aStageTimings from '../A2aStageTimings';

afterEach(cleanup);

const timings = {
  stages: [
    { stage: 'decision', agent: 'Delegation Decision Maker', ms: 1200 },
    { stage: 'specialist', agent: 'banking', ms: 800 },
  ],
  totalMs: 2000,
};

describe('A2aStageTimings', () => {
  it('lists each stage with its agent and ms, and the total', () => {
    render(<A2aStageTimings timings={timings} />);
    expect(screen.getByText('Delegation Decision Maker')).toBeTruthy();
    expect(screen.getByText('banking')).toBeTruthy();
    expect(screen.getByText('1200 ms')).toBeTruthy();
    expect(screen.getByText('800 ms')).toBeTruthy();
    expect(screen.getByText('2000 ms')).toBeTruthy();
  });

  it('renders nothing for a replay or a response without timings', () => {
    const { container, rerender } = render(<A2aStageTimings timings={undefined} />);
    expect(container.firstChild).toBeNull();
    rerender(<A2aStageTimings timings={{ stages: [], totalMs: 0 }} />);
    expect(container.firstChild).toBeNull();
  });
});
