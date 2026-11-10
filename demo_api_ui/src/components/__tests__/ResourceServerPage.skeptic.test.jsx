// ResourceServerPage.skeptic.test.jsx
// Skeptic findings on /resource-server (PR #3549): a live region mounted before its text changes, a retry that keeps the
// card mounted and focus put, independent summaries, banner wording that matches what the server decoded, and the
// tester's opt-in behaviours (stable Execute name, Clear that keeps focus, results tied to their token, secondary Sign in).
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { flushEffects } from '../../test-utils/flushEffects';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import bffAxios from '../../services/bffAxios';
import ResourceServerPage from '../ResourceServerPage';
import ResourceServerTester from '../ResourceServerTester';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/authUi', () => ({
  notifySessionExpiredIfNeeded: vi.fn(),
  navigateToCustomerOAuthLogin: vi.fn(),
}));

const exp = Math.floor(Date.now() / 1000) + 3600;
const loginSummary = {
  accounts: [],
  transactions: [],
  accessTokenClaims: { sub: 'user-1', aud: 'enduser.ping.demo', exp },
  idTokenClaims: { sub: 'user-1', name: 'Demo User' },
  tokenMetadata: { audience: 'enduser.ping.demo', scopes: ['openid'] },
  resourceServerInfo: { name: 'Login', targetAudience: 'enduser.ping.demo', view: 'login' },
};
const inflowSummary = {
  hasMcpToken: true,
  accessTokenClaims: { sub: 'u', aud: 'mcpgateway.ping.demo', exp },
  idTokenClaims: null,
  tokenMetadata: { audience: 'mcpgateway.ping.demo', scopes: [] },
  resourceServerInfo: { name: 'In-flow', targetAudience: 'mcpgateway.ping.demo', view: 'inflow' },
};
const route = (login, inflow) => (url) => {
  const v = url === '/api/resource-server/summary' ? login : inflow;
  return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v });
};
const httpError = (status, message) => Object.assign(new Error('http'), { response: { status, data: { message } } });
const renderPage = () => render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  bffAxios.get.mockImplementation(route(loginSummary, inflowSummary));
});

describe('page live region and retry', () => {
  it('the live region is mounted in the loading state and the same node announces the loaded text', async () => {
    const releases = [];
    bffAxios.get.mockImplementation(() => new Promise((r) => { releases.push(r); }));
    renderPage();
    const live = screen.getByTestId('rsv-live');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveTextContent(/Loading/);
    await act(async () => { releases.forEach((r) => r({ data: loginSummary })); });
    await screen.findByRole('tab', { name: /Login RS/i });
    expect(screen.getByTestId('rsv-live')).toBe(live);
    await waitFor(() => expect(live).toHaveTextContent(/summaries loaded/));
  });

  it('a failed load offers Try again as the one primary; the card stays mounted and focus stays while retrying', async () => {
    bffAxios.get.mockImplementation(route(httpError(500, 'boom'), httpError(500, 'boom')));
    const { container } = renderPage();
    const card = await screen.findByTestId('rsv-error');
    expect(container.querySelectorAll('button.pu-btn--primary')).toHaveLength(1);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();

    const releases = [];
    bffAxios.get.mockImplementation(() => new Promise((r) => { releases.push(r); }));
    fireEvent.click(retry);
    expect(screen.getByTestId('rsv-error')).toBe(card);
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(retry);
    expect(screen.getByTestId('rsv-live')).toHaveTextContent(/Retrying/);
    fireEvent.click(retry);
    expect(bffAxios.get).toHaveBeenCalledTimes(4); // 2 first load + 2 retry, the blocked click added none
    await act(async () => { releases.forEach((r) => r({ data: loginSummary })); });
    await screen.findByRole('tab', { name: /Login RS/i });
  });

  it('after a successful retry the dropped Try again focus lands on the active tab', async () => {
    bffAxios.get.mockImplementation(route(httpError(500, 'boom'), httpError(500, 'boom')));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    bffAxios.get.mockImplementation(route(loginSummary, inflowSummary));
    await flushEffects(); // run the first render's pending passive effects before interacting
    fireEvent.click(retry);
    const tab = await screen.findByRole('tab', { name: /Login RS/i });
    await waitFor(() => expect(document.activeElement).toBe(tab));
  });

  it('a failed retry keeps the error card and shows the new reason', async () => {
    bffAxios.get.mockImplementation(route(httpError(500, 'first'), httpError(500, 'first')));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    bffAxios.get.mockImplementation(route(httpError(500, 'second'), httpError(500, 'second')));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('rsv-error')).toHaveTextContent('second'));
    expect(screen.getByTestId('rsv-error')).not.toHaveTextContent('first');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
  });

  it('one summary failing does not blank the other view, and the error does not leak into it', async () => {
    bffAxios.get.mockImplementation(route(loginSummary, httpError(500, 'inflow down')));
    renderPage();
    await screen.findByTestId('rsv-access-claims');
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/REAL SESSION TOKENS/);
    fireEvent.click(screen.getByRole('tab', { name: /In-flow RS/i }));
    expect(screen.getByTestId('rsv-error')).toHaveTextContent('inflow down');
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/NOT LOADED/);
    expect(screen.getByTestId('rsv-live')).toHaveTextContent(/In-flow RS summary: inflow down/);
    fireEvent.click(screen.getByRole('tab', { name: /Login RS/i }));
    expect(screen.queryByTestId('rsv-error')).toBeNull();
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/REAL SESSION TOKENS/);
  });

  it('signed out: a 401 on either summary shows the sign-in prompt and says so in the live region', async () => {
    bffAxios.get.mockImplementation(route(loginSummary, httpError(401, 'no')));
    renderPage();
    await screen.findByText(/Sign in required/i);
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/SIGNED OUT/);
    expect(screen.getByTestId('rsv-live')).toHaveTextContent(/Signed out/);
  });
});

