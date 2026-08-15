import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import P1AzDashboard from '../P1AzDashboard';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

const PAYLOAD = {
  view: 'authorize',
  window: '24h',
  decisions: [{ decision: 'PERMIT', count: 1 }, { decision: 'DENY', count: 2 }],
  posture: [
    { tag: 'authorize/permit', count: 1 },
    { tag: 'authorize/deny', count: 2 },
    { tag: 'authorize/fail-open', count: 3 },
  ],
  // NRQL omits rows for records missing ruleName entirely rather than
  // emitting a null facet bucket, so the rules facet only ever carries
  // attributed decisions — see P1AzDashboard.jsx's unattributed remainder.
  rules: [
    { ruleName: 'Transaction Denied', count: 2 },
    { ruleName: 'Transaction Approved', count: 1 },
  ],
  timeseries: [{ beginTimeSeconds: 1, count: 0 }, { beginTimeSeconds: 2, count: 3 }],
  stream: [{
    timestamp: 1786240000000, tag: 'authorize/deny', decision: 'DENY',
    ruleName: 'Transaction Denied', amount: 60000, stepUpRequired: false,
    type: 'transfer', engine: 'pingone', latencyMs: 42, policyEvalMs: 2.885,
  }, {
    timestamp: 1786243600000, tag: 'authorize/deny', decision: 'DENY',
    ruleName: null, amount: 1500, stepUpRequired: false,
    type: 'transfer', engine: 'pingone', latencyMs: 12, policyEvalMs: 1.2,
  }],
};

function renderDash() {
  return render(<ThemeProvider><P1AzDashboard /></ThemeProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('P1AzDashboard', () => {
  it('defaults to the 24h window, not 1h', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/newrelic/view/authorize?window=24h'));
  });

  it('renders PERMIT and DENY counts from the decisions facet', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-PERMIT')).toHaveTextContent('1'));
    expect(screen.getByTestId('stat-DENY')).toHaveTextContent('2');
  });

  it('renders every posture stat including ones absent from the payload', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-fail-open')).toHaveTextContent('3'));
    // failover is not in PAYLOAD.posture — it must still render, as 0
    expect(screen.getByTestId('stat-failover')).toHaveTextContent('0');
  });

  it('renders the decision stream with amount, rule and both latencies', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText('60000')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('2.885')).toBeInTheDocument();
  });

  it('falls back to an em dash in the stream when a row has no rule attribution', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText('1500')).toBeInTheDocument());
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('names which rule fired, and derives the unattributed remainder rather than hiding it', async () => {
    // NRQL never returns a null-ruleName facet row — the rules query only
    // carries attributed decisions. The unattributed count is derived as
    // totalDecisions (10) minus the attributed sum (2 + 1 = 3).
    apiClient.get.mockResolvedValue({ data: {
      ...PAYLOAD,
      decisions: [{ decision: 'PERMIT', count: 8 }, { decision: 'DENY', count: 2 }],
    } });
    renderDash();
    await waitFor(() =>
      expect(screen.getByTestId('stat-Transaction Denied')).toHaveTextContent('2'));
    expect(screen.getByTestId('stat-Transaction Approved')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-unattributed')).toHaveTextContent('7');
  });

  it('says so when no rule attribution exists in the window', async () => {
    apiClient.get.mockResolvedValue({ data: { ...PAYLOAD, decisions: [], rules: [] } });
    renderDash();
    await waitFor(() =>
      expect(screen.getByText(/No rule attribution in this window/i)).toBeInTheDocument());
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
      '/api/newrelic/view/authorize?window=7d'));
  });

  it('requests the 14d window when selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '14d' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/newrelic/view/authorize?window=14d'));
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

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'Wire Fraud' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/authorize?window=24h&q=Wire%20Fraud'));
    });

    it('debounces: several keystrokes before the request fires only send one extra request', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
      const callsBeforeTyping = apiClient.get.mock.calls.length;

      const input = screen.getByLabelText('Search events');
      fireEvent.change(input, { target: { value: 'D' } });
      fireEvent.change(input, { target: { value: 'DE' } });
      fireEvent.change(input, { target: { value: 'DENY' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });

      await waitFor(() =>
        expect(apiClient.get.mock.calls.length).toBe(callsBeforeTyping + 1));
      expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/authorize?window=24h&q=DENY');
    });

    it('clearing restores the unsearched request', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      apiClient.get.mockResolvedValue({ data: PAYLOAD });
      renderDash();
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'DENY' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/authorize?window=24h&q=DENY'));

      fireEvent.click(screen.getByLabelText('Clear search'));
      await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
        '/api/newrelic/view/authorize?window=24h'));
    });

    it('shows a distinct "no matches" message for a search that returns nothing, not the generic empty-stream message', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: 'zzz-no-match', stream: [] },
      });
      renderDash();
      await waitFor(() =>
        expect(screen.getByText('No decisions match "zzz-no-match".')).toBeInTheDocument());
      expect(screen.queryByText(/^No events in this window\.$/i)).not.toBeInTheDocument();
    });

    it('shows the generic empty-stream message (not a "no matches" message) when there is no active search', async () => {
      apiClient.get.mockResolvedValue({
        data: { ...PAYLOAD, q: '', stream: [] },
      });
      renderDash();
      await waitFor(() => expect(screen.getByText(/^No events in this window\.$/i)).toBeInTheDocument());
      expect(screen.queryByText(/No decisions match/i)).not.toBeInTheDocument();
    });
  });
});
