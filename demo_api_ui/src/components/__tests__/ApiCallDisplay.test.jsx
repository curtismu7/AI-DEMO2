// ApiCallDisplay: the expanded call shows its headers and bodies as the shared JSON pane (Form | JSON, no scroll box),
// and clicking inside the pane must not collapse the row.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApiCallDisplay from '../ApiCallDisplay';

const CALL = {
  id: 'c1',
  method: 'POST',
  url: '/api/demo/rfc8693/token',
  success: true,
  duration: 12,
  timestamp: '2026-11-16T10:00:00Z',
  category: 'token',
  request: { headers: { 'content-type': 'application/json', authorization: 'Bearer abc' }, body: '{"grant_type":"token-exchange","audience":"mcp-olb"}' },
  response: { status: 200, headers: { 'x-trace': 'tr-1' }, body: 'plain text, not json' },
};

let mockCall = CALL;

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, calls: [mockCall], stats: { total: 1, successful: 1, failed: 0, categories: { token: 1 } } } })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

async function openCall() {
  render(<ApiCallDisplay />);
  const row = await screen.findByText('/api/demo/rfc8693/token');
  fireEvent.click(row);
  return document.querySelector('.api-call-details');
}

describe('ApiCallDisplay JSON panes', () => {
  beforeEach(() => {
    // One Form | JSON choice per page, kept in localStorage: a test that picks JSON must not leak it.
    localStorage.clear();
    mockCall = CALL;
  });

  it('shows headers and a JSON body as Form panes, and a non-JSON body as plain text', async () => {
    const details = await openCall();
    expect(within(details).getByRole('group', { name: 'Request headers' }).textContent).toContain('content-type');
    expect(within(details).getByRole('group', { name: 'Request body' }).textContent).toContain('mcp-olb');
    expect(within(details).getByRole('group', { name: 'Response headers' })).toBeInTheDocument();
    // A body that is not JSON stays text (no Form view, no switch of its own).
    const text = details.querySelector('pre[aria-label="Response body"]');
    expect(text).not.toBeNull();
    expect(text.textContent).toBe('plain text, not json');
    expect(within(details).getAllByRole('button', { name: 'JSON' })).toHaveLength(3);
  });

  it('switches to the exact JSON text, and the click does not collapse the row', async () => {
    const details = await openCall();
    fireEvent.click(within(details).getAllByRole('button', { name: 'JSON' })[0]);
    await waitFor(() => expect(details.querySelector('.jp-raw[aria-label="Request headers"]')).not.toBeNull());
    expect(details.querySelector('.jp-raw[aria-label="Request headers"]').textContent).toContain('"content-type": "application/json"');
    expect(document.querySelector('.api-call-details')).not.toBeNull();
  });

  it('paints no alert on a request body, and keeps it on a response body with an error (both views)', async () => {
    mockCall = {
      ...CALL,
      request: { ...CALL.request, body: { reason: 'rent for November', note: 'free text' } },
      response: { status: 400, headers: {}, body: { error: 'invalid_request', error_description: 'Missing audience' } },
    };
    const details = await openCall();
    expect(within(details).getByRole('group', { name: 'Request body' }).querySelector('[data-alert]')).toBeNull();
    expect(within(details).getByRole('group', { name: 'Response body' }).querySelector('[data-alert="true"]')).not.toBeNull();

    fireEvent.click(within(within(details).getByRole('group', { name: 'Request body' }).closest('.jp-box')).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(details.querySelector('pre.jp-raw[aria-label="Request body"]')).not.toBeNull());
    expect(details.querySelector('pre.jp-raw[aria-label="Request body"] .jp-tok--alert')).toBeNull();
    expect(details.querySelector('pre.jp-raw[aria-label="Response body"] .jp-tok--alert')).not.toBeNull();
  });

  it('collapses the row when its summary is clicked again', async () => {
    await openCall();
    fireEvent.click(screen.getByText('/api/demo/rfc8693/token'));
    expect(document.querySelector('.api-call-details')).toBeNull();
  });
});
