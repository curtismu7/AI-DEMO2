import React from 'react';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const signIn = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthLogin: signIn }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

import UngovernedAgentPage from '../UngovernedAgentPage';

const TX = [
  { id: 'a', type: 'deposit', amount: 80, description: 'Transfer one', createdAt: '2026-10-21T09:23:23Z', clientType: 'enduser' },
  { id: 'b', type: 'withdrawal', amount: 12, description: 'Agent move', createdAt: '2026-10-22T09:23:23Z', clientType: 'ai_agent', actorSub: 'agent-7' },
];

function mockFetch(status, body) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function renderPage() {
  return render(<MemoryRouter><UngovernedAgentPage /></MemoryRouter>);
}

const primaries = (container) => [...container.querySelectorAll('button.pu-btn--primary')];

beforeEach(() => {
  signIn.mockClear();
  navigate.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('UngovernedAgentPage (Ping UI standard)', () => {
  it('keeps the page testid and puts an honest banner first, as a note', async () => {
    mockFetch(200, { transactions: [] });
    const { container } = renderPage();
    const page = screen.getByTestId('ungoverned-agent-page');
    const banner = screen.getByRole('note');
    expect(page.firstElementChild.contains(banner)).toBe(true);
    expect(container.querySelector('.pu-page')).toBe(page);
    expect(banner.textContent).toMatch(/nothing on this page runs an agent/i);
    expect(banner.textContent).toMatch(/one real call/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The Ungoverned Agent');
    await screen.findByText(/no transactions yet/i);
  });

  it('compares governed and ungoverned in a real table with named headers', async () => {
    mockFetch(200, { transactions: [] });
    renderPage();
    const table = screen.getByRole('table', { name: /governed versus ungoverned/i });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(table).getByRole('rowheader', { name: 'Identity' })).toBeTruthy();
    await screen.findByText(/no transactions yet/i);
  });

  it('labels each row with a chip that carries the word, and names the actor for agent rows', async () => {
    mockFetch(200, { transactions: TX });
    renderPage();
    const list = await screen.findByRole('list', { name: /recent transfers/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // newest first
    expect(within(rows[0]).getByText('Governed agent (act-as chain)').className).toContain('pu-chip--ok');
    expect(rows[0].textContent).toContain('acting as agent-7');
    expect(within(rows[1]).getByText('Direct user session').className).toContain('pu-chip--warn');
  });

  it('has exactly one primary in every state: Refresh when signed in, Sign in when signed out', async () => {
    mockFetch(200, { transactions: TX });
    const first = renderPage();
    await screen.findByRole('list', { name: /recent transfers/i });
    expect(primaries(first.container)).toHaveLength(1);
    expect(primaries(first.container)[0].textContent).toBe('Refresh');
    expect(screen.getByRole('button', { name: /see the full owasp mapping/i }).className).not.toContain('primary');
    for (const b of screen.getAllByRole('button', { name: /^copy command/i })) expect(b.className).not.toContain('primary');
    first.unmount();

    vi.restoreAllMocks();
    mockFetch(401, {});
    const second = renderPage();
    await screen.findByText(/sign in as a bank customer/i);
    expect(primaries(second.container)).toHaveLength(1);
    const btn = primaries(second.container)[0];
    expect(btn.textContent).toBe('Sign in');
    fireEvent.click(btn);
    expect(signIn).toHaveBeenCalledWith('/ungoverned-agent');
  });

  it('Refresh reloads the list and focus stays on the same button', async () => {
    const user = userEvent.setup();
    const spy = mockFetch(200, { transactions: [TX[0]] });
    renderPage();
    await screen.findByRole('list', { name: /recent transfers/i });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockResolvedValue({ status: 200, ok: true, json: async () => ({ transactions: TX }) });
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(within(screen.getByRole('list', { name: /recent transfers/i })).getAllByRole('listitem')).toHaveLength(2));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(refresh);
    expect(screen.getByRole('status').textContent).toMatch(/^Updated /);
  });

  it('copy buttons have distinct names, flip to Copied! in place and keep focus', async () => {
    const user = userEvent.setup();
    mockFetch(200, { transactions: [] });
    const write = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderPage();
    const copies = screen.getAllByRole('button', { name: /^copy command/i });
    expect(copies.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Copy command: npx skills add jackwener/opencli',
      'Copy command: docker compose run --rm ungoverned-agent',
    ]);
    copies[1].focus();
    await user.keyboard('{Enter}');
    expect(write).toHaveBeenCalledWith('docker compose run --rm ungoverned-agent');
    expect(copies[1].textContent).toBe('Copied!');
    expect(document.activeElement).toBe(copies[1]);
    await screen.findByText(/no transactions yet/i);
  });

  it('the OWASP button navigates to /owasp', async () => {
    mockFetch(200, { transactions: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /see the full owasp mapping/i }));
    expect(navigate).toHaveBeenCalledWith('/owasp');
    await screen.findByText(/no transactions yet/i);
  });

  it('clears the stale "Updated" time when a later refresh fails (500) or is signed out (401)', async () => {
    const user = userEvent.setup();
    for (const [code, text] of [[500, /couldn't load transfers/i], [401, /sign in as a bank customer/i]]) {
      const spy = mockFetch(200, { transactions: [TX[0]] });
      const { unmount } = renderPage();
      await screen.findByRole('list', { name: /recent transfers/i });
      expect(screen.getByRole('status').textContent).toMatch(/^Updated /);
      spy.mockResolvedValue({ status: code, ok: false, json: async () => ({}) });
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await screen.findByText(text);
      expect(document.body.textContent).not.toMatch(/Updated \S/);
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('Refresh shows Refreshing, is aria-disabled (not disabled, keeps focus) and ignores presses in flight', async () => {
    const user = userEvent.setup();
    const spy = mockFetch(200, { transactions: [TX[0]] });
    renderPage();
    await screen.findByRole('list', { name: /recent transfers/i });
    let release;
    spy.mockImplementation(() => new Promise((r) => { release = () => r({ status: 200, ok: true, json: async () => ({ transactions: TX }) }); }));
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    expect(refresh.disabled).toBe(false);
    expect(document.activeElement).toBe(refresh);
    expect(screen.getByRole('status').textContent).toBe('Refreshing…');
    await user.keyboard('{Enter}');
    await user.click(refresh);
    expect(spy).toHaveBeenCalledTimes(2);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Updated /));
    expect(refresh.getAttribute('aria-disabled')).toBeNull();
    expect(within(screen.getByRole('list', { name: /recent transfers/i })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('discards an older response that lands after a newer one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const resolvers = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((r) => resolvers.push(r)));
      renderPage();
      expect(resolvers).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10); });
      expect(resolvers).toHaveLength(2);
      const ok = (transactions) => ({ status: 200, ok: true, json: async () => ({ transactions }) });
      await act(async () => { resolvers[1](ok(TX)); });
      await screen.findByRole('list', { name: /recent transfers/i });
      await act(async () => { resolvers[0](ok([TX[0]])); });
      expect(within(screen.getByRole('list', { name: /recent transfers/i })).getAllByRole('listitem')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Copy accessible name contains the visible text and the copy is announced', async () => {
    const user = userEvent.setup();
    mockFetch(200, { transactions: [] });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    const { container } = renderPage();
    const regions = () => [...container.querySelectorAll('.ungov-code-block [aria-live="polite"]')];
    expect(regions()).toHaveLength(2);
    expect(regions().map((r) => r.textContent)).toEqual(['', '']);
    const btn = screen.getAllByRole('button', { name: /^copy command/i })[0];
    expect(btn.getAttribute('aria-label')).toContain(btn.textContent);
    await user.click(btn);
    expect(btn.textContent).toBe('Copied!');
    expect(btn.getAttribute('aria-label')).toContain('Copied!');
    expect(btn.getAttribute('aria-label')).toContain('npx skills add jackwener/opencli');
    expect(regions()[0].textContent).toMatch(/copied command to clipboard: npx skills add/i);
    expect(regions()[1].textContent).toBe('');
    await screen.findByText(/no transactions yet/i);
  });

  it('shows the API-down message as a status', async () => {
    mockFetch(500, {});
    renderPage();
    expect((await screen.findByText(/couldn't load transfers/i)).getAttribute('role')).toBe('status');
  });
});
