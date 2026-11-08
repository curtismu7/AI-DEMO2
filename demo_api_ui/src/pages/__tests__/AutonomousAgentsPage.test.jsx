import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ default: api }));
vi.mock('../../components/TokenChainFilmstrip', () => ({ default: () => <div data-testid="reel" /> }));
vi.mock('../../services/tokenChainTrace/replayUnattendedRun', () => ({
  replayUnattendedRun: vi.fn(),
  describeRun: (r) => `run ${r.runId}`,
}));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import AutonomousAgentsPage from '../AutonomousAgentsPage';

const NOW = '2026-11-08T02:00:00.000Z';
const parked = {
  runId: 'r-parked', job: 'balance-sweep', status: 'parked', startedAt: NOW, agent: 'Sweep Agent', trigger: 'manual',
  scanned: 4, mandate: { maxAmount: 500, window: 'day', source: 'topology' },
  proposal: { amount: 1000, fromName: 'Checking' }, identity: { ownIdentity: true },
  decision: { decision: 'permit', code: 'PAUSE' }, pending: { loginHint: 'owner-1', expiresIn: 300 },
  tokenEvents: [{ id: 1 }],
};
const done = { runId: 'r-done', job: 'fraud-watch', status: 'completed', startedAt: NOW, agent: 'Fraud Agent', trigger: 'cron', tokenEvents: [] };
const refused = { runId: 'r-refused', job: 'balance-sweep', status: 'denied', startedAt: NOW, agent: 'Sweep Agent', trigger: 'manual', identity: { ownIdentity: false, reason: 'no client credentials' }, tokenEvents: [] };
const expired = { runId: 'r-expired', job: 'balance-sweep', status: 'expired', startedAt: NOW, tokenEvents: [] };
const all = { [parked.runId]: parked, [done.runId]: done, [refused.runId]: refused, [expired.runId]: expired };

let flag;
let list;
function wire() {
  api.get.mockImplementation(async (url) => {
    if (url === '/api/autonomous-runs/flag') return { data: { enabled: flag } };
    if (url === '/api/autonomous-runs') return { data: { runs: list } };
    const id = url.split('/').pop();
    return { data: { run: all[id] } };
  });
  api.post.mockImplementation(async (url, body) => {
    if (url === '/api/autonomous-runs/flag') { flag = body.enabled; return { data: { enabled: flag } }; }
    if (url === '/api/autonomous-runs/run') return { data: { run: done } };
    if (url.endsWith('/approve')) return { data: { run: { ...parked, status: 'completed' } } };
    if (url.endsWith('/deny')) return { data: { run: { ...parked, status: 'denied' } } };
    throw new Error(`unexpected ${url}`);
  });
}

const primaries = (c) => [...c.querySelectorAll('button.pu-btn--primary')];

beforeEach(() => {
  vi.clearAllMocks();
  flag = true;
  list = [parked, done, refused, expired];
  wire();
});

