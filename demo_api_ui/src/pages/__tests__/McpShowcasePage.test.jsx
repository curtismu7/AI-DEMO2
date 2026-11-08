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
const mockSignIn = vi.fn();
vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthLogin: (...a) => mockSignIn(...a) }));
vi.mock('../../services/apiClient', () => ({
  default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) },
}));
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'banking' }) }));

import McpShowcasePage from '../McpShowcasePage';

const FLAGS = (enabled = true) => ({
  data: { flags: [{ id: 'ff_weather_mcp_showcase', value: enabled }, { id: 'ff_brave_mcp_showcase', value: enabled }] },
});

// GET routing: the flags endpoint, plus the two session-status endpoints Run's sign-in check reads.
function routeGet({ flags = FLAGS(), user = { data: { authenticated: true } }, admin = { data: { authenticated: false } } } = {}) {
  mockGet.mockImplementation((url) => {
    if (url === '/api/auth/oauth/user/status') return user instanceof Error ? Promise.reject(user) : Promise.resolve(user);
    if (url === '/api/auth/oauth/status') return admin instanceof Error ? Promise.reject(admin) : Promise.resolve(admin);
    return flags instanceof Error ? Promise.reject(flags) : Promise.resolve(flags);
  });
}

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
  mockSignIn.mockReset();
  routeGet();
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
    routeGet({ flags: FLAGS(false) });
    renderPage('weather');
    expect(await screen.findByTestId('mcpsc-disabled')).toBeTruthy();
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
  });

  it('reads Unknown, not Enabled, when the flags cannot be read', async () => {
    routeGet({ flags: new Error('nope') });
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

  it('blocklist: adding a city keeps focus on the button; removing one moves focus to the row that takes its place', async () => {
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
    const denver = screen.getByRole('button', { name: 'Remove Denver' });
    expect(document.activeElement).toBe(denver);
    // removing the only row left falls back to the add-city input
    fireEvent.click(denver);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Denver' })).toBeNull());
    expect(document.activeElement).toBe(input);
  });

  it('blocklist: removing a city moves focus to the row that takes its place, and announces it politely', async () => {
    mockFetch([{ label: 'Miami', lat: 1, lon: 2 }, { label: 'Tampa', lat: 3, lon: 4 }, { label: 'Orlando', lat: 5, lon: 6 }]);
    renderPage('weather');
    const removeTampa = await screen.findByRole('button', { name: 'Remove Tampa' });
    removeTampa.focus();
    fireEvent.click(removeTampa);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Tampa' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Orlando' }));
    const live = document.getElementById('wbl-status');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('Removed Tampa. 2 blocked.');
    // removing the last row falls back to the one before it
    fireEvent.click(screen.getByRole('button', { name: 'Remove Orlando' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Orlando' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Miami' }));
  });

  it('blocklist: adding announces; Block city with nothing typed says what is missing and sends nothing', async () => {
    renderPage('weather');
    const block = await screen.findByRole('button', { name: 'Block city' });
    fireEvent.click(block);
    const live = document.getElementById('wbl-status');
    expect(live.textContent).toMatch(/Enter a city to block first/);
    expect(global.fetch.mock.calls.filter(([, i]) => i && i.method === 'POST')).toHaveLength(0);
    expect(screen.getByLabelText('City to block').getAttribute('aria-describedby')).toBe('wbl-status');
    fireEvent.change(screen.getByLabelText('City to block'), { target: { value: 'Denver' } });
    expect(live.textContent).toBe('');
    fireEvent.click(block);
    await waitFor(() => expect(live.textContent).toBe('Blocked Denver. 1 blocked.'));
  });

  it('an empty free-form ask explains what is missing, for both pages, and clears when typing', async () => {
    const { unmount } = renderPage('weather');
    fireEvent.click(screen.getByRole('button', { name: 'Check weather' }));
    const hint = await screen.findByText('Enter a location first, for example Denver, CO.');
    expect(hint.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check weather' }).getAttribute('aria-describedby')).toBe(hint.id);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Check any location'), { target: { value: 'x' } });
    expect(screen.queryByText(/Enter a location first/)).toBeNull();
    unmount();
    renderPage('brave');
    fireEvent.click(screen.getByRole('button', { name: 'Search news' }));
    expect(await screen.findByText('Enter a search first, for example quantum computing.')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('says on the page that Run needs a signed-in session, in the banner and the section lede', async () => {
    renderPage('weather');
    expect(screen.getByTestId('mcpsc-banner').textContent).toMatch(/needs a signed-in session/);
    expect(document.getElementById('mcpsc-run').nextElementSibling.textContent).toMatch(/Run needs a signed-in session/);
    expect(screen.queryByTestId('mcpsc-signin')).toBeNull();
  });

  it('signed out: Run and the free-form ask say why and neither post nor navigate; Sign in returns here', async () => {
    routeGet({ user: { data: { authenticated: false } }, admin: { data: { authenticated: false } } });
    renderPage('weather');
    const card = await screen.findByTestId('mcpsc-signin');
    expect(within(card).getByText('Signed out')).toBeTruthy();
    const austin = screen.getByRole('button', { name: /^Run what's the weather in Austin/ });
    austin.focus();
    fireEvent.click(austin);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Not started: Run needs a signed-in session/);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(austin.textContent).toBe('Run');
    expect(document.activeElement).toBe(austin);
    fireEvent.change(screen.getByLabelText('Check any location'), { target: { value: 'Denver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check weather' }));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Sign in' }));
    expect(mockSignIn).toHaveBeenCalledWith('/weather-mcp');
    // still one primary, and the sign-in button is secondary
    expect(primaries().length).toBe(1);
  });

  it('signed out on the Brave page returns to /brave-mcp', async () => {
    routeGet({ user: { data: { authenticated: false } }, admin: { data: { authenticated: false } } });
    renderPage('brave');
    fireEvent.click(within(await screen.findByTestId('mcpsc-signin')).getByRole('button', { name: 'Sign in' }));
    expect(mockSignIn).toHaveBeenCalledWith('/brave-mcp');
  });

  it('an admin session counts as signed in; an unreadable session check does not block Run', async () => {
    routeGet({ user: { data: { authenticated: false } }, admin: { data: { authenticated: true } } });
    const { unmount } = renderPage('weather');
    await screen.findByText('Enabled');
    expect(screen.queryByTestId('mcpsc-signin')).toBeNull();
    unmount();
    routeGet({ user: new Error('down'), admin: new Error('down') });
    renderPage('weather');
    await screen.findByText('Enabled');
    expect(screen.queryByTestId('mcpsc-signin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Run what's the weather in Austin/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  });

  it('a run the server refuses with authentication_required shows its sentence and stays on the page', async () => {
    mockPost.mockRejectedValue({ response: { status: 401, data: { error: 'authentication_required', message: 'This step needs you signed in.' } } });
    renderPage('weather');
    fireEvent.click(screen.getByRole('button', { name: /^Run what's the weather in Austin/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This step needs you signed in.');
    expect(alert.textContent).not.toContain('authentication_required');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('Brave has no repeated headings, and the route and file sections are labelled as config', async () => {
    renderPage('brave');
    await screen.findByText('Enabled');
    const names = [...document.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
    expect(screen.queryByRole('heading', { name: 'Blocked terms' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Gateway route' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Blocked search terms' })).toBeTruthy();
    expect(screen.getByText('Gateway route (config)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gateway config files' })).toBeTruthy();
    expect(screen.getByTestId('mcpsc-capability').textContent).toMatch(/not a gateway verdict/);
    expect(screen.getByTestId('mcpsc-terms')).toBeTruthy();
  });

  it('Weather has no repeated headings either', async () => {
    renderPage('weather');
    await screen.findByText('Enabled');
    const names = [...document.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
  });
});
