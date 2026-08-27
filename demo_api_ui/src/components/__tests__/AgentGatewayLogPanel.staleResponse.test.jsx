// demo_api_ui/src/components/__tests__/AgentGatewayLogPanel.staleResponse.test.jsx
// finding #60: fetchLogs/fetchDecisions had no request sequencing, so an
// older, slower overlapping fetch (a previous filter) could resolve after a
// newer one and silently overwrite the fresher state.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayLogPanel from '../AgentGatewayLogPanel';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/agent-gateway/decisions') {
      return Promise.resolve({ data: { decisions: [] } });
    }
    return new Promise(() => {}); // logs handled per-test
  });
});

test('finding #60: an older filter request does not overwrite a newer one that resolved first', async () => {
  const firstDeferred = deferred();
  const secondDeferred = deferred();
  let call = 0;

  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/agent-gateway/decisions') {
      return Promise.resolve({ data: { decisions: [] } });
    }
    call += 1;
    return call === 1 ? firstDeferred.promise : secondDeferred.promise;
  });

  render(<AgentGatewayLogPanel />);

  const filterInput = await screen.findByPlaceholderText(/P1AZ, DENY/i);

  // First (slow) request: old filter.
  fireEvent.change(filterInput, { target: { value: 'OLD' } });
  fireEvent.keyDown(filterInput, { key: 'Enter' });

  // Second (fast) request: new filter, started before the first resolves.
  fireEvent.change(filterInput, { target: { value: 'NEW' } });
  fireEvent.keyDown(filterInput, { key: 'Enter' });

  // The newer request resolves first.
  secondDeferred.resolve({ data: { ok: true, lines: ['NEW line'] } });
  await waitFor(() => expect(screen.getByText('NEW line')).toBeInTheDocument());

  // The older, slower request resolves after — must NOT overwrite the newer result.
  firstDeferred.resolve({ data: { ok: true, lines: ['OLD line'] } });
  await new Promise((r) => setTimeout(r, 20));

  expect(screen.getByText('NEW line')).toBeInTheDocument();
  expect(screen.queryByText('OLD line')).not.toBeInTheDocument();
});
