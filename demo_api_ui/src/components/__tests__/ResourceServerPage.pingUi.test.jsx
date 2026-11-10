// ResourceServerPage.pingUi.test.jsx
// Ping UI conversion of /resource-server: banner first and honest per state, one primary button, tablist keyboard,
// and the tester's opt-in buttons (aria-disabled keeps focus; the default look is unchanged).
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import bffAxios from '../../services/bffAxios';
import ResourceServerPage from '../ResourceServerPage';
import ResourceServerTester from '../ResourceServerTester';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));

const exp = Math.floor(Date.now() / 1000) + 3600;
const loginSummary = {
  accounts: [{ id: 'a1', accountType: 'checking', name: 'Checking', balance: 100, currency: 'USD', accountNumber: '****1234' }],
  transactions: [{ id: 't1', description: 'Coffee', amount: -4.5 }],
  accessTokenClaims: { sub: 'user-1', aud: 'enduser.ping.demo', exp, jti: 'A'.repeat(100), act: { sub: 'agent-1' } },
  idTokenClaims: { sub: 'user-1', name: 'Demo User' },
  tokenMetadata: { audience: 'enduser.ping.demo', scopes: ['openid', 'banking:accounts'] },
  resourceServerInfo: { name: 'Banking API Resource Server (Login)', targetAudience: 'enduser.ping.demo', view: 'login' },
};
const inflowSummary = {
  hasMcpToken: false,
  accessTokenClaims: null,
  idTokenClaims: null,
  tokenMetadata: null,
  resourceServerInfo: { name: 'In-flow', targetAudience: 'mcpgateway.ping.demo', probeHint: '/api/resource-server/identity', view: 'inflow' },
};

const renderPage = () => render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  bffAxios.get.mockImplementation((url) => Promise.resolve({
    data: url === '/api/resource-server/summary' ? loginSummary : inflowSummary,
  }));
});

