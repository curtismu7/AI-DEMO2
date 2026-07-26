import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import TraceStepCard from '../TraceStepCard';

const step = {
  id: 'authorize-decision',
  status: 'ok',
  lane: 'MCP',
  title: 'Authorize decision',
  detail: { narrative: 'PingOne Authorize evaluated the request.' },
};

describe('TraceStepCard', () => {
  it('exposes a stable data-step-id for the workbench to target', () => {
    const { container } = render(<TraceStepCard step={step} onInspect={() => {}} />);
    const card = container.querySelector('[data-step-id="authorize-decision"]');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('tctr-step');
    expect(card).toHaveAttribute('data-status', 'ok');
  });

  it('still renders its narrative body — the attribute is additive only', () => {
    render(<TraceStepCard step={step} onInspect={() => {}} defaultOpen />);
    expect(screen.getByText(/PingOne Authorize evaluated the request/)).toBeInTheDocument();
  });
});
