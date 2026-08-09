import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  rules: [
    { ruleName: 'Transaction Denied', count: 2 },
    { ruleName: 'Transaction Approved', count: 1 },
    { ruleName: null, count: 7 },
  ],
  timeseries: [{ beginTimeSeconds: 1, count: 0 }, { beginTimeSeconds: 2, count: 3 }],
  stream: [{
    timestamp: 1786240000000, tag: 'authorize/deny', decision: 'DENY',
    ruleName: 'Transaction Denied', amount: 60000, stepUpRequired: false,
    type: 'transfer', engine: 'pingone', latencyMs: 42, policyEvalMs: 2.885,
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

  it('names which rule fired, and labels unattributed events rather than hiding them', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() =>
      expect(screen.getByTestId('stat-Transaction Denied')).toHaveTextContent('2'));
    expect(screen.getByTestId('stat-Transaction Approved')).toHaveTextContent('1');
    // ruleName null — pre-Task-2 events must still be counted, as "unattributed"
    expect(screen.getByTestId('stat-unattributed')).toHaveTextContent('7');
  });

  it('says so when no rule attribution exists in the window', async () => {
    apiClient.get.mockResolvedValue({ data: { ...PAYLOAD, rules: [] } });
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
    screen.getByRole('button', { name: '7d' }).click();
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/newrelic/view/authorize?window=7d'));
  });
});
