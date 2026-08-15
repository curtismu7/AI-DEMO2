import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import TokenExchangeDashboard from '../TokenExchangeDashboard';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

const PAYLOAD = {
  view: 'tokenexchange',
  window: '24h',
  outcomes: [{ tag: 'token-exchange/ok', count: 7 }, { tag: 'token-exchange/fail', count: 1 }],
  attempts: [{ count: 8 }],
  delegation: [{ hasActorToken: true, count: 12 }, { hasActorToken: false, count: 4 }],
  variants: [{ exchangeVariant: 'exchange-as', count: 14 }, { exchangeVariant: 'subject', count: 2 }],
  timeseries: [{ beginTimeSeconds: 1, count: 0 }, { beginTimeSeconds: 2, count: 3 }],
  stream: [
    {
      timestamp: 1786240000000, tag: 'token-exchange/ok', exchangeVariant: 'exchange-as',
      audience: 'agentgateway.ping.demo', scope: 'agent:invoke read', exchangeClientId: 'f4dd707d-aaaa-bbbb-cccc-000000000001',
      hasActorToken: true, subjectTokenType: 'access_token', latencyMs: 122,
    },
    {
      timestamp: 1786243600000, tag: 'token-exchange/fail', exchangeVariant: 'subject',
      audience: 'mcpgateway.ping.demo', scope: 'read', exchangeClientId: '71e878ea-aaaa-bbbb-cccc-000000000002',
      hasActorToken: false, subjectTokenType: 'access_token', latencyMs: null,
      httpStatus: 403, pingoneError: 'invalid_grant',
    },
  ],
};

function renderDash() {
  return render(<ThemeProvider><TokenExchangeDashboard /></ThemeProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('TokenExchangeDashboard', () => {
  it('defaults to the 24h window, not 1h', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/newrelic/view/tokenexchange?window=24h'));
  });

  it('renders ok and fail counts from the outcomes facet', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-ok')).toHaveTextContent('7'));
    expect(screen.getByTestId('stat-fail')).toHaveTextContent('1');
  });

  it('shows unsettled only when attempts exceed ok+fail', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-ok')).toBeInTheDocument());
    // PAYLOAD: attempts 8, ok 7 + fail 1 = 8 → fully settled, no unsettled stat.
    expect(screen.queryByTestId('stat-unsettled')).not.toBeInTheDocument();
  });

  it('renders the unsettled stat when attempts exceed ok+fail', async () => {
    apiClient.get.mockResolvedValue({
      data: { ...PAYLOAD, attempts: [{ count: 10 }] },
    });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-unsettled')).toHaveTextContent('2'));
  });

  it('renders delegation counts from hasActorToken', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-nested-act')).toHaveTextContent('12'));
    expect(screen.getByTestId('stat-no-actor-token')).toHaveTextContent('4');
  });

  it('renders every fixed variant including ones absent from the payload', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-exchange-as')).toHaveTextContent('14'));
    expect(screen.getByTestId('stat-subject')).toHaveTextContent('2');
    // 'id-token' never fires in PAYLOAD — it must still render, as 0.
    expect(screen.getByTestId('stat-id-token')).toHaveTextContent('0');
  });

  it('derives the audience and client breakdowns from the stream', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-agentgateway.ping.demo')).toHaveTextContent('1'));
    expect(screen.getByTestId('stat-mcpgateway.ping.demo')).toHaveTextContent('1');
  });

  it('computes avg/max latency from ok rows only', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // Only one `ok` row in PAYLOAD (latencyMs 122); the fail row's null
    // latency must not be averaged in.
    await waitFor(() => expect(screen.getByTestId('stat-avg-latency')).toHaveTextContent('122'));
    expect(screen.getByTestId('stat-max-latency')).toHaveTextContent('122');
  });

  it('truncates a client id in the stream table but keeps the full value in title', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // The "By client" StatStrip above also renders a truncated label with
    // the same visible text, so scope the assertion to the title attribute
    // the table cell (and only the table cell) carries.
    await waitFor(() => expect(
      screen.getByTitle('f4dd707d-aaaa-bbbb-cccc-000000000001'),
    ).toHaveTextContent('f4dd707d…'));
  });

  it('shows status and pingoneError only for the failed row', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText('invalid_grant')).toBeInTheDocument());
    expect(screen.getByText('403')).toBeInTheDocument();
  });

  it('shows the not-configured state on 503, not a generic error', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 503 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/NR_USER_API_KEY/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error state on 502', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 502 } });
    renderDash();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('requests the window the user selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/newrelic/view/tokenexchange?window=7d'));
  });

  it('requests the 14d window when selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '14d' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/newrelic/view/tokenexchange?window=14d'));
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

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'agentgateway' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/tokenexchange?window=24h&q=agentgateway'));
    });

    it('clearing restores the unsearched request', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'agentgateway' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/tokenexchange?window=24h&q=agentgateway'));

      fireEvent.click(screen.getByLabelText('Clear search'));
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/tokenexchange?window=24h'));
    });

    it('shows a distinct "no matches" message for a search that returns nothing, not the generic empty-stream message', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: 'zzz-no-match', stream: [] },
      });
      renderDash();
      await waitFor(() =>
        expect(screen.getByText('No exchanges match "zzz-no-match".')).toBeInTheDocument());
      expect(screen.queryByText(/RFC 8693 telemetry is new/i)).not.toBeInTheDocument();
    });

    it('shows the sparse-telemetry empty message (not a "no matches" message) when there is no active search', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: '', stream: [] },
      });
      renderDash();
      await waitFor(() => expect(screen.getByText(/RFC 8693 telemetry is new/i)).toBeInTheDocument());
      expect(screen.queryByText(/No exchanges match/i)).not.toBeInTheDocument();
    });
  });
});
