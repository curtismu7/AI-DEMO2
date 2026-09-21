// demo_api_ui/src/pages/__tests__/LoginFlowDiagramPage.test.jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, test, expect } from 'vitest';
import { agentFlowDiagram } from '../../services/agentFlowDiagramService';
import LoginFlowDiagramPage from '../LoginFlowDiagramPage';

const loginStep = {
  title: 'You click "Sign in"',
  detail: 'The browser starts the authorization-code flow.',
  actor: 'browser',
  toActor: 'bff',
};

beforeEach(() => {
  sessionStorage.clear();
  agentFlowDiagram.setState({ toolName: null, steps: [] });
});

test('shows a blank evidence panel on initial load even when a trace is in memory', () => {
  agentFlowDiagram.showLoginFlow([loginStep]);

  render(<LoginFlowDiagramPage />);

  expect(screen.getByText(/no login recorded yet/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refresh login trace/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /clear login trace/i })).toBeInTheDocument();
});

test('shows the complete identity journey map', () => {
  agentFlowDiagram.setState({ toolName: null, steps: [] });

  render(<LoginFlowDiagramPage />);

  expect(screen.getByRole('region', { name: /identity journey map/i })).toBeInTheDocument();
  expect(screen.getByText('Registration')).toBeInTheDocument();
  expect(screen.getByText('Authentication')).toBeInTheDocument();
  expect(screen.getByText('MFA step-up')).toBeInTheDocument();
  expect(screen.getByText('Recovery')).toBeInTheDocument();
  expect(screen.getByText('Session complete')).toBeInTheDocument();
});

test('renders the recorded sequence once a login trace exists', () => {
  sessionStorage.setItem('identity-journey:last-login-trace', JSON.stringify({
    phase: 'done',
    steps: [loginStep],
  }));

  render(<LoginFlowDiagramPage />);
  fireEvent.click(screen.getByRole('button', { name: /refresh login trace/i }));

  expect(screen.getByText('You click "Sign in"')).toBeInTheDocument();
  expect(screen.queryByText(/no login recorded yet/i)).toBeNull();
});

test('clear hides the live trace while refresh restores the last captured trace', () => {
  sessionStorage.setItem('identity-journey:last-login-trace', JSON.stringify({
    phase: 'done',
    steps: [loginStep],
  }));

  render(<LoginFlowDiagramPage />);
  fireEvent.click(screen.getByRole('button', { name: /refresh login trace/i }));
  expect(screen.getByText('You click "Sign in"')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /clear login trace/i }));
  expect(screen.getByText(/no login recorded yet/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /refresh login trace/i }));
  expect(screen.getByText('You click "Sign in"')).toBeInTheDocument();
});
