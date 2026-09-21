import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../../services/agentBuilderService', () => ({
  fetchState: vi.fn(),
  buildAgent: vi.fn(),
  deleteAgent: vi.fn(),
  upgradeAgent: vi.fn(),
  applyGrants: vi.fn(),
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  listAgents: vi.fn(),
  agentSetup: vi.fn(),
  errorMessage: (err) => err?.message || 'Request failed',
}));
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

import AgentBuilderPage from '../AgentBuilderPage';
import { fetchState, listAgents } from '../../services/agentBuilderService';

beforeEach(() => {
  fetchState.mockResolvedValue({
    user: { username: 'alex', email: 'alex@example.test', sub: 'sub-123' },
    agent: {
      id: 'ping-agent-123', name: 'AI Agent - alex', type: 'AI_AGENT',
      grantTypes: ['CLIENT_CREDENTIALS'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      cimd: {
        mocked: true,
        registrationType: 'cimd-facade',
        status: 'registered',
        metadataUrl: 'http://127.0.0.1:3001/api/cimd/personal-agents/reg-1/client-metadata.json',
        steps: [
          { step: 'fetch', status: 'success', engine: 'mock' },
          { step: 'validate', status: 'success', engine: 'mock' },
          { step: 'register', status: 'success', engine: 'mock' },
        ],
      },
    },
    resources: [],
  });
  listAgents.mockResolvedValue([]);
});

test('shows mocked CIMD registration separately from the real PingOne identity', async () => {
  render(<AgentBuilderPage />);

  expect(await screen.findByText('CIMD registration')).toBeInTheDocument();
  expect(screen.getByText(/Mocked — PingOne does not support CIMD/)).toBeInTheDocument();
  expect(screen.getByText(/PingOne-backed agent identity remains the credential used for RFC 8693/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /client metadata document/i })).toHaveAttribute(
    'href',
    'http://127.0.0.1:3001/api/cimd/personal-agents/reg-1/client-metadata.json',
  );
});

test('shows CIMD failure truthfully without hiding the PingOne agent', async () => {
  fetchState.mockResolvedValueOnce({
    user: { username: 'alex', email: 'alex@example.test', sub: 'sub-123' },
    agent: {
      id: 'ping-agent-123', name: 'AI Agent - alex', type: 'AI_AGENT',
      grantTypes: ['CLIENT_CREDENTIALS'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      cimd: {
        mocked: true,
        registrationType: 'cimd-facade',
        status: 'failed',
        metadataUrl: null,
        steps: [{ step: 'register', status: 'failed', engine: 'mock' }],
      },
    },
    resources: [],
  });

  render(<AgentBuilderPage />);

  expect(await screen.findByText(/CIMD registration failed/i)).toBeInTheDocument();
  expect(screen.getByText(/PingOne-backed agent identity remains/i)).toBeInTheDocument();
  expect(screen.queryByText(/completed the CIMD registration facade/i)).not.toBeInTheDocument();
});
