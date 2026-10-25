// @vitest-environment jsdom
// ConnectorFlow against the REAL sandbox server (routes/connectorSandbox.js over HTTP). Only two things are stubbed:
// apiClient (forwards to that server) and window.open (performs the popup's browser legs: authorize -> consent -> callback).
import { createRequire } from 'node:module';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../EmbeddedFlowDiagram', () => ({ default: () => <div data-testid="diagram-stub" /> }));

const require = createRequire(import.meta.url);
let server;
let origin;
const sessionCookie = 'unused';

vi.mock('../../services/apiClient', () => {
  const call = async (method, url, body) => {
    const res = await fetch(`${globalThis.__sandboxOrigin}${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { const err = new Error(data.error || 'failed'); err.response = { data, status: res.status }; throw err; }
    return { data };
  };
  return { default: { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}) } };
});

beforeAll(async () => {
  const express = require('../../../../demo_api_server/node_modules/express');
  // middleware/auth drags in native LMDB, which cannot load under jsdom; the session is faked below, so a pass-through is equivalent.
  const authPath = require.resolve('../../../../demo_api_server/middleware/auth');
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireSession: (_req, _res, next) => next() } };
  const router = require('../../../../demo_api_server/routes/connectorSandbox');
  const app = express();
  app.use((req, _res, next) => { req.session = { user: { id: 'member-1', username: 'ann' } }; next(); });
  app.use('/api/connector-sandbox', router);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_APP_URL = origin;
  globalThis.__sandboxOrigin = origin;
});
afterAll(() => { server?.close(); delete process.env.PUBLIC_APP_URL; });

// What the popup does: follow authorize, accept consent, land on the client's redirect_uri.
async function popupFlow(authUrl, decision) {
  const authz = await fetch(authUrl, { redirect: 'manual' });
  const consentUrl = new URL(authz.headers.get('location'), origin);
  const page = await fetch(consentUrl);
  expect(await page.text()).toContain('Allow ChatGPT');
  const decided = await fetch(`${origin}/api/connector-sandbox/as/consent`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ rid: consentUrl.searchParams.get('rid'), decision }),
  });
  await fetch(decided.headers.get('location'));
}

describe('ConnectorFlow with the real sandbox', () => {
  it('walks all 12 steps for a permitted call and shows the tokens, consent record and policy decision', async () => {
    window.open = vi.fn((url) => { popupFlow(url, 'allow'); return { closed: false }; });
    const { default: ConnectorFlow } = await import('../ConnectorFlow');
    render(<ConnectorFlow />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show my benefits' })).toBeTruthy(), { timeout: 15000 });

    expect(screen.getByTestId('cf-card-access').textContent).toContain('RS256');
    expect(screen.getByTestId('cf-card-consent').textContent).toContain('cns_');
    expect(screen.getByTestId('cf-card-assertion').textContent).toContain('"verified": true');

    fireEvent.click(screen.getByRole('button', { name: 'Show my benefits' }));
    await waitFor(() => expect(screen.getByTestId('cf-result').textContent).toContain('Example PPO'), { timeout: 10000 });
    const states = [...screen.getByTestId('cf-steps').querySelectorAll('li')].map((li) => li.dataset.status);
    expect(states).toEqual(Array(12).fill('done'));
    expect(screen.getByTestId('cf-card-decision').textContent).toContain('PERMIT');
    expect(screen.getByTestId('cf-card-gateway').textContent).toContain('"consent": true');
  }, 40000);

  it('stops at step 10 with a DENY for another member, and never calls the downstream API', async () => {
    window.open = vi.fn((url) => { popupFlow(url, 'allow'); return { closed: false }; });
    const { default: ConnectorFlow } = await import('../ConnectorFlow');
    const { unmount } = render(<ConnectorFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /another member/ })).toBeTruthy(), { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /another member/ }));
    await waitFor(() => expect(screen.getByTestId('cf-card-decision').textContent).toContain('DENY'), { timeout: 10000 });
    const states = [...screen.getByTestId('cf-steps').querySelectorAll('li')].map((li) => li.dataset.status);
    expect(states[9]).toBe('error');
    expect(states[10]).toBe('pending');
    unmount();
  }, 40000);

  it('shows no token and says so when the member denies consent', async () => {
    window.open = vi.fn((url) => { popupFlow(url, 'deny'); return { closed: false }; });
    const { default: ConnectorFlow } = await import('../ConnectorFlow');
    render(<ConnectorFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('denied'), { timeout: 15000 });
    expect(screen.getByTestId('cf-card-access').textContent).toContain('Not issued yet');
    expect(screen.getByTestId('cf-card-consent').textContent).toContain('no consent record');
  }, 40000);
});
