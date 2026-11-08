import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import LangChainPage from '../LangChainPage';

afterEach(() => vi.unstubAllGlobals());

function stubStatus(body, ok = true) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })));
}

function stubStatusDown() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LangChainPage />
    </MemoryRouter>,
  );
}

const card = () => screen.getByTestId('lcp-active-brain');

describe('LangChainPage (Ping UI Standard)', () => {
  it('puts a banner first, as a note, that says the page is fixed text and only the brain card is live', async () => {
    stubStatus({ provider: 'helix', model: 'gpt-4o-mini', key_set: { helix: true } });
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.lcp').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/fixed text; nothing runs on this page/);
    await waitFor(() => expect(banner.textContent).toMatch(/read from the BFF \(\/api\/langchain\/config\/status\)/));
  });

  it('names the BFF as a source only when it answered; says so when it did not, and never spins forever', async () => {
    stubStatusDown();
    renderPage();
    const banner = screen.getByRole('note');
    expect(banner.textContent).toMatch(/being read from the BFF now/);
    await waitFor(() => expect(banner.textContent).toMatch(/BFF did not answer/));
    expect(banner.textContent).not.toMatch(/is live: it is read from the BFF/);
    expect(within(card()).getByText('Not reachable').className).toContain('pu-chip--warn');
    expect(card().querySelector('dl.pu-kv')).toBeNull();
    expect(card().className).toContain('pu-card--warn');
  });

  it('treats a non-OK answer as unavailable too', async () => {
    stubStatus({ error: 'nope' }, false);
    renderPage();
    await waitFor(() => expect(within(card()).getByText('Not reachable')).toBeTruthy());
  });

  it('shows a configured key as a green chip with the provider and model in a key-value list', async () => {
    stubStatus({ provider: 'helix', model: 'gpt-4o-mini', key_set: { helix: true } });
    renderPage();
    await waitFor(() => expect(within(card()).getByText('Key set')).toBeTruthy());
    expect(within(card()).getByText('Key set').className).toContain('pu-chip--ok');
    expect(card().className).toContain('pu-card--live');
    const kv = card().querySelector('dl.pu-kv');
    expect(kv.textContent).toContain('helix');
    expect(kv.textContent).toContain('gpt-4o-mini');
  });

  it('a missing key is a red chip with the word, not colour alone', async () => {
    stubStatus({ provider: 'google', model: 'gemini-2.0-flash', key_set: { google: false } });
    renderPage();
    await waitFor(() => expect(within(card()).getByText('No key set')).toBeTruthy());
    expect(within(card()).getByText('No key set').className).toContain('pu-chip--danger');
    expect(card().textContent).toMatch(/Set one in Config/);
  });

  it('a local provider needs no key and is neutral, not green', async () => {
    stubStatus({ provider: 'llamacpp', model: 'local', key_set: {} });
    renderPage();
    await waitFor(() => expect(within(card()).getByText('Local, no key')).toBeTruthy());
    expect(within(card()).getByText('Local, no key').className).toContain('pu-chip--neutral');
  });

  it('heuristics (or an empty status) is reported as needing no key, with no model claimed', async () => {
    stubStatus({});
    renderPage();
    await waitFor(() => expect(within(card()).getByText('No key needed')).toBeTruthy());
    expect(within(card()).getByText('No key needed').className).toContain('pu-chip--info');
    expect(card().querySelector('dl.pu-kv').textContent).toMatch(/none \(deterministic NL parser\)/);
  });

  it('keeps the live status in a polite status region so a change is announced', () => {
    stubStatusDown();
    renderPage();
    // the spinner is a live region of its own, so the chip's region must not contain it (no nested announcements)
    const regions = within(card()).getAllByRole('status');
    const region = regions.find((r) => r.querySelector('.pu-chip'));
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('.pu-chip').textContent).toBe('Checking');
    expect(region.querySelector('[role=status]')).toBeNull();
  });

  it('has no action buttons, so no primary button, and no inline styles', async () => {
    stubStatus({ provider: 'helix', model: 'm', key_set: { helix: true } });
    const { container } = renderPage();
    await waitFor(() => expect(within(card()).getByText('Key set')).toBeTruthy());
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('.pu-btn--primary')).toHaveLength(0);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('marks the active brain row with an Active chip only once the BFF answered', async () => {
    stubStatus({ provider: 'google', model: 'gemini-2.0-flash', key_set: { google: true } });
    renderPage();
    const table = screen.getByTestId('lcp-brains');
    expect(table.querySelectorAll('.pu-chip')).toHaveLength(0);
    await waitFor(() => expect(table.querySelectorAll('.pu-chip')).toHaveLength(1));
    const row = within(table).getByText('Active').closest('tr');
    expect(row.textContent).toContain('Google Gemini');
    expect(within(table).getByText('Active').className).toContain('pu-chip--info');
  });

  it('every table cell carries a label so the rows stack readably at phone width', () => {
    stubStatusDown();
    renderPage();
    for (const id of ['lcp-brains', 'lcp-agents']) {
      const table = screen.getByTestId(id);
      const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent);
      table.querySelectorAll('tbody tr').forEach((tr) => {
        expect([...tr.querySelectorAll('td')].map((td) => td.getAttribute('data-label'))).toEqual(heads);
      });
    }
    expect(within(screen.getByTestId('lcp-agents')).getByText('This page').className).toContain('pu-chip--neutral');
  });

  it('code and diagram blocks are named, focusable regions so the keyboard can scroll them', () => {
    stubStatusDown();
    renderPage();
    for (const [id, name] of [['lcp-diagram', /Architecture diagram/], ['lcp-code', /code sample/]]) {
      const pre = screen.getByTestId(id);
      expect(pre.getAttribute('role')).toBe('region');
      expect(pre.getAttribute('aria-label')).toMatch(name);
      expect(pre.tabIndex).toBe(0);
    }
  });

  it('keeps the back and config links, and the section landmarks', () => {
    stubStatusDown();
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('LangChain in AI Demo');
    expect(screen.getByRole('link', { name: /Back/ }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Change in Config/ }).getAttribute('href')).toBe('/config');
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(6);
  });
});
