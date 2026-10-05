import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentRunIndicator, { AgentWorkingMark } from '../AgentRunIndicator';

describe('AgentRunIndicator', () => {
  it('shows what the agent is working on, as one status for assistive tech', () => {
    render(<AgentRunIndicator label="Demo step 25A — working…" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Demo step 25A — working…');
    // The Ping mark is decorative here; the note carries the meaning, so there is one status, not two.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('draws the dancing Ping mark on the assistant side of the transcript', () => {
    const { container } = render(<AgentRunIndicator label="Working…" />);

    expect(container.querySelector('.ping-spinner__mark--dancing')).toBeTruthy();
    expect(screen.getByTestId('agent-run-indicator').className).toContain('banking-agent-msg assistant');
  });
});

describe('AgentWorkingMark', () => {
  it('is the dancing red P, not the old three typing dots', () => {
    const { container } = render(<AgentWorkingMark />);

    const mark = container.querySelector('img.ping-spinner__mark--dancing');
    expect(mark).toBeTruthy();
    expect(mark.getAttribute('src')).toBe('/branding/ping-logo.svg');
    expect(container.querySelector('.ba-typing-dot')).toBeNull();
  });

  it('with no label it shows the short note "Working…", once', () => {
    render(<AgentWorkingMark />);

    expect(screen.getByRole('status')).toHaveTextContent('Working…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
