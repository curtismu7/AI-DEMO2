import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import PrivilegeMcpClientPage from '../PrivilegeMcpClientPage';

const state = {
  config: { mcpUrl: 'https://gateway.example/mcp', clientId: 'client' },
  gatewayMode: 'agentless', gatewayConfigs: { agent: {}, agentless: {} },
  oauth: { authenticated: true, scope: 'openid' }, tools: [], presets: [],
  mcp: { era: 'modern', protocolVersion: '2026-07-28' },
};

beforeEach(() => {
  vi.restoreAllMocks();
  global.EventSource = class { addEventListener() {} close() {} };
  global.fetch = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/state')) return new Response(JSON.stringify(state));
    if (String(url).endsWith('/tools/list')) return new Response(JSON.stringify({ tools: [] }));
    if (String(url).endsWith('/catalog')) return new Response(JSON.stringify({
      prompts: [{ name: 'summarize' }],
      resources: [{ name: 'Guide', uri: 'file:///guide.md' }],
      resourceTemplates: [{ name: 'Docs', uriTemplate: 'docs://{id}' }],
      protocol: {
        era: 'modern', version: '2026-07-28',
        serverInfo: { name: 'Demo MCP', version: '2' }, capabilities: { prompts: {}, resources: {} },
      },
    }));
    if (String(url).endsWith('/request')) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
        resultType: 'input_required', requestState: 'state-1',
        inputRequests: [{ method: 'elicitation/create', params: { mode: 'form', message: 'Name?' } }],
      } }));
    }
    return new Response(JSON.stringify({ ok: true }));
  });
});

test('discovers prompts/resources and supports modern input-required continuation', async () => {
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'MCP Explorer' }));
  expect(await screen.findByText('Demo MCP')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'summarize' })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Guide' }).at(-1));
  fireEvent.click(screen.getByRole('button', { name: 'Send MCP Request' }));
  expect(await screen.findByText('Input Required')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue Request' }));
  await waitFor(() => {
    const calls = global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/request'));
    expect(calls).toHaveLength(2);
    const body = JSON.parse(calls[1][1].body);
    expect(body.params.requestState).toBe('state-1');
    expect(body.params.inputResponses[0]).toEqual({ action: 'accept', content: {} });
  });
});
