// demo_api_ui/src/pages/__tests__/LoginFlowDiagramPage.test.jsx
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { agentFlowDiagram } from '../../services/agentFlowDiagramService';
import LoginFlowDiagramPage from '../LoginFlowDiagramPage';

test('shows a prompt when no login has been recorded this session', () => {
  agentFlowDiagram.setState({ toolName: null, steps: [] });

  render(<LoginFlowDiagramPage />);

  expect(screen.getByText(/no login recorded yet/i)).toBeInTheDocument();
});

test('renders the recorded sequence once a login trace exists', () => {
  agentFlowDiagram.showLoginFlow([
    { title: 'You click "Sign in"', detail: 'd1', actor: 'browser', toActor: 'bff' },
  ]);

  render(<LoginFlowDiagramPage />);

  expect(screen.getByText('You click "Sign in"')).toBeInTheDocument();
  expect(screen.queryByText(/no login recorded yet/i)).toBeNull();
});
