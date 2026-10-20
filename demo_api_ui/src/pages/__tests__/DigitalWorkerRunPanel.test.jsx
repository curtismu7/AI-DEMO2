// DigitalWorkerRunPanel — fetch-stub style mirrored from WorkloadAgentsPage.test.jsx.
//
// apiClient is mocked; TokenChainFilmstrip is replaced with a thin reader of the
// real tokenChainTraceStore, so the assertion "renders replayed steps" checks the
// real replayUnattendedRun behaviour without dragging in the full reel component
// (its own behaviour is covered by TokenChainFilmstrip.test.jsx).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DigitalWorkerRunPanel from '../DigitalWorkerRunPanel';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../components/TokenChainFilmstrip', async () => {
  const { useEffect, useState } = await import('react');
  const { tokenChainTraceStore } = await import('../../services/tokenChainTrace/tokenChainTraceStore');
  return {
    default: () => {
      const [snap, setSnap] = useState(null);
      useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
      const ids = (snap?.trace?.tokenEvents || []).map((e) => e.id).join(' ');
      return <div data-testid="dw-filmstrip">{ids || 'no steps'}</div>;
    },
  };
});

import apiClient from '../../services/apiClient';

const FLAG_URL = '/api/autonomous-runs/flag';
const LIST_URL = '/api/autonomous-runs?limit=5';

// Run-record shapes mirror the server fixtures (autonomousRunPersistsDecision.test.js
// PARKED_RESULT) — the run identifier field is runId, not id.
const COMPLETED_RUN = {
  runId: 'r1',
  job: 'balance-sweep',
  trigger: 'manual',
  status: 'completed',
  agent: 'Super Banking Balance Sweep Agent',
  scanned: 12,
  findings: [{ transactionId: 't1', amount: 5000 }],
  tokenEvents: [
    {
      id: 'agent-actor-token',
      label: 'Agent Token (unattended)',
      claims: { sub: 'agent:balance-sweep', aud: 'banking.ping.demo', scope: 'read' },
    },
  ],
};

const PARKED_RUN = {
  ...COMPLETED_RUN,
  status: 'parked',
  tokenEvents: [],
  findings: [],
  proposal: { fromAccountId: 'chk-1', amount: 1000, fromName: 'Checking' },
  mandate: { maxAmount: 500, window: 'day', source: 'topology' },
  pending: { authReqId: 'sim-1', initiatedAt: Date.now(), expiresIn: 300, loginHint: 'u1' },
  decision: { decision: 'PERMIT', reason: 'CIBA_APPROVAL', code: 'ciba-approval-required' },
  summary: 'over the standing mandate',
};

function mockFlag(on) {
  apiClient.get.mockImplementation((url) => {
    if (url === FLAG_URL) return Promise.resolve({ data: { flag: 'ff_autonomous_agents', enabled: on } });
    if (url === LIST_URL) return Promise.resolve({ data: { runs: [] } });
    return Promise.resolve({ data: {} });
  });
}

const listCallCount = () => apiClient.get.mock.calls.filter(([url]) => url === LIST_URL).length;

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: {} });
  apiClient.post.mockResolvedValue({ data: {} });
});

describe('DigitalWorkerRunPanel', () => {
  it('renders arm switch when flag disabled', async () => {
    mockFlag(false);
    render(<DigitalWorkerRunPanel />);

    expect(await screen.findByRole('heading', { name: /unattended: the worker starts itself/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /arm/i })).not.toBeChecked();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fire/i })).not.toBeInTheDocument();
  });

  it('arming posts the flag and shows the TTL', async () => {
    mockFlag(false);
    apiClient.post.mockResolvedValueOnce({ data: { flag: 'ff_autonomous_agents', enabled: true, armExpiresInMs: 3600000 } });
    render(<DigitalWorkerRunPanel />);

    fireEvent.click(await screen.findByRole('switch', { name: /arm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(FLAG_URL, { enabled: true }));
    expect(await screen.findByText(/auto-disarms in 60 min/)).toBeInTheDocument();
  });

  it('enabled panel offers job select and fire button', async () => {
    mockFlag(true);
    render(<DigitalWorkerRunPanel />);

    const select = await screen.findByRole('combobox', { name: /job/i });
    expect(within(select).getByRole('option', { name: 'balance-sweep' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'fraud-watch' })).toBeInTheDocument();
    expect(select.value).toBe('balance-sweep');

    apiClient.post.mockResolvedValueOnce({ data: { run: COMPLETED_RUN } });
    fireEvent.click(screen.getByRole('button', { name: /fire without a human turn/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/autonomous-runs/run', { job: 'balance-sweep' }));
    // The POST response already carries the full run record, so nothing more is fetched.
    expect(await screen.findByTestId('dw-filmstrip')).toHaveTextContent('agent-actor-token');
    expect(apiClient.get).toHaveBeenCalledTimes(2); // flag + list only — no GET /:runId
  });

  it('null run falls back to disarmed', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: null } });
    render(<DigitalWorkerRunPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));

    expect(await screen.findByText(/worker auto-disarmed/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /arm/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fire/i })).not.toBeInTheDocument();
  });

  it('403 renders unarmed state', async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error('Forbidden'), { response: { status: 403, data: { error: 'feature_disabled' } } }));
    render(<DigitalWorkerRunPanel />);

    expect(await screen.findByRole('switch', { name: /arm/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fire/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('parked run shows approve and deny', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: PARKED_RUN } });
    render(<DigitalWorkerRunPanel />);

    // A parked run arrives by firing; the decide buttons appear once it lands.
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    const approve = await screen.findByRole('button', { name: /approve/i });
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();

    apiClient.post.mockRejectedValueOnce(new Error('run is completed, not parked'));
    const before = listCallCount();
    fireEvent.click(approve);

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/autonomous-runs/r1/approve'));
    // On rejection the list is refetched (shows what the server actually holds)
    // and the buttons come back — nothing hangs disabled.
    await waitFor(() => expect(listCallCount()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled());
  });
});