describe('AutonomousAgentsPage (standalone UI standard)', () => {
  it('puts a banner first that says the approval is a mock phone or email, never a real device', async () => {
    const { container } = render(<AutonomousAgentsPage />);
    const banner = screen.getByRole('note');
    expect(container.querySelector('.aap').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/mock phone or email/i);
    expect(banner.textContent).toMatch(/never to a real phone/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Autonomous Agents');
    await screen.findByTestId('aap-run-fraud-watch');
  });

  it('never claims a real push or a self-approval anywhere on the page', async () => {
    const { container } = render(<AutonomousAgentsPage />);
    fireEvent.click(within(await screen.findByTestId('aap-run-r-parked')).getByRole('button', { name: /balance-sweep/ }));
    await screen.findByTestId('aap-parked');
    const text = container.textContent;
    expect(text).toMatch(/mock phone or email/i);
    expect(text).not.toMatch(/self-approves/i);
    expect(text).not.toMatch(/CIBA sent to/i);
  });

  it('shows exactly one primary in every state: Turn on, then Run fraud watch, then Approve, then back', async () => {
    flag = false;
    const { container } = render(<AutonomousAgentsPage />);
    const sw = screen.getByTestId('aap-switch');
    // still loading: the switch is the one primary and cannot act
    expect(primaries(container)).toEqual([sw]);
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    await screen.findByTestId('aap-off-note');
    expect(primaries(container)).toEqual([sw]);
    expect(sw.textContent).toBe('Turn on');
    expect(sw.disabled).toBe(false);

    list = [parked, done];
    fireEvent.click(sw);
    const fraud = await screen.findByTestId('aap-run-fraud-watch');
    expect(primaries(container)).toEqual([fraud]);
    expect(screen.getByTestId('aap-switch').textContent).toBe('Turn off');
    expect(screen.getByTestId('aap-run-balance-sweep').className).not.toContain('primary');

    fireEvent.click(within(screen.getByTestId('aap-run-r-parked')).getByRole('button', { name: /balance-sweep/ }));
    const approve = await screen.findByTestId('aap-approve');
    expect(primaries(container)).toEqual([approve]);
    expect(screen.getByTestId('aap-decline').className).not.toContain('primary');

    fireEvent.click(screen.getByTestId('aap-decline'));
    await waitFor(() => expect(screen.queryByTestId('aap-approve')).toBeNull());
    expect(primaries(container)).toEqual([screen.getByTestId('aap-run-fraud-watch')]);
  });

  it('lists each run as a card with a status chip that carries the word, and a key-value record when opened', async () => {
    const { container } = render(<AutonomousAgentsPage />);
    await screen.findByTestId('aap-run-r-parked');
    const chip = (id) => within(screen.getByTestId(`aap-run-${id}`)).getAllByText(/./, { selector: '.pu-chip' })[0];
    expect(chip('r-parked').textContent).toBe('Waiting on approval');
    expect(chip('r-parked').className).toContain('pu-chip--warn');
    expect(chip('r-done').textContent).toBe('Completed');
    expect(chip('r-done').className).toContain('pu-chip--ok');
    expect(chip('r-refused').textContent).toBe('Refused by policy');
    expect(chip('r-refused').className).toContain('pu-chip--danger');
    expect(chip('r-expired').textContent).toBe('Approval expired');
    expect(container.querySelectorAll('.pu-chip')).not.toHaveLength(0);
    container.querySelectorAll('.pu-chip').forEach((c) => expect(c.textContent.trim()).not.toBe(''));

    fireEvent.click(within(screen.getByTestId('aap-run-r-done')).getByRole('button', { name: /fraud-watch/ }));
    const card = screen.getByTestId('aap-run-r-done');
    await waitFor(() => expect(card.querySelector('dl.pu-kv')).not.toBeNull());
    expect(card.querySelector('dl.pu-kv').textContent).toMatch(/Fraud Agent/);
    expect(card.querySelector('dl.pu-kv').textContent).not.toMatch(/Error/);
  });

  it('keeps a row opener with an accessible name and aria-expanded', async () => {
    render(<AutonomousAgentsPage />);
    const opener = within(await screen.findByTestId('aap-run-r-done')).getByRole('button', { name: /fraud-watch.*Completed/ });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(opener);
    await waitFor(() => expect(opener.getAttribute('aria-expanded')).toBe('true'));
    expect(document.getElementById(opener.getAttribute('aria-controls'))).not.toBeNull();
  });

  it('explains a run with no identity of its own as a warn card with a word', async () => {
    render(<AutonomousAgentsPage />);
    fireEvent.click(within(await screen.findByTestId('aap-run-r-refused')).getByRole('button', { name: /balance-sweep/ }));
    const card = await screen.findByTestId('aap-no-identity');
    expect(card.className).toContain('pu-card--warn');
    expect(card.textContent).toMatch(/Did not run/);
    expect(card.textContent).toMatch(/no identity of its own/);
  });

  it('uses aria-disabled, not disabled, while a run is in flight, and ignores the click', async () => {
    let release;
    api.post.mockImplementation((url) => (url === '/api/autonomous-runs/run'
      ? new Promise((r) => { release = () => r({ data: { run: done } }); })
      : Promise.reject(new Error('x'))));
    render(<AutonomousAgentsPage />);
    const fraud = await screen.findByTestId('aap-run-fraud-watch');
    fraud.focus();
    fireEvent.click(fraud);
    await waitFor(() => expect(fraud.getAttribute('aria-disabled')).toBe('true'));
    expect(fraud.disabled).toBe(false);
    expect(document.activeElement).toBe(fraud);
    fireEvent.click(fraud);
    fireEvent.click(screen.getByTestId('aap-run-balance-sweep'));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/autonomous-runs/run', { job: 'fraud-watch' });
    await act(async () => { release(); });
    await waitFor(() => expect(fraud.getAttribute('aria-disabled')).toBeNull());
    expect(document.activeElement).toBe(fraud);
  });

  it('moves focus to the run row after Approve, because the approval buttons leave the page', async () => {
    render(<AutonomousAgentsPage />);
    const opener = within(await screen.findByTestId('aap-run-r-parked')).getByRole('button', { name: /balance-sweep/ });
    fireEvent.click(opener);
    const approve = await screen.findByTestId('aap-approve');
    approve.focus();
    fireEvent.click(approve);
    expect(api.post).toHaveBeenCalledWith('/api/autonomous-runs/r-parked/approve');
    await waitFor(() => expect(screen.queryByTestId('aap-approve')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('has no inline style on the page', async () => {
    const { container } = render(<AutonomousAgentsPage />);
    await screen.findByTestId('aap-run-r-parked');
    fireEvent.click(within(screen.getByTestId('aap-run-r-parked')).getByRole('button', { name: /balance-sweep/ }));
    await screen.findByTestId('aap-parked');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('keeps its stylesheet to tokens: no hex, no rgb, no font-size under 10px', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../AutonomousAgentsPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/i);
    expect(css).not.toMatch(/font-size:\s*[0-9.]+(px|rem|em)/);
  });

  it('F1: opening run A then run B shows B\'s record under B, and a late answer for A never lands there or brings its Approve', async () => {
    let releaseA;
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => (url === `/api/autonomous-runs/${parked.runId}`
      ? new Promise((resolve) => { releaseA = () => resolve({ data: { run: parked } }); })
      : base(url)));
    render(<AutonomousAgentsPage />);
    const rowA = await screen.findByTestId('aap-run-r-parked');
    const rowB = screen.getByTestId('aap-run-r-done');
    fireEvent.click(within(rowA).getByRole('button', { name: /balance-sweep/ }));
    fireEvent.click(within(rowB).getByRole('button', { name: /fraud-watch/ }));
    await waitFor(() => expect(within(rowB).getByText('Fraud Agent')).toBeTruthy());
    await act(async () => { releaseA(); });
    expect(within(rowB).getByText('Fraud Agent')).toBeTruthy();
    expect(within(rowB).queryByText('Sweep Agent')).toBeNull();
    expect(screen.queryByTestId('aap-approve')).toBeNull();
    expect(within(rowA).queryByText('Sweep Agent')).toBeNull();
  });

  it('F1: Approve acts on the run it is shown under', async () => {
    render(<AutonomousAgentsPage />);
    const rowA = await screen.findByTestId('aap-run-r-parked');
    fireEvent.click(within(rowA).getByRole('button', { name: /balance-sweep/ }));
    const approve = await screen.findByTestId('aap-approve');
    expect(rowA.contains(approve)).toBe(true);
    fireEvent.click(approve);
    expect(api.post).toHaveBeenCalledWith('/api/autonomous-runs/r-parked/approve');
  });

  it('F1: a failed load of an earlier row does not close the row opened after it', async () => {
    let failA;
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => (url === `/api/autonomous-runs/${parked.runId}`
      ? new Promise((_resolve, reject) => { failA = () => reject(new Error('boom')); })
      : base(url)));
    render(<AutonomousAgentsPage />);
    const rowA = await screen.findByTestId('aap-run-r-parked');
    const rowB = screen.getByTestId('aap-run-r-done');
    fireEvent.click(within(rowA).getByRole('button', { name: /balance-sweep/ }));
    fireEvent.click(within(rowB).getByRole('button', { name: /fraud-watch/ }));
    await waitFor(() => expect(within(rowB).getByText('Fraud Agent')).toBeTruthy());
    await act(async () => { failA(); });
    expect(within(rowB).getByText('Fraud Agent')).toBeTruthy();
  });

  it('F9: a failed flag read shows Unavailable with a Retry, and Retry reads it again', async () => {
    let calls = 0;
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === '/api/autonomous-runs/flag') {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('500')) : Promise.resolve({ data: { enabled: true } });
      }
      return base(url);
    });
    const { container } = render(<AutonomousAgentsPage />);
    const retry = await screen.findByTestId('aap-flag-retry');
    expect(within(screen.getByTestId('aap-switch-card')).getByText('Unavailable', { selector: '.pu-chip' }).className).toContain('pu-chip--danger');
    expect(screen.queryByText('Checking')).toBeNull();
    expect(screen.getByTestId('aap-switch-card').textContent).toMatch(/could not read the setting/i);
    // one primary: the Retry, not the locked switch
    expect(primaries(container)).toEqual([retry]);
    fireEvent.click(retry);
    await screen.findByTestId('aap-run-fraud-watch');
    expect(screen.queryByTestId('aap-flag-retry')).toBeNull();
    expect(screen.getByTestId('aap-switch').textContent).toBe('Turn off');
    expect(calls).toBe(2);
  });
});
