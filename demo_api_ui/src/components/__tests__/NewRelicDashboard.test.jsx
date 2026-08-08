import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import NewRelicDashboard from '../NewRelicDashboard';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

function renderDash() {
  return render(<ThemeProvider><NewRelicDashboard /></ThemeProvider>);
}

const PAYLOAD = {
  window: '1h',
  funnel: [
    { category: 'oauth', count: 13 },
    { category: 'mcp', count: 11 },
    { category: 'intent_auth', count: 16 },
  ],
  timeseries: [
    { beginTimeSeconds: 100, count: 0 },
    { beginTimeSeconds: 200, count: 93 },
  ],
  stream: [{
    timestamp: 1786194823914,
    message: 'MCP tool call to get_my_accounts',
    category: 'mcp',
    severity: 'info',
    correlationId: 'a3f1c9e2',
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('NewRelicDashboard', () => {
  it('shows a loading state before the request resolves', () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    renderDash();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('renders pipeline stage counts from the funnel', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toHaveTextContent('13'));
    expect(screen.getByTestId('stage-mcp')).toHaveTextContent('11');
    expect(screen.getByTestId('stage-intent_auth')).toHaveTextContent('16');
  });

  it('shows zero for a pipeline stage absent from the funnel', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // token_exchange is not in PAYLOAD.funnel — it must still render, as 0.
    await waitFor(() => expect(screen.getByTestId('stage-token_exchange')).toHaveTextContent('0'));
  });

  it('renders the event stream with its correlation id', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText(/MCP tool call to get_my_accounts/)).toBeInTheDocument());
    expect(screen.getByText('a3f1c9e2')).toBeInTheDocument();
  });

  it('renders a "warning" severity with the warn class, not the default/info treatment', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        ...PAYLOAD,
        stream: [{
          timestamp: 1786194823914,
          message: 'rate limit approaching',
          category: 'mcp',
          severity: 'warning',
          correlationId: null,
        }],
      },
    });
    renderDash();
    const sev = await screen.findByText('warning');
    expect(sev).toHaveClass('nrd-sev-warning');
    expect(sev).not.toHaveClass('nrd-sev-info');
  });

  it('shows the not-configured state on 503, not a generic error', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 503 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/New Relic is not configured/i)).toBeInTheDocument());
  });

  it('shows an error state on 502', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 502 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/Could not load New Relic data/i)).toBeInTheDocument());
  });

  it('reads as no-traffic, not as an error, when every series is empty', async () => {
    apiClient.get.mockResolvedValue({
      data: { window: '1h', funnel: [], timeseries: [], stream: [] },
    });
    renderDash();
    await waitFor(() => expect(screen.getByText(/No events in this window/i)).toBeInTheDocument());
    expect(screen.queryByText(/Could not load/i)).not.toBeInTheDocument();
  });

  it('toggles the shared app theme, not local state', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toBeInTheDocument());

    const sw = screen.getByRole('switch', { name: /dark mode/i });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    sw.click();
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('requests the window the user selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    screen.getByRole('button', { name: '24h' }).click();
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenLastCalledWith('/api/newrelic/pipeline?window=24h'));
  });
});
