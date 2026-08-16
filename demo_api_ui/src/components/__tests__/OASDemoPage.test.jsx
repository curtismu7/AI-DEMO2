// demo_api_ui/src/components/__tests__/OASDemoPage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OASDemoPage from '../OASDemoPage';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../../services/apiClient';

const SPEC = {
  openapi: '3.1.0',
  info: { title: 'PingOne Platform API (Demo Fragment)', version: '2024.1.0', description: 'Mock.' },
  paths: {
    '/v1/environments/{environmentId}/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users in an environment',
        tags: ['Users'],
        'x-permission': 'Identity Admin',
        parameters: [
          { name: 'environmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
  },
};

function renderPage(user) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(SPEC) }));
  return render(
    <MemoryRouter>
      <OASDemoPage user={user} />
    </MemoryRouter>
  );
}

async function expandListUsersRow() {
  await screen.findByText('List users in an environment');
  fireEvent.click(screen.getByText('List users in an environment'));
}

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.post.mockReset();
});

describe('OASDemoPage — Try it out', () => {
  it('shows a sign-in prompt and never fetches PingOne tools when signed out', async () => {
    renderPage(null);
    await expandListUsersRow();

    expect(screen.getByText('Sign in to try this')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders a param form seeded from the real hosted tool schema and executes via pingone-invoke', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        enabled: true,
        tools: [
          {
            name: 'listUsers',
            inputSchema: { type: 'object', properties: { environmentId: { type: 'string' }, limit: { type: 'integer' } }, required: ['environmentId'] },
          },
        ],
        paramDefaults: { environmentId: 'env-123' },
      },
    });
    apiClient.post.mockResolvedValue({ data: { users: [{ username: 'curt' }] } });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    const envInput = await screen.findByDisplayValue('env-123');
    expect(envInput).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try it out' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/mcp/inspector/pingone-invoke', {
      tool: 'listUsers',
      params: { environmentId: 'env-123' },
    }));
    await waitFor(() => expect(screen.getByText(/"curt"/)).toBeInTheDocument());
  });

  it('shows an unavailable message when the hosted tool list has no matching operation', async () => {
    apiClient.get.mockResolvedValue({ data: { enabled: true, tools: [], paramDefaults: {} } });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    await screen.findByText('Not available via the hosted PingOne MCP server in this demo.');
  });

  it('shows the server-provided reason when live querying is off', async () => {
    apiClient.get.mockResolvedValue({
      data: { enabled: false, tools: [], reason: 'Live querying is turned off for this page.' },
    });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    await screen.findByText('Live querying is turned off for this page.');
  });
});
