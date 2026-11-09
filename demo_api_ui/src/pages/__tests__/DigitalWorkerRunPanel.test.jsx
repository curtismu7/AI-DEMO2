// DigitalWorkerRunPanel — fetch-stub style mirrored from WorkloadAgentsPage.test.jsx.
//
// apiClient is mocked; TokenChainFilmstrip is replaced with a thin reader of the
// real tokenChainTraceStore, so the assertion "renders replayed steps" checks the
// real replayUnattendedRun behaviour without dragging in the full reel component
// (its own behaviour is covered by TokenChainFilmstrip.test.jsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DigitalWorkerRunPanel from '../DigitalWorkerRunPanel';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/signInService', () => ({ openSignIn: vi.fn() }));
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
    // the stub filmstrip is mounted from the start ("no steps"); wait for the store to publish the run
    await waitFor(() => expect(screen.getByTestId('dw-filmstrip')).toHaveTextContent('agent-actor-token'));
    // flag + initial list + refetch after fire (no GET /:runId)
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('null run falls back to disarmed', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: null } });
    render(<DigitalWorkerRunPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));

    expect(await screen.findByText(/no longer armed/i)).toBeInTheDocument();
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

  it('401 from the wall asks the visitor to sign in instead of showing a dead switch', async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401, data: { error: 'hosted_access_required' } } }));
    render(<DigitalWorkerRunPanel />);

    expect(await screen.findByText(/sign in to arm the worker/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('403 on fire falls back to disarmed', async () => {
    mockFlag(true);
    // A real disarm mid-session (arm TTL elapsed, another viewer disarmed,
    // agent revoked) turns the run into 403 feature_disabled on the server.
    apiClient.post.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { response: { status: 403, data: { error: 'feature_disabled' } } }));
    render(<DigitalWorkerRunPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));

    expect(await screen.findByText(/no longer armed/i)).toBeInTheDocument();
    const armSwitch = screen.getByRole('switch', { name: /arm/i });
    expect(armSwitch).toBeInTheDocument();
    expect(armSwitch).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /fire/i })).not.toBeInTheDocument();
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

describe('DigitalWorkerRunPanel with a consent phone (onAskConsent)', () => {
  async function renderParked(onAskConsent, run = PARKED_RUN) {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run } });
    render(<DigitalWorkerRunPanel onAskConsent={onAskConsent} />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    return screen.findByRole('button', { name: /ask for approval on the phone/i });
  }

  it('replaces the bare Approve/Deny buttons with a request for approval on the phone', async () => {
    await renderParked(vi.fn());
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^deny$/i })).not.toBeInTheDocument();
  });

  it('puts the held transfer on the phone and completes the run when it is approved', async () => {
    const onAskConsent = vi.fn().mockResolvedValue('approved');
    const ask = await renderParked(onAskConsent);

    apiClient.post.mockResolvedValueOnce({ data: { run: { ...PARKED_RUN, status: 'completed' } } });
    fireEvent.click(ask);

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/autonomous-runs/r1/approve'));
    expect(onAskConsent).toHaveBeenCalledTimes(1);
    const [snapshot, label] = onAskConsent.mock.calls[0];
    expect(snapshot).toMatchObject({ amount: 1000, type: 'transfer' });
    expect(snapshot.description).toMatch(/1000/);
    expect(snapshot.description.length).toBeLessThanOrEqual(80);
    expect(label).toMatch(/1000/);
  });

  it('declines the run when it is denied on the phone', async () => {
    const ask = await renderParked(vi.fn().mockResolvedValue('denied'));
    apiClient.post.mockResolvedValueOnce({ data: { run: { ...PARKED_RUN, status: 'denied' } } });
    fireEvent.click(ask);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/autonomous-runs/r1/deny'));
  });

  it.each(['expired', 'cancelled', 'signin', 'error', 'busy'])('leaves the run parked when the phone answers "%s"', async (answer) => {
    const onAskConsent = vi.fn().mockResolvedValue(answer);
    const ask = await renderParked(onAskConsent);
    const postsBefore = apiClient.post.mock.calls.length;
    fireEvent.click(ask);
    await waitFor(() => expect(onAskConsent).toHaveBeenCalled());
    await Promise.resolve();
    // No approve/deny request went out, and the button is usable again for another try.
    expect(apiClient.post.mock.calls.length).toBe(postsBefore);
    expect(screen.getByRole('button', { name: /ask for approval on the phone/i })).toBeEnabled();
  });

  it('keeps the plain buttons when the run has no amount to show on a phone', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: { ...PARKED_RUN, proposal: { fromAccountId: 'chk-1' } } } });
    render(<DigitalWorkerRunPanel onAskConsent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    expect(await screen.findByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask for approval on the phone/i })).not.toBeInTheDocument();
  });
});

