/**
 * @file TokenExchangeTesterPage.test.jsx
 * Mode toggle + login CTA when subject token is missing.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TokenExchangeTesterPage from '../TokenExchangeTesterPage';
import { PI_FLOW_SIGNIN_EVENT } from '../../utils/authUi';

const USER_OK = { tokenEvents: [{ id: 'user-token', status: 'active', claims: { sub: 'u1', aud: 'enduser.ping.demo', scope: 'read write' }, label: 'User' }] };
const AGENT_OK = { tokenEvents: [{ id: 'agent-actor-token-prefetch', status: 'active', claims: { sub: 'agent', client_id: 'agent-client' }, label: 'Agent CC' }] };
const AGENT_NONE = { tokenEvents: [{ id: 'agent-cc-not-configured', status: 'skipped', explanation: 'Not configured' }] };

/** fetch stub: readiness answers, plus an optional handler for POST /exchange-test. */
function stubFetch({ user = USER_OK, agent = AGENT_OK, exchange } = {}) {
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('session-preview')) {
      return user ? { ok: true, json: async () => user } : { ok: false, status: 401, json: async () => ({}) };
    }
    if (u.includes('agent-cc-preview')) return { ok: true, json: async () => agent };
    if (u.includes('exchange-test')) return exchange(init);
    return { ok: false, json: async () => ({}) };
  });
}

const primaries = (root = document) => [...root.querySelectorAll('button.pu-btn--primary')];

vi.mock('../../components/shared/JsonHighlight', () => ({
  default: ({ value }) => <pre data-testid="json">{JSON.stringify(value)}</pre>,
}));

describe('TokenExchangeTesterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows login CTA when session-preview has no user token', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return { ok: false, status: 401, json: async () => ({ error: 'no' }) };
      }
      if (String(url).includes('agent-cc-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'agent-actor-token-prefetch', status: 'active', claims: { sub: 'agent' }, label: 'Agent CC' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<TokenExchangeTesterPage />);

    await waitFor(() => {
      expect(screen.getByText(/Log in to get user token/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Customer Sign In/i })).toBeTruthy();
  });

  it('does not flash "Please log in first" for a logged-in user while the readiness fetch is still in flight', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'user-token', status: 'active', claims: { sub: 'u1' }, label: 'User' }],
          }),
        };
      }
      if (String(url).includes('agent-cc-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'agent-cc-not-configured', status: 'skipped', explanation: 'Not configured' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<TokenExchangeTesterPage />);

    // Immediately after render, the readiness fetch's promise hasn't resolved
    // yet — the page must show a checking state, not the logged-out prompt.
    expect(screen.queryByText(/Please log in first/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exchange Token/i })).toBeTruthy();
    });
  });

  it('toggles to 2-exchange and requires agent readiness', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'user-token', status: 'active', claims: { sub: 'u1', scope: 'read write' }, label: 'User' }],
          }),
        };
      }
      if (String(url).includes('agent-cc-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'agent-cc-not-configured', status: 'skipped', explanation: 'Not configured' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<TokenExchangeTesterPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exchange Token/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));

    const runBtn = screen.getByRole('button', { name: /Run 2-Exchange/i });
    // aria-disabled, not disabled: the control keeps keyboard focus and a visible reason sits next to it.
    expect(runBtn).not.toBeDisabled();
    expect(runBtn.getAttribute('aria-disabled')).toBe('true');
    expect(runBtn.getAttribute('aria-describedby')).toBe('tet-run-reason');
    expect(document.getElementById('tet-run-reason').textContent).toMatch(/agent actor token/i);
    expect(screen.getByText(/Required for 2-exchange/i)).toBeTruthy();
  });
});