describe('ResourceServerPage on the Ping UI primitives', () => {
  it('puts the banner (role=note) before the title and says what is real and what is demo data', async () => {
    renderPage();
    const banner = await screen.findByTestId('rsv-banner');
    const note = within(document.body).getByRole('note');
    expect(note).toBe(banner);
    expect(note).toHaveTextContent(/REAL SESSION TOKENS, DEMO BANK DATA/);
    expect(note).toHaveTextContent(/not a real bank/);
    const h1 = screen.getByRole('heading', { level: 1, name: /OIDC Resource Server/i });
    expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('has exactly one primary button, the top Execute; the bottom Execute and Clear are secondary', async () => {
    const { container } = renderPage();
    await screen.findByTestId('rsv-banner');
    const primaries = container.querySelectorAll('button.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Execute');
    expect(container.querySelectorAll('.inspector-shell-form-actions--top .pu-btn--primary')).toHaveLength(1);
    const executes = screen.getAllByRole('button', { name: 'Execute' });
    expect(executes).toHaveLength(2);
    expect(executes[1].className).toBe('pu-btn');
    expect(container.querySelector('.inspector-shell-btn-call')).toBeNull();
  });

  it('no longer carries its own dark/light toggle (the app shell has one) and has no inline styles on the page', async () => {
    const { container } = renderPage();
    await screen.findByTestId('rsv-banner');
    expect(screen.queryByRole('button', { name: /dark mode|light mode/i, pressed: true })).toBeNull();
    expect(container.querySelector('.rsp-theme-toggle')).toBeNull();
    const page = container.querySelector('.rsv-page');
    const inlineOnPage = [...page.querySelectorAll('[style]')].filter((el) => !el.closest('[class*="inspector-shell"]') && !el.parentElement.closest('[class*="inspector-shell"]'));
    expect(inlineOnPage.map((e) => e.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('tells the truth when signed out: a SIGNED OUT banner, not the real-tokens text', async () => {
    bffAxios.get.mockRejectedValue({ response: { status: 401 } });
    renderPage();
    const banner = await screen.findByTestId('rsv-banner');
    expect(await screen.findByText(/Sign in required/i)).toBeInTheDocument();
    expect(banner).toHaveTextContent(/SIGNED OUT/);
    expect(banner).not.toHaveTextContent(/REAL SESSION TOKENS/);
  });

  it('tells the truth when the load fails: NOT LOADED banner and an alert with the reason', async () => {
    bffAxios.get.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    renderPage();
    const banner = await screen.findByTestId('rsv-banner');
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(banner).toHaveTextContent(/NOT LOADED/);
    expect(banner).not.toHaveTextContent(/REAL SESSION TOKENS/);
  });

  it('in-flow without a cached token says there is no gateway token (neutral chip), not that claims are decoded', async () => {
    renderPage();
    await screen.findByTestId('rsv-banner');
    fireEvent.click(screen.getByRole('tab', { name: /In-flow RS/i }));
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/NO GATEWAY TOKEN YET/);
    expect(screen.getByTestId('rsv-banner')).not.toHaveTextContent(/decoded by the demo API from the gateway token/);
    expect(screen.getByText('No TX token yet').className).toMatch(/pu-chip--neutral/);
  });

  it('in-flow with a cached token shows the decoded-token banner and an ok chip', async () => {
    bffAxios.get.mockImplementation((url) => Promise.resolve({
      data: url === '/api/resource-server/summary'
        ? loginSummary
        : { ...inflowSummary, hasMcpToken: true, accessTokenClaims: { sub: 'u', aud: 'mcpgateway.ping.demo', exp }, tokenMetadata: { audience: 'mcpgateway.ping.demo', scopes: [] } },
    }));
    renderPage();
    await screen.findByTestId('rsv-banner');
    fireEvent.click(screen.getByRole('tab', { name: /In-flow RS/i }));
    expect(screen.getByTestId('rsv-banner')).toHaveTextContent(/REAL GATEWAY TOKEN/);
    expect(screen.getByText('TX token cached').className).toMatch(/pu-chip--ok/);
  });

  it('marks audience and expiry with chips that carry words', async () => {
    renderPage();
    await screen.findByTestId('rsv-access-claims');
    expect(screen.getByText('This resource server').className).toMatch(/pu-chip--ok/);
    expect((await screen.findByText(/remaining/)).className).toMatch(/pu-chip--ok/);
  });

  it('a 100-character unbroken claim value stays in the DOM unmodified', async () => {
    renderPage();
    expect(await screen.findByText('A'.repeat(100))).toBeInTheDocument();
  });

  it('tabs: roving tabindex, arrow keys move selection and focus, panel is labelled by the tab', async () => {
    renderPage();
    const login = await screen.findByRole('tab', { name: /Login RS/i });
    const inflow = screen.getByRole('tab', { name: /In-flow RS/i });
    expect(login).toHaveAttribute('tabindex', '0');
    expect(inflow).toHaveAttribute('tabindex', '-1');
    login.focus();
    fireEvent.keyDown(login, { key: 'ArrowRight' });
    expect(inflow).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(inflow);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rsv-tab-inflow');
    fireEvent.keyDown(inflow, { key: 'Home' });
    expect(login).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(login);
  });
});

describe('ResourceServerTester opt-in Ping UI buttons', () => {
  it('default: unchanged inspector-shell buttons and a real disabled attribute', () => {
    const { container } = render(<ResourceServerTester />);
    expect(container.querySelectorAll('.inspector-shell-btn-call')).toHaveLength(2);
    expect(container.querySelectorAll('.inspector-shell-btn-clear')).toHaveLength(2);
    expect(container.querySelector('.pu-btn')).toBeNull();
  });

  it('opt-in: a blocked Execute is aria-disabled (keeps focus), ignores clicks, and unblocks when a JWT is pasted', () => {
    render(<ResourceServerTester executeButtonClassName="pu-btn pu-btn--primary" secondaryButtonClassName="pu-btn" />);
    fireEvent.click(screen.getByRole('button', { name: /Paste a JWT/i }));
    const [top] = screen.getAllByRole('button', { name: 'Execute' });
    expect(top).toHaveAttribute('aria-disabled', 'true');
    expect(top).not.toBeDisabled();
    top.focus();
    fireEvent.click(top);
    expect(bffAxios.post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(top);
    fireEvent.change(screen.getByPlaceholderText('eyJ...'), { target: { value: 'a.b.c' } });
    expect(screen.getAllByRole('button', { name: 'Execute' })[0]).not.toHaveAttribute('aria-disabled');
  });
});