describe('banner wording follows what the server decoded', () => {
  it('login: empty claim objects (opaque tokens) are not called real decoded session tokens', async () => {
    bffAxios.get.mockImplementation(route({ ...loginSummary, accessTokenClaims: {}, idTokenClaims: {} }, inflowSummary));
    renderPage();
    await screen.findByRole('tab', { name: /Login RS/i });
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/NO CLAIMS DECODED/);
    expect(screen.getByTestId('rsv-banner')).not.toHaveTextContent(/REAL SESSION TOKENS/);
    expect(screen.queryByText('Decoded from the token')).toBeNull();
    expect(screen.getByText('No claims').className).toMatch(/pu-chip--neutral/);
  });

  it('in-flow: a cached token that decodes to {} is "not readable", not "decoded" and not "no token yet"', async () => {
    bffAxios.get.mockImplementation(route(loginSummary, { ...inflowSummary, accessTokenClaims: {} }));
    renderPage();
    await screen.findByRole('tab', { name: /Login RS/i });
    fireEvent.click(screen.getByRole('tab', { name: /In-flow RS/i }));
    const banner = screen.getByTestId('rsv-banner');
    expect(banner).toHaveTextContent(/GATEWAY TOKEN NOT READABLE/);
    expect(banner).not.toHaveTextContent(/REAL GATEWAY TOKEN|NO GATEWAY TOKEN YET/);
    expect(screen.queryByText('Decoded from the token')).toBeNull();
  });
});

