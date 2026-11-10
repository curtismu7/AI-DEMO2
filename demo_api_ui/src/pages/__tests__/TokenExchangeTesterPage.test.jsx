/**
 * @file TokenExchangeTesterPage.test.jsx
 * Mode toggle + login CTA when subject token is missing.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { flushEffects } from '../../test-utils/flushEffects';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
    expect(screen.getByTestId('tet-banner').textContent).toMatch(/nothing here is simulated/i);
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

// ─── Skeptic fixes (PR 3515) ─────────────────────────────────────────────────
const ERR_400 = () => ({ ok: false, status: 400, json: async () => ({ success: false, mode: 'single', error: 'invalid_grant', request: { audience: 'x' } }) });

describe('TokenExchangeTesterPage skeptic fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not carry a failed result or error from one mode into the other', async () => {
    stubFetch({ exchange: ERR_400 });
    render(<TokenExchangeTesterPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Exchange Token/i }));
    const status = await screen.findByTestId('tet-status');
    await waitFor(() => expect(within(status).getByText('invalid_grant')).toBeTruthy());
    expect(screen.getByRole('region', { name: /Full response/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    expect(within(screen.getByTestId('tet-status')).getByText('Not run')).toBeTruthy();
    expect(screen.queryByText('invalid_grant')).toBeNull();
    expect(screen.queryByRole('region', { name: /Full response/i })).toBeNull();
  });

  it('clears the blocked 2-exchange error when going back to 1-exchange', async () => {
    stubFetch({ agent: AGENT_NONE, exchange: () => { throw new Error('must not call'); } });
    render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run 2-Exchange/i }));
    expect(await screen.findByText(/Agent actor token is not available/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /1-exchange/i }));
    expect(screen.queryByText(/Agent actor token is not available/i)).toBeNull();
    expect(within(screen.getByTestId('tet-status')).getByText('Not run')).toBeTruthy();
  });

  it('names no identity provider anywhere on the page, whatever the mode or state', async () => {
    stubFetch({ agent: AGENT_NONE, exchange: ERR_400 });
    const { container } = render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run 2-Exchange/i }));
    await screen.findByText(/Agent actor token is not available/i);
    expect(container.textContent).not.toMatch(/PingOne|PingFederate/);
  });

  it('result text does not claim a left/right position (the columns stack on a phone)', async () => {
    stubFetch({
      exchange: () => ({ ok: true, status: 200, json: async () => ({ success: true, mode: 'single', request: {} }) }),
    });
    render(<TokenExchangeTesterPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Exchange Token/i }));
    const status = await screen.findByTestId('tet-status');
    await waitFor(() => expect(within(status).getByText('Issued')).toBeTruthy());
    expect(status.textContent).not.toMatch(/\b(left|right)\b/i);
  });

  it('the session live region exists before it has content, so signed-out text is announced when it appears', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    global.fetch = vi.fn(async (url) => {
      await gate;
      if (String(url).includes('session-preview')) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, json: async () => AGENT_OK };
    });
    render(<TokenExchangeTesterPage />);
    const region = screen.getByTestId('tet-session-status');
    expect(region.getAttribute('role')).toBe('status');
    release();
    await screen.findByRole('button', { name: /Customer Sign In/i });
    // the very same element now holds the text
    expect(screen.getByTestId('tet-session-status')).toBe(region);
    expect(region.textContent).toMatch(/Please log in first/);
    expect(within(region).getByText('Signed out')).toBeTruthy();
  });

  it('the live region is there before a mid-run session end writes into it', async () => {
    stubFetch({ exchange: () => ({ ok: false, status: 401, json: async () => ({ code: 'login_required' }) }) });
    render(<TokenExchangeTesterPage />);
    const run = await screen.findByRole('button', { name: /Exchange Token/i });
    const region = screen.getByTestId('tet-session-status');
    expect(region.textContent).toBe('');
    fireEvent.click(run);
    await waitFor(() => expect(region.textContent).toMatch(/Your session ended/));
    expect(screen.getByTestId('tet-session-status')).toBe(region);
  });

  it('moves focus to the remaining button when the session ends while focus is in a field that goes away', async () => {
    stubFetch({ exchange: () => ({ ok: false, status: 401, json: async () => ({ code: 'login_required' }) }) });
    render(<TokenExchangeTesterPage />);
    await screen.findByRole('button', { name: /Exchange Token/i });
    const scopes = screen.getByLabelText(/Scopes/i);
    scopes.focus();
    expect(document.activeElement).toBe(scopes);
    await flushEffects(); // run the first render's pending passive effects before interacting
    fireEvent.submit(scopes.closest('form'));
    await screen.findByText(/Your session ended/i);
    expect(screen.queryByLabelText(/Scopes/i)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Customer Sign In/i })));
  });

  it('a check that never answers ends as a plain-words state instead of "Checking" for ever', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    render(<TokenExchangeTesterPage />);
    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(8100);
    await vi.advanceTimersByTimeAsync(8100);
    vi.useRealTimers();
    const subject = screen.getByTestId('tet-subject');
    await waitFor(() => expect(within(subject).getByText('Not checked')).toBeTruthy());
    expect(within(subject).getByText(/check timed out/i)).toBeTruthy();
    expect(within(subject).queryByText('Signed out')).toBeNull();
    expect(within(screen.getByTestId('tet-agent')).getByText(/check timed out/i)).toBeTruthy();
    expect(screen.queryByText('Checking')).toBeNull();
    // still one primary, and it is sign-in
    expect(primaries()).toHaveLength(1);
  });
});

// ─── Page CSS: scoped, and legible in both themes ────────────────────────────
describe('TokenExchangeTesterPage CSS', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../TokenExchangeTesterPage.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const indexCss = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));

  it('every selector in the page stylesheet is scoped under .pu-page.tet-page', () => {
    const selectors = [...stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThan(5);
    selectors.forEach((group) => {
      group.split(',').forEach((sel) => expect(sel.trim()).toMatch(/^\.pu-page\.tet-page\b/));
    });
  });

  it('leaves no dead .tet-btn rule behind in index.css', () => {
    expect(indexCss).not.toMatch(/\.tet-btn/);
  });

  it('dark: highlighted JSON keys clear 4.5:1 on the card ground through the shared palette alone (no page override)', () => {
    const card = hex('#131c2e'); // dark --th-bg-card
    const wash = over([255, 82, 82], 0.18, card); // .jh-dark .jh-focus background
    const shared = fs.readFileSync(path.resolve(__dirname, '../../components/shared/JsonHighlight.css'), 'utf8');
    const sharedInk = shared.match(/\.jh-dark \.jh-focus \{[^}]*color: (#[0-9a-f]{6})/i)[1];
    expect(ratio(hex(sharedInk), wash)).toBeGreaterThanOrEqual(4.5);
    expect(stripped).not.toMatch(/\.jh-focus/);
  });

  it('light: the highlighted keys and the palette inks clear 4.5:1 on the card ground', () => {
    const card = hex('#ffffff');
    const shared = fs.readFileSync(path.resolve(__dirname, '../../components/shared/JsonHighlight.css'), 'utf8');
    const focusInk = shared.match(/^\.jh-focus \{[^}]*color: (#[0-9a-f]{6})/im)[1];
    expect(ratio(hex(focusInk), over([210, 14, 15], 0.1, card))).toBeGreaterThanOrEqual(4.5);
    ['#0550ae', '#15803d', '#b45309'].forEach((c) => expect(ratio(hex(c), card)).toBeGreaterThanOrEqual(4.5));
  });

  it('true / false / null are neutral in the shared palette, so the page needs no keyword override', () => {
    expect(stripped).not.toMatch(/\.jh-keyword/);
  });

  it('every rule that sets a --th-* background sets its own ink in the same rule', () => {
    const rules = [...stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    rules.forEach(([, sel, body]) => {
      if (/background(-color)?:\s*var\(--th-/.test(body)) {
        expect(body, sel.trim()).toMatch(/(^|[;\s])color:/);
      }
    });
  });
});