// Ping UI Standard (P7 chips with a word, P9 one primary per view state, focus that stays put).
describe('DigitalWorkerRunPanel on the Ping UI Standard', () => {
  const primaries = () => [...document.querySelectorAll('.pu-btn--primary')].map((b) => b.textContent.trim());

  it('not armed: a chip says so and the only control is the switch, so there is no primary button', async () => {
    mockFlag(false);
    render(<DigitalWorkerRunPanel />);
    await screen.findByRole('switch', { name: /arm/i });
    expect(screen.getByText('Not armed')).toBeInTheDocument();
    expect(primaries()).toEqual([]);
  });

  it('armed: Fire is the one primary; a parked run hands the primary to the phone request', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: PARKED_RUN } });
    render(<DigitalWorkerRunPanel onAskConsent={vi.fn()} />);
    expect(await screen.findByText('Armed')).toBeInTheDocument();
    expect(primaries()).toEqual(['Fire without a human turn']);

    fireEvent.click(screen.getByRole('button', { name: /fire without a human turn/i }));
    await screen.findByRole('button', { name: /ask for approval on the phone/i });
    expect(primaries()).toEqual(['Ask for approval on the phone']);
    expect(screen.getByRole('region', { name: 'Latest run' })).toHaveTextContent('Awaiting approval');
  });

  it('with no amount to show on a phone, Approve is the primary and Deny a secondary', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: { ...PARKED_RUN, proposal: { fromAccountId: 'chk-1' } } } });
    render(<DigitalWorkerRunPanel onAskConsent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    await screen.findByRole('button', { name: /approve/i });
    expect(primaries()).toEqual(['Approve']);
  });

  it('while the consent card is open it owns the primary: the panel steps down to secondaries', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: PARKED_RUN } });
    render(<DigitalWorkerRunPanel onAskConsent={vi.fn()} consentOpen />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    await screen.findByRole('button', { name: /ask for approval on the phone/i });
    expect(primaries()).toEqual([]);
  });

  it('a busy Fire keeps keyboard focus (aria-disabled, not disabled) and ignores a second press', async () => {
    mockFlag(true);
    let finish;
    apiClient.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<DigitalWorkerRunPanel />);
    const fire = await screen.findByRole('button', { name: /fire without a human turn/i });
    fire.focus();
    fireEvent.click(fire);
    await waitFor(() => expect(fire).toHaveAttribute('aria-disabled', 'true'));
    expect(fire).not.toBeDisabled();
    expect(document.activeElement).toBe(fire);
    fireEvent.click(fire);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    finish({ data: { run: COMPLETED_RUN } });
    await waitFor(() => expect(fire).not.toHaveAttribute('aria-disabled'));
    expect(document.activeElement).toBe(fire);
  });

  it('the arm switch stays focusable while the change is in flight', async () => {
    mockFlag(false);
    let finish;
    apiClient.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<DigitalWorkerRunPanel />);
    const sw = await screen.findByRole('switch', { name: /arm/i });
    sw.focus();
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-disabled', 'true'));
    expect(sw).not.toBeDisabled();
    expect(document.activeElement).toBe(sw);
    finish({ data: { enabled: true, armExpiresInMs: 60000 } });
    await screen.findByText('Armed');
  });

  it('after a decision removes the buttons that held focus, focus moves to the named Latest run region', async () => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: PARKED_RUN } });
    render(<DigitalWorkerRunPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    const approve = await screen.findByRole('button', { name: /approve/i });
    approve.focus();
    apiClient.post.mockResolvedValueOnce({ data: { run: { ...PARKED_RUN, status: 'completed' } } });
    fireEvent.click(approve);
    const region = await screen.findByRole('region', { name: 'Latest run' });
    await waitFor(() => expect(document.activeElement).toBe(region));
    expect(region).toHaveTextContent('Completed');
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it.each([
    ['completed', 'Completed'], ['parked', 'Awaiting approval'], ['denied', 'Declined'], ['expired', 'Expired'], ['failed', 'Failed'],
  ])('shows the word "%s" -> %s on the latest run chip', async (status, word) => {
    mockFlag(true);
    apiClient.post.mockResolvedValueOnce({ data: { run: { ...COMPLETED_RUN, status, error: 'x' } } });
    render(<DigitalWorkerRunPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
    expect(await screen.findByRole('region', { name: 'Latest run' })).toHaveTextContent(word);
  });

  describe('skeptic fixes (PR 3523)', () => {
    const forbidden = () => Object.assign(new Error('Forbidden'), { response: { status: 403, data: { error: 'feature_disabled' } } });

    it('a 403 on Fire moves focus to the Arm switch instead of dropping it to the page body', async () => {
      mockFlag(true);
      apiClient.post.mockRejectedValueOnce(forbidden());
      render(<DigitalWorkerRunPanel />);
      const fire = await screen.findByRole('button', { name: /fire without a human turn/i });
      fire.focus();
      fireEvent.click(fire);
      const sw = await screen.findByRole('switch', { name: 'Arm the worker' });
      await waitFor(() => expect(document.activeElement).toBe(sw));
    });

    it('a { run: null } answer to Fire also lands focus on the Arm switch', async () => {
      mockFlag(true);
      apiClient.post.mockResolvedValueOnce({ data: { run: null } });
      render(<DigitalWorkerRunPanel />);
      const fire = await screen.findByRole('button', { name: /fire without a human turn/i });
      fire.focus();
      fireEvent.click(fire);
      const sw = await screen.findByRole('switch', { name: 'Arm the worker' });
      await waitFor(() => expect(document.activeElement).toBe(sw));
    });

    it('does not steal focus when the visitor has already moved it elsewhere', async () => {
      mockFlag(true);
      let reject;
      apiClient.post.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
      render(<><button type="button">elsewhere</button><DigitalWorkerRunPanel /></>);
      fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
      const other = screen.getByRole('button', { name: 'elsewhere' });
      other.focus();
      reject(forbidden());
      await screen.findByRole('switch', { name: 'Arm the worker' });
      expect(document.activeElement).toBe(other);
    });

    it('the disarm notice does not claim a cause it cannot know, and sits in a status region that existed before the text', async () => {
      mockFlag(true);
      apiClient.post.mockRejectedValueOnce(forbidden());
      render(<DigitalWorkerRunPanel />);
      await screen.findByRole('button', { name: /fire without a human turn/i });
      const before = screen.getAllByRole('status').find((el) => el.classList.contains('dw-run__notice'));
      expect(before).toBeTruthy();
      expect(before).toHaveTextContent('');
      fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
      await waitFor(() => expect(before).toHaveTextContent(/no longer armed/i));
      expect(before.isConnected).toBe(true);
      expect(before).toHaveTextContent(/may have run out/i);
      expect(before).not.toHaveTextContent(/mandate was revoked/i);
    });

    it('arming again clears the stale disarm notice', async () => {
      mockFlag(true);
      apiClient.post.mockRejectedValueOnce(forbidden());
      render(<DigitalWorkerRunPanel />);
      fireEvent.click(await screen.findByRole('button', { name: /fire without a human turn/i }));
      const notice = await screen.findByText(/no longer armed/i);
      apiClient.post.mockResolvedValueOnce({ data: { enabled: true, armExpiresInMs: 3600000 } });
      fireEvent.click(screen.getByRole('switch', { name: 'Arm the worker' }));
      await screen.findByText(/auto-disarms in 60 min/);
      expect(notice).toHaveTextContent('');
    });

    it('the latest-run result is announced through a live region that was mounted before the run', async () => {
      mockFlag(true);
      apiClient.post.mockResolvedValueOnce({ data: { run: COMPLETED_RUN } });
      render(<DigitalWorkerRunPanel />);
      const fire = await screen.findByRole('button', { name: /fire without a human turn/i });
      const live = screen.getAllByRole('status').find((el) => el.classList.contains('dw-run__announce'));
      expect(live).toBeTruthy();
      expect(live).toHaveTextContent('');
      fire.focus();
      fireEvent.click(fire);
      await waitFor(() => expect(live).toHaveTextContent(/Completed: balance-sweep/));
      expect(live.isConnected).toBe(true);
      expect(document.activeElement).toBe(fire); // announcing does not move focus off Fire
      // the visible line inside the region is not a second live region
      expect(within(screen.getByRole('region', { name: 'Latest run' })).queryByRole('status')).toBeNull();
    });

    describe('stale Armed chip', () => {
      afterEach(() => { vi.useRealTimers(); });

      it('re-reads the flag when the arm window has passed and drops the green chip if the server says not armed', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockFlag(false);
        apiClient.post.mockResolvedValueOnce({ data: { enabled: true, armExpiresInMs: 60000 } });
        render(<DigitalWorkerRunPanel />);
        fireEvent.click(await screen.findByRole('switch', { name: 'Arm the worker' }));
        await screen.findByText('Armed');
        const flagReads = () => apiClient.get.mock.calls.filter(([u]) => u === FLAG_URL).length;
        const before = flagReads();
        await vi.advanceTimersByTimeAsync(30000);
        expect(flagReads()).toBe(before); // not yet
        await vi.advanceTimersByTimeAsync(31500);
        await waitFor(() => expect(flagReads()).toBe(before + 1));
        expect(await screen.findByText('Not armed')).toBeInTheDocument();
        expect(screen.queryByText('Armed')).not.toBeInTheDocument();
        expect(screen.getByText(/no longer armed/i)).toBeInTheDocument();
      });

      it('the Armed line says when the server was last asked', async () => {
        mockFlag(true);
        render(<DigitalWorkerRunPanel />);
        expect(await screen.findByText(/The server reported the worker as armed at \d{1,2}:\d{2}/)).toBeInTheDocument();
      });
    });

    it('tells the page when the unattended flag read answered 401', async () => {
      apiClient.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));
      const onNeedsSignIn = vi.fn();
      render(<DigitalWorkerRunPanel onNeedsSignIn={onNeedsSignIn} />);
      await screen.findByText(/sign in to arm the worker/i);
      expect(onNeedsSignIn).toHaveBeenCalledWith(true);
    });
  });
});
