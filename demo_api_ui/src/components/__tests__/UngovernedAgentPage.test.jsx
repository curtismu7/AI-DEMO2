import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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

  it('shows the API-down message as a status', async () => {
    mockFetch(500, {});
    renderPage();
    expect((await screen.findByText(/couldn't load transfers/i)).getAttribute('role')).toBe('status');
  });
});
