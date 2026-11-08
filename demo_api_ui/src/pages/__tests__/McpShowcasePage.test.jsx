import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => mockNavigate,
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) },
}));
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'banking' }) }));

import McpShowcasePage from '../McpShowcasePage';

const FLAGS = (enabled = true) => ({
  data: { flags: [{ id: 'ff_weather_mcp_showcase', value: enabled }, { id: 'ff_brave_mcp_showcase', value: enabled }] },
});

function mockFetch(cities = []) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (String(url).startsWith('/api/weather-blocklist')) {
      if (method === 'POST') {
        cities = [...cities, { label: JSON.parse(init.body).city, lat: 1, lon: 2 }];
      } else if (method === 'DELETE') {
        const label = decodeURIComponent(String(url).split('/').pop());
        cities = cities.filter((c) => c.label !== label);
      }
      return { ok: true, json: async () => ({ cities }) };
    }
    return { ok: true, json: async () => ({ flags: [] }) };
  });
}

function renderPage(capability = 'weather') {
  return render(
    <MemoryRouter>
      <McpShowcasePage capability={capability} />
    </MemoryRouter>,
  );
}

const primaries = () => document.querySelectorAll('button.pu-btn--primary');

beforeEach(() => {
  mockNavigate.mockReset();
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue(FLAGS());
  mockPost.mockResolvedValue({ data: { useCaseId: 'weather-mcp-texas-permit', triggerText: 'hi', type: 'x' } });
  mockFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('McpShowcasePage on the Ping UI primitives', () => {
  it('puts an honest banner first, then the title band, frame, cards, kv and word-bearing chips', async () => {
    const { container } = renderPage('weather');
    const root = container.firstElementChild;
    expect(root.classList.contains('pu-page')).toBe(true);
    const banner = screen.getByTestId('mcpsc-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(root.firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/no verdict here/i);
    expect(banner.textContent).toMatch(/not an outcome/i);
    expect(screen.getByRole('heading', { level: 1, name: 'Weather MCP' })).toBeTruthy();
    expect(document.querySelector('.pu-frame')).toBeTruthy();
    expect(document.querySelectorAll('.pu-card').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelector('dl.pu-kv')).toBeTruthy();
    expect(await screen.findByText('Enabled')).toBeTruthy();
    document.querySelectorAll('.pu-chip').forEach((chip) => {
      expect(chip.textContent.trim().length).toBeGreaterThan(0);
    });
    // The scripted runs say "Expected", never a bare PERMIT / DENY that could pass for a result.
    expect(screen.getByText('Expected: permit')).toBeTruthy();
    expect(screen.getByText('Expected: deny')).toBeTruthy();
    expect(screen.queryByText('PERMIT')).toBeNull();
  });

  it('shows the Disabled chip and the 403 card when the capability flag is off', async () => {
    mockGet.mockResolvedValue(FLAGS(false));
    renderPage('weather');
    expect(await screen.findByTestId('mcpsc-disabled')).toBeTruthy();
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
  });

  it('reads Unknown, not Enabled, when the flags cannot be read', async () => {
    mockGet.mockRejectedValue(new Error('nope'));
    renderPage('weather');
    expect(await screen.findByText('Unknown')).toBeTruthy();
    expect(screen.queryByText('Enabled')).toBeNull();
  });

  it('has exactly one primary per view state: first Run, then the free-form ask, then the pressed control', async () => {
    let release;
    mockPost.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderPage('weather');
    // idle
    expect(primaries().length).toBe(1);
    const austin = screen.getByRole('button', { name: /^Run what's the weather in Austin/ });
    const miami = screen.getByRole('button', { name: /^Run what's the weather in Miami/ });
    expect(austin.classList.contains('pu-btn--primary')).toBe(true);
    // text entered: the ask button takes over
    fireEvent.change(screen.getByLabelText('Check any location'), { target: { value: 'Denver, CO' } });
    expect(primaries().length).toBe(1);
    expect(screen.getByRole('button', { name: 'Check weather' }).classList.contains('pu-btn--primary')).toBe(true);
    expect(austin.classList.contains('pu-btn--primary')).toBe(false);
    // a run starting: the pressed control, even when it was secondary
    fireEvent.click(miami);
    await waitFor(() => expect(miami.textContent).toBe('Starting…'));
    expect(primaries().length).toBe(1);
    expect(miami.classList.contains('pu-btn--primary')).toBe(true);
    await act(async () => { release({ data: { useCaseId: 'weather-mcp-texas-deny', triggerText: 't' } }); });
  });

  it('keeps every button free of the disabled attribute and every button in a pu-btn class', async () => {
    renderPage('weather');
    await screen.findByText('Enabled');
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    buttons.forEach((b) => {
      expect(b.hasAttribute('disabled')).toBe(false);
      expect(b.classList.contains('pu-btn')).toBe(true);
    });
  });

  it('runs a scripted case: posts it, navigates to the dashboard, and ignores a second press in flight', async () => {
    let release;
    mockPost.mockImplementation((url) => (url === '/api/use-cases/demo/run'
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ data: {} })));
    renderPage('weather');
    const austin = screen.getByRole('button', { name: /^Run what's the weather in Austin/ });
    austin.focus();
    fireEvent.click(austin);
    await waitFor(() => expect(austin.getAttribute('aria-disabled')).toBe('true'));
    // focus stays on the button while the request is in flight
    expect(document.activeElement).toBe(austin);
    fireEvent.click(austin);
    fireEvent.click(screen.getByRole('button', { name: /^Run what's the weather in Miami/ }));
    expect(mockPost.mock.calls.filter(([u]) => u === '/api/use-cases/demo/run').length).toBe(1);
    await act(async () => { release({ data: { useCaseId: 'weather-mcp-texas-permit', triggerText: 'go', type: 't' } }); });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0][0]).toBe('/dashboard');
    expect(mockNavigate.mock.calls[0][1].state.triggerText).toBe('go');
  });

  it('on a failed run shows a word-bearing alert, re-arms the buttons and keeps keyboard focus', async () => {
    mockPost.mockRejectedValue({ response: { data: { error: 'Use case disabled' } } });
    renderPage('weather');
    const austin = screen.getByRole('button', { name: /^Run what's the weather in Austin/ });
    austin.focus();
    fireEvent.click(austin);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Error');
    expect(alert.textContent).toContain('Use case disabled');
    expect(austin.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(austin);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('free-form ask sends the prompt to the dashboard; an empty ask does nothing', async () => {
    renderPage('weather');
    const ask = screen.getByRole('button', { name: 'Check weather' });
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(ask);
    expect(mockPost).not.toHaveBeenCalled();
    const input = screen.getByLabelText('Check any location');
    fireEvent.change(input, { target: { value: ' Denver, CO ' } });
    expect(ask.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(ask);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith('/api/verticals/active', { id: 'banking' });
    expect(mockNavigate.mock.calls[0][1].state.triggerText).toBe("what's the weather in Denver, CO");
    expect(mockNavigate.mock.calls[0][1].state.useCaseId).toBeUndefined();
  });

  it('the weather controls are live settings; the Brave terms are read-only', async () => {
    const { unmount } = renderPage('weather');
    expect(screen.getByTestId('mcpsc-scope').textContent).toContain('Live setting');
    expect(screen.getByLabelText('Allowed state').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Allowed state').classList.contains('pu-select')).toBe(true);
    unmount();
    renderPage('brave');
    expect(screen.getByRole('heading', { level: 1, name: 'Brave Search MCP' })).toBeTruthy();
    expect(screen.getByTestId('mcpsc-banner').textContent).toMatch(/read-only policy/i);
    const terms = screen.getByTestId('mcpsc-terms');
    expect(within(terms).getByText('Read-only')).toBeTruthy();
    expect(within(terms).getByText('bitcoin')).toBeTruthy();
    expect(screen.queryByLabelText('Allowed state')).toBeNull();
    expect(primaries().length).toBe(1);
  });

  it('blocklist: adding a city keeps focus on the button; removing one moves focus to the input', async () => {
    mockFetch([{ label: 'Miami', lat: 25.7, lon: -80.2 }]);
    renderPage('weather');
    const remove = await screen.findByRole('button', { name: 'Remove Miami' });
    const input = screen.getByLabelText('City to block');
    const block = screen.getByRole('button', { name: 'Block city' });
    expect(block.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(input, { target: { value: 'Denver' } });
    block.focus();
    fireEvent.click(block);
    await screen.findByRole('button', { name: 'Remove Denver' });
    expect(document.activeElement).toBe(block);
    expect(block.hasAttribute('disabled')).toBe(false);
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Miami' })).toBeNull());
    expect(document.activeElement).toBe(input);
  });
});
