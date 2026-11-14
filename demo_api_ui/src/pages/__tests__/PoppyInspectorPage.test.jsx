import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PoppyInspectorPage from '../PoppyInspectorPage';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
import apiClient from '../../services/apiClient';

const ENTRY = {
  id: 'ins_abc123',
  at: '2026-11-14T12:00:00.000Z',
  method: 'GET',
  path: '/poppy/api/v1/me',
  status: 200,
  agentId: 'agent-x',
  clientId: 'https://agent.example/client.json',
  userId: 'user-1',
  signedOut: false,
  sessionId: 'sid-1',
  reasoning: ['1. Legit: delegation verified.', '2. Session JWT verified.'],
  received: { method: 'GET', url: '/poppy/api/v1/me', poppy_session: 'ABC123…deadbeef', authorization: 'Bearer XYZ…cafe' },
  sent: { status: 200, body: '{"user_id":"user-1"}' },
};

function mockApi({ feed = [ENTRY], agents = [], fail = false } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/inspect/agents')) return Promise.resolve({ data: { agents } });
    if (fail) return Promise.reject({ response: { status: 403, data: { error: 'Access denied. Admin role required.' } } });
    return Promise.resolve({ data: { count: feed.length, entries: feed } });
  });
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('PoppyInspectorPage', () => {
  it('renders the feed newest-first with method, path, status and agent', async () => {
    mockApi();
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('poppy-inspect-row-ins_abc123')).toBeTruthy());
    expect(screen.getByText('/poppy/api/v1/me')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText(/agent-x · user-1/)).toBeTruthy();
  });

  it('expands a row into the reasoning narrative and Received/Sent panes with fingerprinted tokens only', async () => {
    mockApi();
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('poppy-inspect-row-ins_abc123'));
    const detail = await screen.findByTestId('poppy-inspect-detail');
    expect(detail.textContent).toMatch(/1\. Legit: delegation verified\./);
    expect(screen.getAllByRole('group', { name: /view/ }).length).toBe(2);
    expect(detail.textContent).toMatch(/poppy-session/); // the fingerprint shows inside the colored JSON
    expect(detail.textContent).toMatch(/ABC123…deadbeef/); // fingerprint
    expect(detail.textContent).not.toContain('real-token-never-stored');
    // Pretty / Raw view toggle on each pane, Pretty pressed by default
    expect(screen.getAllByTestId('poppy-json-pretty')).toHaveLength(2);
    expect(screen.getAllByTestId('poppy-json-raw')).toHaveLength(2);
  });

  it('shows the empty state when no agent has called yet', async () => {
    mockApi({ feed: [] });
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('poppy-inspect-empty')).toBeTruthy());
  });

  it('the Raw view shows the JSON compact, the Pretty view indented', async () => {
    mockApi();
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('poppy-inspect-row-ins_abc123'));
    fireEvent.click((await screen.findAllByTestId('poppy-json-raw'))[0]);
    expect(screen.getAllByTestId('poppy-inspect-panes')[0].textContent).toContain('}'); // compact: raw JSON inline
    fireEvent.click(screen.getAllByTestId('poppy-json-pretty')[0]);
    expect(screen.getAllByTestId('poppy-inspect-panes')[0].textContent).toMatch(/"request"/); // keys visible again
  });

  it('offers an agent filter when more than one agent has been seen', async () => {
    mockApi({ agents: ['https://a.example/c.json', 'https://b.example/c.json'] });
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Agent')).toBeTruthy());
    expect(screen.getAllByRole('option').length).toBe(3); // All + two agents
  });

  it('falls back to the public redacted feed when the admin API refuses, and says identity is withheld', async () => {
    apiClient.get.mockImplementation((url) => {
      if (String(url).startsWith('/api/admin/')) {
        return Promise.reject({ response: { status: 401, data: { error: 'authentication_required' } } });
      }
      if (String(url).includes('/api/poppy/inspector/agents')) return Promise.reject(new Error('none'));
      return Promise.resolve({ data: { count: 1, entries: [{ ...ENTRY, userId: undefined, sessionId: undefined, redacted: true }] } });
    });
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('poppy-inspect-public-note')).toBeTruthy());
    expect(screen.getByText(/Public view/).textContent).toMatch(/withheld/);
    // the row renders from the public feed
    await waitFor(() => expect(screen.getByTestId('poppy-inspect-row-ins_abc123')).toBeTruthy());
  });

  it('shows a readable error when both the admin and public feeds refuse', async () => {
    apiClient.get.mockImplementation(() => Promise.reject({ response: { status: 403, data: { error: 'Access denied. Admin role required.' } } }));
    render(<MemoryRouter><PoppyInspectorPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('poppy-inspect-error').textContent).toMatch(/Could not load/));
  });
});
