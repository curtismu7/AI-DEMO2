import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PingOneSetup from '../PingOneSetup';

const DEFAULTS = { environmentId: 'env-1', clientId: 'client-1', clientSecret: 'secret-1' };
const ok = { success: true, error: null };

const passed = {
  success: true,
  steps: {
    tokenAcquisition: ok,
    gatewayConnectivity: ok,
    toolCall: { success: true, error: null, toolsFound: 7, tools: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name })) },
  },
  nextSteps: ['Restart the BFF'],
};

// What the server returns when the token step fails: the later steps are never reached, so they have no error.
const tokenFailed = {
  success: false,
  steps: {
    tokenAcquisition: { success: false, error: 'invalid_client' },
    gatewayConnectivity: { success: false, error: null },
    toolCall: { success: false, error: null, toolsFound: 0, tools: [] },
  },
  nextSteps: ['Check credentials in PingOne console'],
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

let postHandler;
let defaultsHandler;
let calls;

beforeEach(() => {
  calls = [];
  defaultsHandler = () => json(200, DEFAULTS);
  postHandler = () => json(200, passed);
  vi.stubGlobal(
    'fetch',
    vi.fn((url, init) => {
      calls.push([url, init?.method || 'GET']);
      return Promise.resolve(url === '/api/pingone/setup/defaults' ? defaultsHandler() : postHandler(init));
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderPage = async () => {
  const utils = render(<MemoryRouter><PingOneSetup /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('p1setup-environmentId').value).toBe('env-1'));
  return utils;
};
const submit = () => screen.getByTestId('p1setup-submit');
const status = () => screen.getByTestId('p1setup-status');
const posts = () => calls.filter(([, m]) => m === 'POST');

describe('PingOneSetup (standalone UI standard)', () => {
  it('puts a live-not-simulated banner first, as a note, and keeps one h1 with no emoji and no theme toggle', async () => {
    const { container } = await renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.p1setup-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/live, not simulated/i);
    expect(banner.textContent).toMatch(/signed in/i);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe('PingOne MCP Setup');
    expect(screen.queryByRole('button', { name: /dark mode|light mode/i })).toBeNull();
    expect(container.querySelector('main')).toBeNull();
  });

  it('has exactly one primary button, in every state', async () => {
    const { container } = await renderPage();
    const primaries = () => container.querySelectorAll('button.pu-btn--primary');
    expect(primaries()).toHaveLength(1);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(submit());
    expect(primaries()).toHaveLength(1); // running
    await waitFor(() => expect(screen.getByTestId('p1setup-summary')).toBeTruthy());
    expect(primaries()).toHaveLength(1); // passed
    postHandler = () => json(200, tokenFailed);
    fireEvent.click(submit());
    await waitFor(() => expect(status().textContent).toMatch(/Incomplete/));
    expect(primaries()).toHaveLength(1); // incomplete
    postHandler = () => json(401, { error: 'x' });
    fireEvent.click(submit());
    await waitFor(() => expect(status().textContent).toMatch(/Sign-in needed/));
    expect(primaries()).toHaveLength(1); // signed out
  });

  it('says where the pre-fill came from only when the server returned values', async () => {
    await renderPage();
    expect(screen.getByTestId('p1setup-defaults').textContent).toMatch(/pre-filled from the demo server/i);
  });

  const defaultsNote = () => screen.getByTestId('p1setup-defaults');
  const renderNoDefaults = async (match) => {
    render(<MemoryRouter><PingOneSetup /></MemoryRouter>);
    await waitFor(() => expect(defaultsNote().textContent).toMatch(match));
    expect(defaultsNote().textContent).not.toMatch(/pre-filled/i);
    expect(screen.getByTestId('p1setup-environmentId').value).toBe('');
  };

  it('a failed defaults request (500) says it could not be loaded, not that the server returned none', async () => {
    defaultsHandler = () => json(500, {});
    await renderNoDefaults(/could not be loaded/i);
    expect(defaultsNote().textContent).not.toMatch(/returned no default/i);
  });

  it('a network failure on the defaults request says it could not be loaded', async () => {
    defaultsHandler = () => Promise.reject(new Error('Failed to fetch')); // a real fetch rejects, it does not throw
    await renderNoDefaults(/could not be loaded/i);
    expect(defaultsNote().textContent).not.toMatch(/returned no default/i);
  });

  it('a signed-out defaults request (401) says you are not signed in', async () => {
    defaultsHandler = () => json(401, {});
    await renderNoDefaults(/not signed in/i);
    expect(defaultsNote().textContent).not.toMatch(/returned no default/i);
  });

  it('only an answered request with empty values says the server returned no defaults', async () => {
    defaultsHandler = () => json(200, {});
    await renderNoDefaults(/server returned no default credentials/i);
  });

  it('keeps the live regions mounted before their text changes', async () => {
    render(<MemoryRouter><PingOneSetup /></MemoryRouter>);
    // first paint, before the defaults request settles
    expect(screen.getByTestId('p1setup-defaults').getAttribute('role')).toBe('status');
    expect(status().getAttribute('role')).toBe('status');
    expect(status().textContent).toMatch(/not run/i);
  });

  it('keeps the run button focusable but inert while a field is empty, and says why', async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId('p1setup-clientId'), { target: { value: '' } });
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(submit().disabled).toBe(false);
    expect(screen.getByTestId('p1setup-hint').textContent).toMatch(/fill in all three fields/i);
    fireEvent.submit(screen.getByTestId('p1setup-form'));
    expect(posts()).toHaveLength(0);
  });

  it('runs: word-bearing chips per step, the real tool count, focus and button name stay put', async () => {
    await renderPage();
    const name = submit().textContent;
    submit().focus();
    fireEvent.click(submit());
    expect(status().textContent).toMatch(/Running/);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('p1setup-clientId').readOnly).toBe(true);
    fireEvent.submit(screen.getByTestId('p1setup-form'));
    expect(posts()).toHaveLength(1); // a second submit while running does nothing
    await waitFor(() => expect(status().textContent).toMatch(/Passed/));
    expect(status().textContent).toMatch(/all three checks passed/i);
    expect(document.activeElement).toBe(submit());
    expect(submit().textContent).toBe(name);
    for (const k of ['token', 'mcp', 'tools']) {
      expect(within(screen.getByTestId(`p1setup-step-${k}`)).getByText('Passed')).toBeTruthy();
    }
    expect(screen.getByTestId('p1setup-step-tools').textContent).toMatch(/tools\/list returned 7 tools/);
    expect(screen.getByTestId('p1setup-tools').querySelectorAll('li')).toHaveLength(6); // 5 names + "+ 2 more"
    expect(screen.getByTestId('p1setup-next').textContent).toMatch(/Restart the BFF/);
    expect(screen.getByTestId('p1setup-environmentId').readOnly).toBe(false);
  });

  it('shows a step the server never reached as Not run, not "Failed: null"', async () => {
    postHandler = () => json(200, tokenFailed);
    await renderPage();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByTestId('p1setup-step-token')).toBeTruthy());
    expect(within(screen.getByTestId('p1setup-step-token')).getByText('Failed')).toBeTruthy();
    expect(screen.getByTestId('p1setup-step-token').textContent).toMatch(/invalid_client/);
    for (const k of ['mcp', 'tools']) {
      const card = screen.getByTestId(`p1setup-step-${k}`);
      expect(within(card).getByText('Not run')).toBeTruthy();
      expect(card.textContent).not.toMatch(/null|failed/i);
    }
    expect(status().textContent).toMatch(/Incomplete/);
    expect(status().textContent).toMatch(/0 of 3/);
    expect(screen.getByTestId('p1setup-summary').textContent).not.toMatch(/work end to end/i);
  });

  it('signed out: a 401 says so, that nothing reached PingOne, and shows no result or request-failed card', async () => {
    postHandler = () => json(401, { error: 'Authentication required' });
    await renderPage();
    fireEvent.click(submit());
    await waitFor(() => expect(status().textContent).toMatch(/Sign-in needed/));
    expect(status().textContent).toMatch(/not signed in/i);
    expect(status().textContent).toMatch(/nothing was sent to pingone/i);
    expect(screen.queryByTestId('p1setup-summary')).toBeNull();
    expect(screen.queryByTestId('p1setup-error')).toBeNull();
  });

  it('a server error shows the server message in a failed card, with a Failed chip', async () => {
    postHandler = () => json(500, { success: false, error: 'boom' });
    await renderPage();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByTestId('p1setup-error')).toBeTruthy());
    expect(within(screen.getByTestId('p1setup-error')).getByText('Failed')).toBeTruthy();
    expect(screen.getByTestId('p1setup-error').textContent).toMatch(/boom/);
    expect(status().textContent).toMatch(/demo server reported: boom/i);
    // a crashed or refusing server says nothing about the credentials
    expect(screen.getByTestId('p1setup-error').textContent).not.toMatch(/check your credentials|admin roles/i);
    expect(screen.getByTestId('p1setup-error-hint').textContent).toMatch(/not a verdict on the credentials/i);
  });

  it('a network failure says the demo server could not be reached, and a rerun clears it', async () => {
    postHandler = () => {
      throw new Error('Failed to fetch');
    };
    await renderPage();
    fireEvent.click(submit());
    await waitFor(() => expect(status().textContent).toMatch(/could not reach the demo server: Failed to fetch/i));
    expect(screen.getByTestId('p1setup-error').textContent).not.toMatch(/check your credentials|admin roles/i);
    expect(screen.getByTestId('p1setup-error-hint').textContent).toMatch(/did not reach the demo server, so nothing was checked/i);
    postHandler = () => json(200, passed);
    fireEvent.click(submit());
    await waitFor(() => expect(status().textContent).toMatch(/Passed/));
    expect(screen.queryByTestId('p1setup-error')).toBeNull();
  });

  it('echoes the environment that was run, not what is typed afterwards', async () => {
    await renderPage();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByTestId('p1setup-summary')).toBeTruthy());
    fireEvent.change(screen.getByTestId('p1setup-environmentId'), { target: { value: 'edited-later' } });
    expect(screen.getByTestId('p1setup-summary').textContent).toMatch(/env-1/);
    expect(screen.getByTestId('p1setup-summary').textContent).not.toMatch(/edited-later/);
  });

  it('builds the IDE address from the typed environment id and says it is the .com region', async () => {
    await renderPage();
    expect(screen.getByTestId('p1setup-url').textContent).toBe('https://mcp.pingone.com/admin/env-1/mcp');
    expect(screen.getByTestId('p1setup-ide').textContent).toMatch(/\.com region/);
  });
});
