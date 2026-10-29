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
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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

// Run is disabled until the required arguments are filled in, so type them before pressing it.
const ARGS = JSON.stringify({ index: 'gateway-events', query_dsl: { query: { match_all: {} } } });
function runSearch() {
  fireEvent.change(screen.getByLabelText(/arguments \(json\)/i), { target: { value: ARGS } });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
}

afterEach(() => { state.config.mcpUrl = 'https://gateway.example/mcp'; });

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
  await screen.findByRole('button', { name: 'Run' });
  runSearch();

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
  await screen.findByRole('button', { name: 'Run' });
  runSearch();

  await screen.findAllByText(/Search results from gateway-events/);
  expect(screen.queryByText(/waiting for human approval/i)).not.toBeInTheDocument();
});

test('the result has a Copy button that puts the raw JSON on the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));
  await screen.findByRole('button', { name: 'Run' });
  runSearch();
  await screen.findByText(/waiting for human approval/i);

  fireEvent.click(screen.getAllByRole('button', { name: 'JSON' })[0]);
  fireEvent.click(screen.getByRole('button', { name: /copy SearchIndexTool result view as json/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(HOLD_RESPONSE);
});

// A policy that holds a tool is announced before anyone runs it, and the hold can be walked through in a popup.
const HITL_DOOR = 'https://mcpgw.example/opensearch-hitl/mcp';

test('on the HITL door the held tool is badged and says why before it is run', async () => {
  state.config.mcpUrl = HITL_DOOR;
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));

  expect(await screen.findByRole('tab', { name: /SearchIndexTool.*HITL/ })).toBeInTheDocument();
  expect(screen.getByTestId('hitl-tool-note')).toHaveTextContent(/hitl-opensearch/);
});

test('the simulated approver opens from a hold, retries, and admits Privilege still has it pending', async () => {
  state.config.mcpUrl = HITL_DOOR;
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));
  await screen.findByRole('button', { name: 'Run' });
  runSearch();

  fireEvent.click(await screen.findByRole('button', { name: /review approval/i }));
  expect(await screen.findByText(/approver — simulated/i)).toBeInTheDocument();
  const callsBefore = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/tools/call')).length;
  fireEvent.click(screen.getByRole('button', { name: /approve and retry/i }));

  await waitFor(() => expect(global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/tools/call')).length).toBe(callsBefore + 1));
  expect(await screen.findByText(/the popup is a stand-in/i)).toBeInTheDocument();
});

test('SearchIndexTool opens with arguments that can run, so Run works on the first click', async () => {
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));
  const box = await screen.findByLabelText(/arguments \(json\)/i);
  expect(JSON.parse(box.value)).toEqual({ index: '_all', query_dsl: { query: { match_all: {} } } });
  expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
});

test('a hold announced as a JSON-RPC error still shows the waiting-for-approval card', async () => {
  const base = global.fetch;
  global.fetch = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/tools/call')) {
      return new Response(JSON.stringify({ error: 'MCP RPC error: action requires human approval' }), { status: 502 });
    }
    return base(url, options);
  });
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Get MCP Tools' }));
  fireEvent.click(await screen.findByRole('tab', { name: /tools/i }));
  await screen.findByRole('button', { name: 'Run' });
  runSearch();
  expect(await screen.findByText(/waiting for human approval/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry after approval/i })).toBeInTheDocument();
});
