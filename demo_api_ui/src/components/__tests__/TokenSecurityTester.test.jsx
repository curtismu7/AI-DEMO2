import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../services/apiClient', () => ({ default: { post } }));

import TokenSecurityTester from '../TokenSecurityTester';

const reply = (overrides = {}) => ({
  data: {
    scenario: 'missing_act',
    scenario_name: 'Missing Act Claim',
    error_code: 'DELEGATION_030',
    http_status: 401,
    error_description: 'Missing delegation claim.',
    teaching_message: 'This token was not issued for delegation.',
    request: { endpoint: '/api/mcp/tool' },
    response: { status: 401 },
    token_details: { sub: 'test-user-123' },
    ...overrides,
  },
});

const renderPage = () => render(<MemoryRouter><TokenSecurityTester /></MemoryRouter>);
const execute = () => screen.getByTestId('tst-execute');
const pick = (name) => fireEvent.click(screen.getByRole('button', { name }));
const primaries = (container) => container.querySelectorAll('button.pu-btn--primary');

describe('TokenSecurityTester (standalone UI standard)', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('puts the banner first, as a note, honest that the whole lesson is simulated', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.tst-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/simulated/i);
    expect(banner.textContent).toMatch(/pre-written/i);
    expect(banner.textContent).toMatch(/not by PingOne/i);
    expect(banner.textContent).toMatch(/no MCP server or gateway is called/i);
    expect(screen.getAllByRole('heading', { level: 1 }).some((h) => h.textContent === 'Token Security Tester')).toBe(true);
  });

  it('has exactly one primary button, Execute, in every state', async () => {
    post.mockResolvedValue(reply());
    const { container } = renderPage();
    expect(primaries(container)).toHaveLength(1);
    expect(execute().className).toContain('pu-btn--primary');
    pick('Missing Act Claim');
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(execute());
    expect(primaries(container)).toHaveLength(1);
    await screen.findByTestId('tst-result');
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('tst-clear'));
    expect(primaries(container)).toHaveLength(1);
  });

  it('keeps Execute focusable but inert until a scenario is picked, and says why', () => {
    renderPage();
    execute().focus();
    expect(execute().getAttribute('aria-disabled')).toBe('true');
    expect(execute().disabled).toBe(false);
    expect(document.getElementById(execute().getAttribute('aria-describedby')).textContent).toMatch(/pick a scenario first/i);
    fireEvent.click(execute());
    expect(post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(execute());
    pick('Missing Act Claim');
    expect(execute().getAttribute('aria-disabled')).toBeNull();
  });

  it('calls the scenario endpoint and shows a simulated, word-bearing rejection', async () => {
    post.mockResolvedValue(reply());
    renderPage();
    pick('Missing Act Claim');
    execute().focus();
    fireEvent.click(execute());
    expect(post).toHaveBeenCalledWith('/api/test/token-validation/scenario/missing-act');
    const card = await screen.findByTestId('tst-result');
    // the reply is pre-written, so the chip says so and does not wear the danger tone of a real verdict
    expect(card.className).not.toContain('pu-card--danger');
    expect(card.querySelector('.pu-chip').textContent.trim()).toBe('Simulated rejection');
    expect(card.querySelector('.pu-chip').className).toContain('pu-chip--info');
    expect(card.querySelector('.pu-chip').className).not.toContain('pu-chip--danger');
    // a live region that mounts together with its text is often not announced: the card is not one
    expect(card.getAttribute('role')).toBeNull();
    expect(card.textContent).toMatch(/simulated/i);
    expect(card.querySelector('dl.pu-kv').textContent).toMatch(/DELEGATION_030/);
    expect(card.querySelector('dl.pu-kv').textContent).toMatch(/401/);
    // focus stays on the control that was pressed
    expect(document.activeElement).toBe(execute());
  });

  it('keeps Execute focused and inert (aria-disabled) while the call is in flight', async () => {
    let finish;
    post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPage();
    pick('Missing Act Claim');
    execute().focus();
    fireEvent.click(execute());
    expect(execute().textContent).toMatch(/executing/i);
    expect(execute().getAttribute('aria-disabled')).toBe('true');
    expect(execute().disabled).toBe(false);
    expect(document.activeElement).toBe(execute());
    fireEvent.click(execute());
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { finish(reply()); });
    expect(await screen.findByTestId('tst-result')).not.toBeNull();
    expect(execute().textContent).toBe('Execute');
  });

  it('labels the token tab as a lesson token and the request tab as built by the BFF', async () => {
    post.mockResolvedValue(reply());
    renderPage();
    pick('Missing Act Claim');
    fireEvent.click(execute());
    await screen.findByTestId('tst-result');
    fireEvent.click(screen.getByRole('button', { name: 'Token Details' }));
    expect(screen.getByText(/PingOne did not issue it/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request/Response' }));
    expect(screen.getByText(/Nothing was sent to the endpoint named here/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Teaching' }));
    expect(screen.getByText(/not issued for delegation/i)).not.toBeNull();
  });

  it('announces a failed call as an alert with a word-bearing chip, and Execute stays available to retry', async () => {
    post.mockRejectedValue({ response: { data: { message: 'Token validation test routes are disabled in production.' } } });
    const { container } = renderPage();
    pick('Expired Token');
    fireEvent.click(execute());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/disabled in production/);
    expect(alert.querySelector('.pu-chip').textContent.trim()).toBe('Failed');
    expect(execute().getAttribute('aria-disabled')).toBeNull();
    expect(primaries(container)).toHaveLength(1);
  });

  it('drops a reply that arrives after another scenario was picked (no result leaks across scenarios)', async () => {
    let finish;
    post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPage();
    pick('Missing Act Claim');
    fireEvent.click(execute());
    pick('Expired Token');
    await act(async () => { finish(reply()); });
    expect(screen.queryByTestId('tst-result')).toBeNull();
    expect(execute().getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByText(/Click Execute to run the scenario/i)).not.toBeNull();
  });

  it('keeps focus on Clear when it is pressed, and returns to the empty state', async () => {
    post.mockResolvedValue(reply());
    renderPage();
    pick('Missing Act Claim');
    fireEvent.click(execute());
    await screen.findByTestId('tst-result');
    const clear = screen.getByTestId('tst-clear');
    clear.focus();
    fireEvent.click(clear);
    expect(document.activeElement).toBe(clear);
    expect(screen.queryByTestId('tst-result')).toBeNull();
    expect(execute().getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => expect(screen.getByText(/Select a scenario from the list/i)).not.toBeNull());
  });

  it('wraps a long unbroken value in a key-value cell, not a native input', async () => {
    const long = 'X'.repeat(100);
    post.mockResolvedValue(reply({ error_code: long }));
    renderPage();
    pick('Missing Act Claim');
    fireEvent.click(execute());
    const card = await screen.findByTestId('tst-result');
    expect(card.querySelector('dl.pu-kv').textContent).toContain(long);
    expect(document.querySelectorAll('input[readonly]')).toHaveLength(0);
  });

  it('announces the outcome through the persistent hint live region, whose text changes', async () => {
    post.mockResolvedValue(reply());
    renderPage();
    pick('Missing Act Claim');
    const hint = document.getElementById('tst-exec-hint');
    expect(hint.getAttribute('role')).toBe('status');
    expect(hint.textContent).toMatch(/mints a test token/i);
    fireEvent.click(execute());
    expect(document.getElementById('tst-exec-hint')).toBe(hint);
    expect(hint.textContent).toMatch(/asking the bff/i);
    await screen.findByTestId('tst-result');
    expect(document.getElementById('tst-exec-hint')).toBe(hint);
    expect(hint.textContent).toMatch(/simulated rejection/i);
    expect(hint.textContent).toMatch(/Missing Act Claim/);
    expect(hint.textContent).toMatch(/401/);
    expect(hint.textContent).toMatch(/DELEGATION_030/);
  });

  it('announces a failed run in the hint and no longer tells the person to click Execute to run it', async () => {
    post.mockRejectedValue({ response: { data: { message: 'Nope.' } } });
    renderPage();
    pick('Expired Token');
    expect(screen.getByText(/Click Execute to run the scenario/i)).not.toBeNull();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    expect(document.getElementById('tst-exec-hint').textContent).toMatch(/run failed/i);
    expect(screen.queryByText(/Click Execute to run the scenario/i)).toBeNull();
    expect(screen.getByText(/No result: the run failed/i)).not.toBeNull();
  });

  describe('stacked (phone) layout', () => {
    const realMatchMedia = window.matchMedia;
    const realScroll = window.HTMLElement.prototype.scrollIntoView;
    afterEach(() => {
      window.matchMedia = realMatchMedia;
      window.HTMLElement.prototype.scrollIntoView = realScroll;
    });
    const stub = (narrow) => {
      const scroll = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scroll;
      window.matchMedia = vi.fn((query) => ({
        matches: narrow, media: query, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      }));
      return scroll;
    };

    it('scrolls the result pane into view after a run and leaves focus on Execute', async () => {
      const scroll = stub(true);
      post.mockResolvedValue(reply());
      renderPage();
      pick('Missing Act Claim');
      execute().focus();
      fireEvent.click(execute());
      expect(scroll).not.toHaveBeenCalled();
      await screen.findByTestId('tst-result');
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.instances[0].className).toContain('inspector-shell-col-right');
      expect(document.activeElement).toBe(execute());
    });

    it('does not scroll on the wide, side-by-side layout', async () => {
      const scroll = stub(false);
      post.mockResolvedValue(reply());
      renderPage();
      pick('Missing Act Claim');
      fireEvent.click(execute());
      await screen.findByTestId('tst-result');
      expect(scroll).not.toHaveBeenCalled();
    });
  });

  it('lets the result footer wrap and shrink under the page class (shared shell keeps it nowrap)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../TokenSecurityTester.css'), 'utf8');
    const rule = css.match(/\.pu-page\.tst-page \.inspector-shell-output-footer\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(rule[1]).toMatch(/min-width:\s*0/);
    const cell = css.match(/\.pu-page\.tst-page \.inspector-shell-output-footer > span\s*\{([^}]*)\}/);
    expect(cell[1]).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
