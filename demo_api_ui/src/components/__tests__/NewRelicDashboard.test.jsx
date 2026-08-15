import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    { category: 'threshold', count: 4 },
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
    await waitFor(() => expect(screen.getByTestId('stat-oauth')).toHaveTextContent('13'));
    expect(screen.getByTestId('stat-mcp')).toHaveTextContent('11');
    expect(screen.getByTestId('stat-intent_auth')).toHaveTextContent('16');
  });

  it('shows zero for a pipeline stage absent from the funnel', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // token_exchange is not in PAYLOAD.funnel — it must still render, as 0.
    await waitFor(() => expect(screen.getByTestId('stat-token_exchange')).toHaveTextContent('0'));
  });

  it('shows every funnel category in "By category", including ones the pipeline strip does not call out', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // "threshold" is not one of the 5 pipeline stages but is in PAYLOAD.funnel —
    // the whole point of the panel is to not silently discard it.
    await waitFor(() => expect(screen.getByTestId('stat-cat-threshold')).toHaveTextContent('4'));
    expect(screen.getByTestId('stat-cat-oauth')).toHaveTextContent('13');
    expect(screen.getByTestId('stat-cat-mcp')).toHaveTextContent('11');
    expect(screen.getByTestId('stat-cat-intent_auth')).toHaveTextContent('16');
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
    // Message text is DashboardShell's — it has no per-page override, and
    // it's the same shared "ready" state gate used by every dashboard.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Could not load data/i));
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
    await waitFor(() => expect(screen.getByTestId('stat-oauth')).toBeInTheDocument());

    const sw = screen.getByRole('switch', { name: /dark mode/i });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(sw);
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('requests the window the user selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenLastCalledWith('/api/newrelic/pipeline?window=24h'));
  });

  describe('search', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('typing filters: after the debounce settles, the request carries q', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'PingOne' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/pipeline?window=1h&q=PingOne'));
    });

    it('debounces: several keystrokes before the request fires only send one extra request', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
      const callsBeforeTyping = apiClient.get.mock.calls.length;

      const input = screen.getByLabelText('Search events');
      fireEvent.change(input, { target: { value: 'P' } });
      fireEvent.change(input, { target: { value: 'Pi' } });
      fireEvent.change(input, { target: { value: 'Ping' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });

      // Only the settled value produces a fetch — not one per keystroke.
      await waitFor(() =>
        expect(apiClient.get.mock.calls.length).toBe(callsBeforeTyping + 1));
      expect(apiClient.get).toHaveBeenLastCalledWith('/api/newrelic/pipeline?window=1h&q=Ping');
    });

    it('clearing restores the unsearched request', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'PingOne' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/pipeline?window=1h&q=PingOne'));

      fireEvent.click(screen.getByLabelText('Clear search'));
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/pipeline?window=1h'));
    });

    it('shows a distinct "no matches" message for a search that returns nothing, not the generic no-traffic message', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: 'zzz-does-not-exist', stream: [] },
      });
      renderDash();
      await waitFor(() =>
        expect(screen.getByText('No events match "zzz-does-not-exist".')).toBeInTheDocument());
      expect(screen.queryByText(/No events in this window\. Run a use case/i)).not.toBeInTheDocument();
    });

    it('shows the generic empty-stream message (not a "no matches" message) when there is no active search', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: '', stream: [] },
      });
      renderDash();
      await waitFor(() => expect(screen.getByText(/No events in this window\./i)).toBeInTheDocument());
      expect(screen.queryByText(/No events match/i)).not.toBeInTheDocument();
    });
  });
});

// jsdom does not apply real stylesheets, so this is a static check on the CSS
// source. It guards a shipped bug: .nrd set `color` for dark mode but no
// `background`, so the title and subtitle — the only text sitting bare on the
// page rather than inside a card — rendered near-white on the app shell's
// light ground and were unreadable in dark mode.
describe('NewRelicDashboard.css dark-mode ground', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '../NewRelicDashboard.css'),
    'utf8',
  );

  const baseBlock = css.slice(css.indexOf('.nrd {'), css.indexOf('}', css.indexOf('.nrd {')));
  const darkBlock = css.slice(
    css.indexOf(':root[data-theme="dark"] .nrd {'),
    css.indexOf('}', css.indexOf(':root[data-theme="dark"] .nrd {')),
  );

  it('paints its own background rather than inheriting the shell', () => {
    expect(baseBlock).toMatch(/background:\s*var\(--nrd-ground\)/);
  });

  it('defines --nrd-ground in both themes', () => {
    expect(baseBlock).toMatch(/--nrd-ground:\s*#[0-9a-f]{3,8}/i);
    expect(darkBlock).toMatch(/--nrd-ground:\s*#[0-9a-f]{3,8}/i);
  });

  it('gives light and dark different grounds', () => {
    const light = baseBlock.match(/--nrd-ground:\s*(#[0-9a-f]{3,8})/i)[1].toLowerCase();
    const dark = darkBlock.match(/--nrd-ground:\s*(#[0-9a-f]{3,8})/i)[1].toLowerCase();
    expect(light).not.toBe(dark);
  });
});