describe('tester opt-in Ping UI mode', () => {
  const ping = { executeButtonClassName: 'pu-btn pu-btn--primary', secondaryButtonClassName: 'pu-btn' };
  const revealOk = { token: 'a.b.c', claims: { sub: 'u' } };

  it('has an always-mounted status line; Execute keeps its name while running and the line announces it', async () => {
    let release;
    bffAxios.post.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<ResourceServerTester {...ping} />);
    const live = screen.getByTestId('rst-live');
    expect(live).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    expect(screen.getByTestId('rst-live')).toBe(live);
    expect(live).toHaveTextContent(/Running Show Token/);
    expect(screen.getAllByRole('button', { name: 'Execute' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Running/ })).toBeNull();
    await act(async () => { release({ data: revealOk }); });
    await waitFor(() => expect(live).toHaveTextContent(/Show Token finished: token shown/));
  });

  it('default mode is unchanged: no status line, the Running... label', () => {
    bffAxios.post.mockImplementation(() => new Promise(() => {}));
    render(<ResourceServerTester />);
    expect(screen.queryByTestId('rst-live')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    expect(screen.getAllByRole('button', { name: 'Running...' }).length).toBeGreaterThan(0);
  });

  it('Clear empties the result, keeps the form mounted and focus on Clear, and Execute is still there', async () => {
    bffAxios.post.mockResolvedValue({ data: revealOk });
    render(<ResourceServerTester {...ping} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    await screen.findByText('Raw JWT');
    const clear = screen.getAllByRole('button', { name: 'Clear' })[0];
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByText('Raw JWT')).toBeNull();
    expect(document.activeElement).toBe(clear);
    expect(screen.getAllByRole('button', { name: 'Execute' })).toHaveLength(2);
    expect(screen.getByTestId('rst-live')).toHaveTextContent(/has not run yet/);
    // re-selecting the same operation does not bring the cleared result back
    fireEvent.click(screen.getByRole('button', { name: /Real RS Validation/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show Token/i }));
    expect(screen.queryByText('Raw JWT')).toBeNull();
  });

  it('a result is dropped when the token source changes, so it is never shown against the wrong token', async () => {
    bffAxios.post.mockResolvedValue({ data: revealOk });
    render(<ResourceServerTester {...ping} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    await screen.findByText('Raw JWT');
    fireEvent.click(screen.getByRole('button', { name: /My ID token/i }));
    expect(screen.queryByText('Raw JWT')).toBeNull();
    expect(screen.getByTestId('rst-live')).toHaveTextContent(/has not run yet/);
  });

  it('a failed run is announced with its status, and the 401 Sign in is a secondary (the one primary stays Execute)', async () => {
    bffAxios.post.mockRejectedValue({ response: { status: 401, data: {} }, message: 'x' });
    const { container } = render(<ResourceServerTester {...ping} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    await waitFor(() => expect(screen.getByTestId('rst-live')).toHaveTextContent(/Show Token failed \(401\)/));
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(signIn.className).toBe('pu-btn');
    expect(container.querySelectorAll('.rst-signin')).toHaveLength(0);
    expect(container.querySelectorAll('button.pu-btn--primary')).toHaveLength(1);
  });

  it('a blocked Execute is described by a reason with a theme token ink, not an inline hex', () => {
    const { container } = render(<ResourceServerTester {...ping} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste a JWT/i }));
    const reason = container.querySelector('#rst-blocked-reason');
    expect(reason).toHaveTextContent(/Paste a JWT token above/);
    expect(reason.getAttribute('style')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Execute' })[0]).toHaveAttribute('aria-describedby', 'rst-blocked-reason');
  });

  it('editing the pasted JWT drops a stale result', async () => {
    bffAxios.post.mockResolvedValue({ data: revealOk });
    render(<ResourceServerTester {...ping} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste a JWT/i }));
    fireEvent.change(screen.getByPlaceholderText('eyJ...'), { target: { value: 'a.b.c' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
    await screen.findByText('Raw JWT');
    fireEvent.change(screen.getByPlaceholderText('eyJ...'), { target: { value: 'a.b.d' } });
    expect(screen.queryByText('Raw JWT')).toBeNull();
  });
});

describe('page CSS', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../ResourceServerPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  css.replace(/(?:^|[}\n])\s*([^{}@][^{}]*)\{/g, (_, sel) => { selectors.push(...sel.split(',').map((x) => x.trim())); return ''; });

  it('every selector is scoped under .pu-page.rsv-page', () => {
    expect(selectors.length).toBeGreaterThan(20);
    const loose = selectors.filter((sel) => sel && !sel.startsWith('@') && !/^(:root\[data-theme='dark'\] )?\.pu-page\.rsv-page\b/.test(sel));
    expect(loose).toEqual([]);
  });

  it('every rule that sets a ground also sets its ink (tester overrides)', () => {
    const rules = css.split('}').map((r) => r.split('{')).filter((p) => p.length === 2);
    const bad = rules.filter(([sel, body]) => /(^|[;\s])background(-color)?\s*:\s*(var\(--th-|#)/.test(body) && !/(^|[;\s])color\s*:/.test(body)).map(([sel]) => sel.trim());
    expect(bad).toEqual([]);
  });

  it('the hard-coded JSON inks and token inks clear 4.5:1 on their grounds in both themes', () => {
    const idx = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
    const block = (start) => idx.slice(idx.indexOf(start), idx.indexOf('\n}', idx.indexOf(start)));
    const tokens = (b) => Object.fromEntries([...b.matchAll(/(--th-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
    const light = tokens(block(':root {\n') + block('  --th-bg-page: #f6f7f9'));
    const dark = tokens(block(':root[data-theme="dark"] {'));
    const lum = (h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const must = [
      ['#166534', light['--th-bg-inset']], ['#92400e', light['--th-bg-inset']],
      ['#79c0ff', dark['--th-bg-inset']], ['#7ee787', dark['--th-bg-inset']], ['#ffa657', dark['--th-bg-inset']], ['#ff6b6b', dark['--th-bg-inset']],
      [light['--th-status-error-text'], light['--th-bg-card']], [dark['--th-status-error-text'], dark['--th-bg-card']],
      [light['--th-status-error-text'], light['--th-status-error-bg']], [dark['--th-status-error-text'], dark['--th-status-error-bg']],
    ];
    for (const [ink, ground] of must) {
      expect(ink && ground, `${ink} on ${ground}`).toBeTruthy();
      expect(ratio(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
