// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.hitlHold.test.jsx
// A governed tool call can come back HELD for human approval (Privilege HITL
// policy, verified live 2026-10-13 on the opensearch-hitl door: the gateway
// answers the tools/call with a pending_approval hold carrying an instruction
// id, and the call proceeds only after someone approves and the client
// retries). The RESULTS panel must say that in human terms — not show the raw
// hold JSON as if it were tool output — and offer the Retry that passes once
// the approval exists.
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

// The gateway's hold shape: a 200 JSON-RPC result that is not tool output —
// it announces the hold. Fields seen live in the v1.261009 binary: a
// pending_approval status, the ins_… instruction id, and the tool name.
const HOLD_RESPONSE = {
  jsonrpc: '2.0', id: 3,
  result: {
    status: 'pending_approval',
    instruction_id: 'ins_6f2753c112b468ee8aff029b5f78273e',
    target: 'SearchIndexTool',
  },
};

const SEARCH_TOOL = {
  name: 'SearchIndexTool',
  description: 'Searches an index using a query written in DSL.',
  inputSchema: {
    type: 'object',
    properties: {
      index: { type: 'string', description: 'The index to search' },
      query_dsl: { type: 'object', description: 'The search query' },
    },
    required: ['index', 'query_dsl'],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  global.EventSource = class { addEventListener() {} close() {} };
  global.fetch = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/state')) return new Response(JSON.stringify(state));
    if (String(url).endsWith('/tools/list')) return new Response(JSON.stringify({ tools: [SEARCH_TOOL] }));
    if (String(url).endsWith('/catalog')) return new Response(JSON.stringify({
      prompts: [], resources: [], resourceTemplates: [],
      protocol: {
        era: 'modern', version: '2026-07-28',
        serverInfo: { name: 'opensearch-mcp-server', version: '' }, capabilities: { tools: {} },
      },
    }));
    if (String(url).endsWith('/tools/call')) {
      const body = JSON.parse(options.body || '{}');
      if (body.name === 'SearchIndexTool') {
        return new Response(JSON.stringify(HOLD_RESPONSE));
      }
    }
    return new Response(JSON.stringify({ ok: true }));
  });
});

test('a held tool call renders a waiting-for-approval card with the instruction id and a retry', async () => {
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  // Tools tab is the point of the page once tools exist.
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));

  // Run the SearchIndexTool row → the BFF relays the gateway's hold.
  const runButtons = await screen.findAllByRole('button', { name: /run/i });
  fireEvent.click(runButtons[0]);

  // The hold is announced in human terms, with the instruction id to approve,
  // not shown as if the search had returned data.
  expect(await screen.findByText(/waiting for human approval/i)).toBeInTheDocument();
  expect(screen.getAllByText(/ins_6f2753c112b468ee8aff029b5f78273e/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Access Request Approvals/i)).toBeInTheDocument();
  // And the raw hold JSON is still available — operators may need it.
  expect(screen.getAllByText(/pending_approval/).length).toBeGreaterThan(0);

  // Retry re-issues the identical call (same tool + arguments as the first).
  const firstCall = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/tools/call')).at(-1);
  fireEvent.click(screen.getByRole('button', { name: /retry after approval/i }));
  await waitFor(() => {
    const calls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/tools/call'));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.at(-1)[1].body).toBe(firstCall[1].body);
  });
});

test('a normal tool result does not render the hold card', async () => {
  global.fetch = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/state')) return new Response(JSON.stringify(state));
    if (String(url).endsWith('/tools/list')) return new Response(JSON.stringify({ tools: [SEARCH_TOOL] }));
    if (String(url).endsWith('/catalog')) return new Response(JSON.stringify({
      prompts: [], resources: [], resourceTemplates: [],
      protocol: { era: 'modern', version: '2026-07-28', serverInfo: { name: 'x', version: '' }, capabilities: { tools: {} } },
    }));
    if (String(url).endsWith('/tools/call')) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'Search results from gateway-events: 268 hits' }], resultType: 'complete' } }));
    }
    return new Response(JSON.stringify({ ok: true }));
  });

  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));
  const runButtons = await screen.findAllByRole('button', { name: /run/i });
  fireEvent.click(runButtons[0]);

  await screen.findAllByText(/Search results from gateway-events/);
  expect(screen.queryByText(/waiting for human approval/i)).not.toBeInTheDocument();
});
