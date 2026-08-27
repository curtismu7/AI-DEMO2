// demo_api_ui/src/components/__tests__/BulkDecisionPanel.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import BulkDecisionPanel from '../BulkDecisionPanel';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const LIVE_POLICY_RESPONSE = {
  endpoints: [
    { id: 'ep-1', name: 'Transaction Auth', recordRecentRequests: false },
    { id: 'ep-mcp', name: 'MCP First Tool', recordRecentRequests: false },
  ],
  transactionEndpointId: 'ep-1',
  mcpEndpointId: 'ep-mcp',
};

function mockGet() {
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/authorize/pingone-live-policy') {
      return Promise.resolve({ data: LIVE_POLICY_RESPONSE });
    }
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({
        data: { tools: [{ name: 'get_my_accounts' }, { name: 'create_transfer' }] },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

async function renderPanel() {
  render(<BulkDecisionPanel />);
  await waitFor(() => expect(bffAxios.get).toHaveBeenCalledWith('/api/authorize/pingone-live-policy'));
  // Endpoint <select> only appears once the fetch resolves and the loading state clears.
  await screen.findByRole('combobox');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet();
});

test('loads the endpoint list and defaults to the MCP endpoint', async () => {
  await renderPanel();
  const select = screen.getByRole('combobox');
  expect(select.value).toBe('ep-mcp');
  expect(screen.getByRole('option', { name: /Transaction Auth/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /MCP First Tool/ })).toBeInTheDocument();
});

test('picking a bundle populates the JSON tab with that bundle\'s items', async () => {
  await renderPanel();
  fireEvent.click(screen.getByText('Amount ladder'));
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

  const textarea = screen.getByRole('textbox');
  const items = JSON.parse(textarea.value);
  expect(items).toHaveLength(8);
  expect(items[0]).toEqual({ label: '$100', parameters: expect.objectContaining({ Amount: 100 }) });
});

test('Run bulk decision posts the parsed items and renders the Results tab', async () => {
  bffAxios.post.mockResolvedValue({
    data: {
      ok: true,
      correlationId: 'corr-abc',
      summary: { requested: 2, successful: 2, errors: 0 },
      results: [
        { index: 0, label: '$100', decision: 'PERMIT', stepUpRequired: false, hitlRequired: false, consentRequired: false, decisionId: 'd1', elapsedMicroseconds: 500 },
        { index: 1, label: '$50,000', decision: 'DENY', stepUpRequired: false, hitlRequired: false, consentRequired: false, decisionId: 'd2', elapsedMicroseconds: 700 },
      ],
      endpointId: 'ep-mcp',
      pingoneRequest: { method: 'POST', contentType: 'application/vnd.pingidentity.decisionengine.authorize.bulk+json' },
      pingoneResponse: { correlationId: 'corr-abc' },
    },
  });

  await renderPanel();
  fireEvent.click(screen.getByText('Amount ladder'));
  fireEvent.click(screen.getByRole('button', { name: 'Run bulk decision' }));

  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
  const [url, body] = bffAxios.post.mock.calls[0];
  expect(url).toBe('/api/authorize/evaluate-endpoint-bulk');
  expect(body.endpointId).toBe('ep-mcp');
  expect(body.decisionRequests).toHaveLength(8);

  expect(await screen.findByText('corr-abc')).toBeInTheDocument();
  expect(screen.getByText('PERMIT')).toBeInTheDocument();
  expect(screen.getByText('DENY')).toBeInTheDocument();
});

test('Load MCP tools fetches live tools and populates the JSON tab', async () => {
  await renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Load MCP tools/ }));

  await waitFor(() => expect(bffAxios.get).toHaveBeenCalledWith('/api/mcp/inspector/tools'));
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

  const textarea = screen.getByRole('textbox');
  const items = JSON.parse(textarea.value);
  expect(items.map((i) => i.label)).toEqual(['get_my_accounts', 'create_transfer']);
});

test('more than 20 items disables Run with a cap message; invalid JSON also disables Run', async () => {
  await renderPanel();
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  const textarea = screen.getByRole('textbox');

  const tooMany = Array.from({ length: 21 }, (_, i) => ({ parameters: { Amount: i } }));
  fireEvent.change(textarea, { target: { value: JSON.stringify(tooMany) } });
  expect(screen.getByRole('button', { name: 'Run bulk decision' })).toBeDisabled();
  expect(screen.getByText(/exceeds the bulk limit/)).toBeInTheDocument();

  fireEvent.change(textarea, { target: { value: '{not json' } });
  expect(screen.getByRole('button', { name: 'Run bulk decision' })).toBeDisabled();
  expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
});

// Regression guard: a load failure previously left `endpoints` empty with no
// error state set at all, indistinguishable from a tenant with no policy
// configured ("No decision endpoints found" either way).
test('surfaces a message when the live-policy endpoint list fails to load', async () => {
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/authorize/pingone-live-policy') {
      return Promise.reject({ response: { data: { message: 'PingOne unreachable' } } });
    }
    return Promise.resolve({ data: {} });
  });
  render(<BulkDecisionPanel />);

  await waitFor(() => expect(bffAxios.get).toHaveBeenCalledWith('/api/authorize/pingone-live-policy'));
  await screen.findByText('PingOne unreachable');
});
