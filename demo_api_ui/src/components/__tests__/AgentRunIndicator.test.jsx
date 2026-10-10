import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpinnerContext from '../../context/SpinnerContext';
import AgentRunIndicator, { AgentWorkingMark, HideWhileGlobalSpinner } from '../AgentRunIndicator';

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
    expect(mark.getAttribute('src')).toBe('/branding/ping-logo.png');
    expect(container.querySelector('.ba-typing-dot')).toBeNull();
  });

  it('with no label it shows the short note "Working…", once', () => {
    render(<AgentWorkingMark />);

    // Exact match: the spinner must not echo the note as a second visible label.
    expect(screen.getByRole('status').textContent).toBe('Working…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('shows a long run note once, not echoed beside the mark', () => {
    render(<AgentWorkingMark label="Demo step 25: UC46A — working…" />);

    expect(screen.getByRole('status').textContent).toBe('Demo step 25: UC46A — working…');
  });
});

describe('HideWhileGlobalSpinner', () => {
  it('shows the agent\'s mark when the global spinner is not showing', () => {
    render(<HideWhileGlobalSpinner><AgentRunIndicator label="Working…" /></HideWhileGlobalSpinner>);

    expect(screen.getByTestId('agent-run-indicator')).toBeTruthy();
  });

  it('draws nothing while the global full-screen spinner is visible, so there is never a second P underneath it', () => {
    const { container } = render(
      <SpinnerContext.Provider value={{ visible: true, message: 'Redirecting to sign in…' }}>
        <HideWhileGlobalSpinner><AgentRunIndicator label="Working…" /></HideWhileGlobalSpinner>
      </SpinnerContext.Provider>,
    );

    expect(screen.queryByTestId('agent-run-indicator')).toBeNull();
    expect(container.querySelector('.ping-spinner')).toBeNull();
  });

  it('comes back when the global spinner goes away', () => {
    const { rerender } = render(
      <SpinnerContext.Provider value={{ visible: true }}>
        <HideWhileGlobalSpinner><AgentRunIndicator label="Working…" /></HideWhileGlobalSpinner>
      </SpinnerContext.Provider>,
    );
    expect(screen.queryByTestId('agent-run-indicator')).toBeNull();

    rerender(
      <SpinnerContext.Provider value={{ visible: false }}>
        <HideWhileGlobalSpinner><AgentRunIndicator label="Working…" /></HideWhileGlobalSpinner>
      </SpinnerContext.Provider>,
    );
    expect(screen.getByTestId('agent-run-indicator')).toBeTruthy();
  });
});
