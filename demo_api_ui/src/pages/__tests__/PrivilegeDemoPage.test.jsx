import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PrivilegeDemoPage from '../PrivilegeDemoPage';
import { PRIVILEGE_DEMO } from '../../config/privilegeDemoConfig';

const openSignIn = vi.fn();
vi.mock('../../utils/signInService', () => ({ openSignIn: (...a) => openSignIn(...a) }));

const toggleDarkMode = vi.fn();
let darkMode = false;
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode, toggleDarkMode }),
}));

const EMPTY_CONFIG = {
  clientId: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '', hasClientSecret: false,
};

function json(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivilegeDemoPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  darkMode = false;
  openSignIn.mockClear();
  toggleDarkMode.mockClear();
  global.fetch = vi.fn().mockImplementation(() => json(EMPTY_CONFIG));
});
afterEach(() => vi.restoreAllMocks());

describe('PrivilegeDemoPage (Ping UI standard)', () => {
  it('puts an honest presenter-guide banner first, as a note, above the title', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const banner = screen.getByTestId('pd-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(container.querySelector('.pd-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/written content/i);
    expect(banner.textContent).toMatch(/Test Connection is the one real call/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PRIVILEGE_DEMO.title);
  });

  it('has exactly one primary button, Save, in every state', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const primaries = () => [...container.querySelectorAll('.pu-btn--primary')];
    const save = screen.getByRole('button', { name: 'Save' });
    expect(primaries()).toEqual([save]);

    // edited
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'c1' } });
    expect(primaries()).toEqual([save]);

    // saving, then saved
    let release;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts && opts.method === 'PUT') {
        return new Promise((resolve) => { release = () => resolve({ ok: true, json: () => Promise.resolve({ ...EMPTY_CONFIG, clientId: 'c1' }) }); });
      }
      return json({});
    });
    fireEvent.click(save);
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBe(save);
    expect(primaries()).toEqual([save]);
    release();
    await screen.findByText('Saved');
    expect(primaries()).toEqual([save]);

    // with a test result on screen
    global.fetch = vi.fn().mockImplementation(() => json({ step: 'mcp', status: 401, body: { error: 'invalid_token' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText(/invalid_token/);
    expect(primaries()).toEqual([save]);

    // Sign in, the theme switch and Test Connection are secondaries
    for (const name of ['Sign in', /switch to dark mode/i, 'Test Connection']) {
      expect(screen.getByRole('button', { name }).className).not.toContain('primary');
    }
    expect(container.querySelectorAll('button').length).toBe(4);
  });

  it('shows personas as cards with kv rows and a console link that names the persona', async () => {
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    for (const persona of Object.values(PRIVILEGE_DEMO.personas)) {
      const card = screen.getByTestId(`pd-persona-${persona.id}`);
      expect(card.className).toContain('pu-card');
      expect(within(card).getByRole('heading', { name: persona.label })).toBeTruthy();
      expect(card.querySelector('dl.pu-kv').textContent).toContain(persona.email);
      const link = within(card).getByRole('link', { name: new RegExp(persona.label) });
      expect(link.getAttribute('href')).toContain('console.pingone.com/?env=');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('says plainly that readiness is written status, with a word on each chip', async () => {
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const card = screen.getByTestId('pd-readiness');
    const chips = [...card.querySelectorAll('.pu-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Passing', 'Blocked']);
    expect(chips[0].className).toContain('pu-chip--ok');
    expect(chips[1].className).toContain('pu-chip--warn');
    expect(card.textContent).toMatch(/not re-checked here/i);
    expect(card.textContent).toMatch(/docs\/demo-readiness\.md/);
  });

  it('keeps the guide link, the related links, Sign in and the theme switch working', async () => {
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const guide = screen.getByRole('link', { name: /SE1 — Privilege Shared Demo guide/ });
    expect(guide.getAttribute('href')).toBe(PRIVILEGE_DEMO.se1GuideUrl);
    expect(screen.getByRole('link', { name: 'Banking demo setup' }).getAttribute('href')).toBe('/setup');
    expect(screen.getByRole('link', { name: 'MCP observability' }).getAttribute('href')).toBe('/mcp-observability');
    expect(screen.getByRole('link', { name: 'Kibana logs' }).getAttribute('target')).toBe('_blank');

    fireEvent.click(screen.getByTestId('pd-signin'));
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: '/privilege-demo' });

    fireEvent.click(screen.getByTestId('pd-theme-toggle'));
    expect(toggleDarkMode).toHaveBeenCalledTimes(1);
  });

  it('labels the theme switch by what it will do', async () => {
    darkMode = true;
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByTestId('pd-theme-toggle').textContent).toBe('Switch to light mode');
  });

  it('labels the registration as written, not read from the gateway, and the test result with a word', async () => {
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const reg = screen.getByTestId('poc-registration');
    expect(reg.textContent).toMatch(/not read from the gateway/i);
    expect(reg.querySelector('dl.pu-kv').textContent).toContain('banking-mcp');
    expect(screen.queryByText('Live')).toBeNull();

    global.fetch = vi.fn().mockImplementation(() => json({ error: 'save clientId first' }, false));
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    const result = await screen.findByTestId('poc-test-result');
    expect(within(result).getByText('Not completed').className).toContain('pu-chip--warn');

    global.fetch = vi.fn().mockImplementation(() => json({ step: 'mcp', status: 401, body: { error: 'invalid_token' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() => expect(within(screen.getByTestId('poc-test-result')).getByText('Refused').className).toContain('pu-chip--danger'));
  });
});
