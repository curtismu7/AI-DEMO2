// demo_api_ui/src/components/__tests__/AgentFlowDiagramPanel.stepTimeline.test.jsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StepTimeline } from '../AgentFlowDiagramPanel';

const LOGIN_STEPS = [
  { id: 'login-0', title: 'You click "Sign in"', detail: 'd1', status: 'done', actor: 'browser', toActor: 'bff' },
  {
    id: 'login-1',
    title: 'BFF mints PKCE',
    detail: 'd2',
    status: 'done',
    actor: 'bff',
    protocolDetail: [['code_challenge_method', 'S256']],
  },
  { id: 'login-2', title: 'You land back signed in', detail: 'd3', status: 'done', actor: 'bff', toActor: 'browser' },
];

const MCP_STEPS = [
  { id: 'as', title: 'PingOne — Demo User App', detail: 'token in session', status: 'done' },
  { id: 'agent', title: 'Banking Agent', detail: 'calling BFF', status: 'done' },
];

describe('StepTimeline — sequence diagram', () => {
  test('renders one lifeline per actor, in first-appearance order, and one row per step', () => {
    const { container } = render(<StepTimeline steps={LOGIN_STEPS} phase="done" />);

    const headers = container.querySelectorAll('.afd-sequence-header');
    expect(Array.from(headers).map((h) => h.textContent)).toEqual(['Browser', 'BFF']);
    expect(container.querySelectorAll('.afd-sequence-lifeline')).toHaveLength(2);
    expect(container.querySelectorAll('.afd-sequence-row')).toHaveLength(3);
  });

  test('renders no sequence diagram when no step carries actor info (existing MCP-step shape)', () => {
    const { container } = render(<StepTimeline steps={MCP_STEPS} phase="done" />);
    expect(container.querySelector('.afd-sequence')).toBeNull();
  });

  test('clicking a row focuses that step, same as the scrubber', () => {
    render(<StepTimeline steps={LOGIN_STEPS} phase="done" />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'You land back signed in' }));

    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });
});

describe('StepTimeline — protocol detail toggle', () => {
  test('protocol detail is hidden until the toggle is clicked, then shown', () => {
    render(<StepTimeline steps={LOGIN_STEPS} phase="done" />);
    expect(screen.queryByText('code_challenge_method')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show protocol detail/i }));

    expect(screen.getByText('code_challenge_method')).toBeInTheDocument();
    expect(screen.getByText('S256')).toBeInTheDocument();
  });
});

describe('StepTimeline — replay scrubber', () => {
  test('is absent for a single-step or still-running flow', () => {
    render(<StepTimeline steps={[LOGIN_STEPS[0]]} phase="done" />);
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull();

    render(<StepTimeline steps={LOGIN_STEPS} phase="running" />);
    expect(screen.queryAllByRole('button', { name: /^next$/i })).toHaveLength(0);
  });

  test('next/prev move the focused step and update the counter', () => {
    render(<StepTimeline steps={LOGIN_STEPS} phase="done" />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^prev$/i }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  test('play auto-advances and stops itself at the last step', () => {
    vi.useFakeTimers();
    try {
      render(<StepTimeline steps={LOGIN_STEPS} phase="done" />);
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

      act(() => {
        vi.advanceTimersByTime(3000); // more than enough ticks to cross all 3 steps
      });

      expect(screen.getByText('3 / 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument(); // stopped itself, not "Pause"
    } finally {
      vi.useRealTimers();
    }
  });
});
