// demo_api_ui/src/components/__tests__/OASDemoPage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OASDemoPage from '../OASDemoPage';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../../services/apiClient';
import { flushEffects } from '../../test-utils/flushEffects';

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
  // The JSON button saves a page-wide choice; keep one test from leaking it into the next.
  localStorage.clear();
});

describe('OASDemoPage — Try it out', () => {
  it('renders the shared Exploring hero, not the hand-rolled header', () => {
    renderPage(null);
    const hero = document.querySelector('.hero-section');
    expect(hero).not.toBeNull(); // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector('.oas-demo-header')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'PingOne API Security Contract' })).toBeInTheDocument();
  });

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
    // The result is a shared pane: Form view by default, named by the operation.
    const result = await screen.findByRole('group', { name: 'listUsers result' });
    expect(result).toHaveTextContent('curt');
    expect(result).toHaveTextContent('username');

    // JSON view shows the exact pretty-printed result, and the pane does not scroll.
    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(result.closest('.oas-tryitout-result')).getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('.oas-tryitout-result pre.jp-raw');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify({ users: [{ username: 'curt' }] }, null, 2));
    expect(raw).toHaveAttribute('aria-label', 'listUsers result');
  });

  it('blocks execution and shows a required-field error without calling pingone-invoke', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        enabled: true,
        tools: [
          {
            name: 'listUsers',
            inputSchema: { type: 'object', properties: { environmentId: { type: 'string' } }, required: ['environmentId'] },
          },
        ],
        paramDefaults: {},
      },
    });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    fireEvent.click(screen.getByRole('button', { name: 'Try it out' }));

    await screen.findByText('Required: environmentId');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows a styled error and no result when the backend returns a 200 error:true tool-call failure', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        enabled: true,
        tools: [
          {
            name: 'listUsers',
            inputSchema: { type: 'object', properties: { environmentId: { type: 'string' } }, required: ['environmentId'] },
          },
        ],
        paramDefaults: { environmentId: 'env-123' },
      },
    });
    apiClient.post.mockResolvedValue({
      data: { enabled: true, error: true, reason: 'tools/call failed: environment not found' },
    });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    fireEvent.click(screen.getByRole('button', { name: 'Try it out' }));

    await screen.findByText('tools/call failed: environment not found');
  });

  it('unwraps response.result instead of dumping the full envelope on success', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        enabled: true,
        tools: [
          {
            name: 'listUsers',
            inputSchema: { type: 'object', properties: { environmentId: { type: 'string' } }, required: ['environmentId'] },
          },
        ],
        paramDefaults: { environmentId: 'env-123' },
      },
    });
    apiClient.post.mockResolvedValue({
      data: {
        enabled: true,
        request: { jsonrpc: '2.0', id: 1, method: 'tools/call' },
        response: { jsonrpc: '2.0', id: 1, result: { users: [{ username: 'curt' }] } },
      },
    });

    renderPage({ id: 'u1' });
    await expandListUsersRow();

    fireEvent.click(screen.getByRole('button', { name: 'Try it out' }));

    const result = await screen.findByRole('group', { name: 'listUsers result' });
    expect(result).toHaveTextContent('curt');
    // Only the unwrapped result is shown: none of the envelope's keys appear in the pane.
    expect(result).not.toHaveTextContent('jsonrpc');
    expect(result).not.toHaveTextContent('tools/call');
  });

  it('shows the raw OAS spec as a pane (Form by default, the exact JSON on request) behind the toggle', async () => {
    renderPage(null);
    await screen.findByText('List users in an environment');
    expect(screen.queryByRole('group', { name: 'Raw OAS spec' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View Raw OAS Spec/ }));
    const form = screen.getByRole('group', { name: 'Raw OAS spec' });
    expect(form).toHaveTextContent('PingOne Platform API (Demo Fragment)');
    expect(form).toHaveTextContent('listUsers');

    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="Raw OAS spec"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify(SPEC, null, 2));

    fireEvent.click(screen.getByRole('button', { name: /Hide Raw OAS Spec/ }));
    expect(document.querySelector('pre.jp-raw[aria-label="Raw OAS spec"]')).toBeNull();
  });

  it('paints no alert on schema text in the raw spec (a property named reason or error), in both views', async () => {
    const spec = {
      ...SPEC,
      components: { schemas: { Refusal: { type: 'object', properties: { error: { type: 'string', description: 'Why' }, reason: 'free text', decision: 'deny' } } } },
    };
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(spec) }));
    render(<MemoryRouter><OASDemoPage user={null} /></MemoryRouter>);
    await screen.findByText('List users in an environment');
    fireEvent.click(screen.getByRole('button', { name: /View Raw OAS Spec/ }));
    const form = screen.getByRole('group', { name: 'Raw OAS spec' });
    expect(form).toHaveTextContent('Refusal');
    expect(form.querySelector('[data-alert]')).toBeNull();

    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="Raw OAS spec"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.querySelector('.jp-tok--alert')).toBeNull();
  });

  it('keeps the alert default on a live tool result that carries an error (both views)', async () => {
    apiClient.get.mockResolvedValue({
      data: { enabled: true, tools: [{ name: 'listUsers', inputSchema: { type: 'object', properties: { environmentId: { type: 'string' } }, required: ['environmentId'] } }], paramDefaults: { environmentId: 'env-123' } },
    });
    apiClient.post.mockResolvedValue({ data: { response: { result: { error: 'forbidden', error_description: 'Missing scope' } } } });
    renderPage({ id: 'u1' });
    await expandListUsersRow();
    await screen.findByDisplayValue('env-123');
    fireEvent.click(screen.getByRole('button', { name: 'Try it out' }));
    const result = await screen.findByRole('group', { name: 'listUsers result' });
    expect(result.querySelector('[data-alert="true"]')).not.toBeNull();
    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(result.closest('.oas-tryitout-result')).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(document.querySelector('.oas-tryitout-result pre.jp-raw')).not.toBeNull());
    expect(document.querySelector('.oas-tryitout-result pre.jp-raw .jp-tok--alert')).not.toBeNull();
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