// ─── Sign-in CTA routes through the pi.flow modal ────────────────────────────
describe('TokenExchangeTesterPage sign-in trigger', () => {
  test('the Customer Sign In CTA opens the modal, not a redirect', async () => {
    const handled = vi.fn((e) => { e.detail.handled = true; });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/token-exchange-tester', href: '', assign },
    });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (String(url).includes('agent-cc-preview')) {
        return { ok: true, json: async () => ({ tokenEvents: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    render(<TokenExchangeTesterPage />);
    fireEvent.click(await screen.findByRole('button', { name: /customer sign in/i }));
    expect(handled).toHaveBeenCalled();
    expect(window.location.href).toBe('');
    window.removeEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });
});

// ─── Ping UI Standard (Wave 5) ───────────────────────────────────────────────
describe('TokenExchangeTesterPage on the Ping UI Standard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('puts the honest banner first, as a note, and says nothing is simulated', async () => {
    stubFetch();
    const { container } = render(<TokenExchangeTesterPage />);
    const page = container.querySelector('.pu-page.tet-page');
    expect(page).toBeTruthy();
    expect(page.firstElementChild.querySelector('[role="note"]')).toBeTruthy();
    expect(screen.getByTestId('tet-banner').textContent).toMatch(/nothing on this page is simulated/i);
    // the banner does not name an identity provider it cannot know
    expect(screen.getByTestId('tet-banner').textContent).not.toMatch(/PingOne|PingFederate/);
    await screen.findByRole('button', { name: /Exchange Token/i });
  });

  it('offers exactly one primary button in every state: none while checking, sign-in signed out, run signed in', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    global.fetch = vi.fn(async (url) => {
      await gate;
      if (String(url).includes('session-preview')) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, json: async () => AGENT_OK };
    });
    const { container, unmount } = render(<TokenExchangeTesterPage />);
    expect(primaries(container)).toHaveLength(0); // checking: nothing can be done yet
    release();
    const signIn = await screen.findByRole('button', { name: /Customer Sign In/i });
    expect(primaries(container)).toEqual([signIn]);
    unmount();

    stubFetch();
    const second = render(<TokenExchangeTesterPage />);
    const run = await screen.findByRole('button', { name: /Exchange Token/i });
    expect(primaries(second.container)).toEqual([run]);
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    expect(primaries(second.container)).toEqual([screen.getByRole('button', { name: /Run 2-Exchange/i })]);
  });

  it('every status chip carries a word, and the readiness chips say what was checked', async () => {
    stubFetch({ agent: AGENT_NONE });
    const { container } = render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    const chips = [...container.querySelectorAll('.pu-chip')];
    expect(chips.length).toBeGreaterThanOrEqual(3);
    chips.forEach((c) => expect(c.textContent.trim().length).toBeGreaterThan(0));
    const subject = screen.getByTestId('tet-subject');
    const agent = screen.getByTestId('tet-agent');
    expect(within(subject).getByText('Ready')).toBeTruthy();
    expect(subject.className).toContain('pu-card--ok');
    // not green: the agent token was checked and is missing; single mode does not need it
    expect(within(agent).getByText('Unavailable')).toBeTruthy();
    expect(agent.className).not.toContain('pu-card--ok');
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    expect(within(agent).getByText('Required')).toBeTruthy();
  });

  it('mode buttons are secondaries with aria-pressed, in a named group', async () => {
    stubFetch();
    render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    const group = screen.getByRole('group', { name: /Mode/i });
    const [one, two] = within(group).getAllByRole('button');
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(two.getAttribute('aria-pressed')).toBe('false');
    expect(one.className).not.toContain('pu-btn--primary');
    fireEvent.click(two);
    expect(two.getAttribute('aria-pressed')).toBe('true');
  });

  it('a blocked 2-exchange run keeps focus on the button and explains itself instead of doing nothing', async () => {
    stubFetch({ agent: AGENT_NONE, exchange: () => { throw new Error('must not call'); } });
    render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    const run = screen.getByRole('button', { name: /Run 2-Exchange/i });
    run.focus();
    fireEvent.click(run);
    expect(document.activeElement).toBe(run);
    expect(await screen.findByText(/Agent actor token is not available/i)).toBeTruthy();
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('exchange-test'))).toBe(false);
  });

  it('a successful 1-exchange shows both decoded tokens, keeps focus, and announces the result', async () => {
    stubFetch({
      exchange: () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          mode: 'single',
          original: { content: { payload: { sub: 'u1', aud: 'enduser.ping.demo', scope: 'read write' } } },
          exchanged: { content: { payload: { sub: 'u1', aud: 'mcpgateway.ping.demo', scope: 'read', act: { sub: 'agent' } } } },
          request: { mode: 'single', audience: 'mcpgateway.ping.demo', scopes: ['read', 'write'] },
        }),
      }),
    });
    render(<TokenExchangeTesterPage />);
    const run = await screen.findByRole('button', { name: /Exchange Token/i });
    run.focus();
    fireEvent.click(run);
    const exchanged = await screen.findByTestId('tet-exchanged');
    expect(within(exchanged).getByText('Issued')).toBeTruthy();
    expect(within(exchanged).getByText('mcpgateway.ping.demo')).toBeTruthy();
    expect(within(screen.getByTestId('tet-original')).getByText('enduser.ping.demo')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Exchange Token/i }));
    const status = screen.getByTestId('tet-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toMatch(/Issued/);
    // scrollable JSON is focusable and named
    const region = screen.getByRole('region', { name: /Full response/i });
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('keeps each 2-exchange step\'s result with that step', async () => {
    stubFetch({
      exchange: () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          mode: 'double',
          steps: [
            { id: 'two-ex-1', label: 'Exchange 1', status: 'exchanged', claims: { sub: 'u1', aud: 'intermediate.example' }, exchangeRequest: { step: 1 } },
            { id: 'two-ex-2', label: 'Exchange 2', status: 'failed', explanation: 'denied here', claims: { sub: 'u1', aud: 'final.example' } },
          ],
          request: { mode: 'double' },
        }),
      }),
    });
    render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run 2-Exchange/i }));
    const steps = await screen.findByTestId('tet-steps');
    const cards = steps.querySelectorAll('.pu-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Exchanged')).toBeTruthy();
    expect(within(cards[0]).getByText('intermediate.example')).toBeTruthy();
    expect(within(cards[0]).queryByText('final.example')).toBeNull();
    expect(within(cards[1]).getByText('Failed')).toBeTruthy();
    expect(within(cards[1]).getByText('denied here')).toBeTruthy();
    expect(cards[1].className).toContain('pu-card--danger');
    expect(within(cards[1]).queryByText('intermediate.example')).toBeNull();
  });

  it('a 401 on run says the session ended and offers sign-in on the page; it never navigates away silently', async () => {
    const handled = vi.fn((e) => { e.detail.handled = true; });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    stubFetch({ exchange: () => ({ ok: false, status: 401, json: async () => ({ code: 'login_required' }) }) });
    render(<TokenExchangeTesterPage />);
    const run = await screen.findByRole('button', { name: /Exchange Token/i });
    run.focus();
    fireEvent.click(run);
    expect(await screen.findByText(/Your session ended/i)).toBeTruthy();
    expect(handled).not.toHaveBeenCalled();
    // same button element, now the sign-in primary, still focused
    const signIn = screen.getByRole('button', { name: /Customer Sign In/i });
    expect(signIn).toBe(run);
    expect(document.activeElement).toBe(signIn);
    fireEvent.click(signIn);
    expect(handled).toHaveBeenCalledTimes(1);
    window.removeEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });

  it('a failed exchange shows the error in the status region and the token endpoint details', async () => {
    stubFetch({
      exchange: () => ({
        ok: false,
        status: 400,
        json: async () => ({ success: false, mode: 'single', error: 'invalid_grant', request: { audience: 'x' }, details: { pingoneError: 'invalid_grant' } }),
      }),
    });
    render(<TokenExchangeTesterPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Exchange Token/i }));
    const status = await screen.findByTestId('tet-status');
    await waitFor(() => expect(within(status).getByText('Failed')).toBeTruthy());
    expect(within(status).getByText('invalid_grant')).toBeTruthy();
    expect(screen.getByRole('region', { name: /Token endpoint error details/i })).toBeTruthy();
    expect(screen.getByTestId('tet-response').className).toContain('pu-card--danger');
  });
});
