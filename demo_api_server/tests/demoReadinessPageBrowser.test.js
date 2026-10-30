'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPage, uiBuildFreshness } = require('../services/demoReadinessPageBrowser');

const ORIGIN = 'https://readiness-bff-pingone:3001';

// A Playwright stand-in: records what the module asked for and replays the
// responses a page made while it loaded.
function fakeChromium({ responses = [], errors = [], finalUrl = `${ORIGIN}/weather-mcp`, observed } = {}) {
  const seen = { cookies: null, goto: null, closed: false };
  const handlers = {};
  const page = {
    on: (event, handler) => { handlers[event] = handler; },
    goto: async (url) => {
      seen.goto = url;
      for (const response of responses) handlers.response?.(response);
      for (const error of errors) handlers.pageerror?.(new Error(error));
      return { status: () => 200 };
    },
    waitForLoadState: async () => {},
    url: () => finalUrl,
    evaluate: async () => observed || { rendered: true, errorBoundary: false, session: { authenticated: true, oauthIssuer: 'https://issuer.example.test' } },
  };
  const browser = {
    newContext: async () => ({ addCookies: async (cookies) => { seen.cookies = cookies; }, newPage: async () => page }),
    close: async () => { seen.closed = true; },
  };
  return { seen, chromium: { connect: async () => browser } };
}

const response = (url, status, method = 'GET') => ({ url: () => url, status: () => status, request: () => ({ method: () => method }) });

test('loads the page with the lane cookies on the lane origin and reports what it saw', async () => {
  const { seen, chromium } = fakeChromium({
    responses: [
      response(`${ORIGIN}/api/weather`, 502),
      response(`${ORIGIN}/api/auth/session`, 401),
      response('https://cdn.example.test/api/x', 500),
    ],
    errors: ['TypeError: boom'],
  });
  const result = await loadPage({ wsEndpoint: 'ws://browser:3000/', origin: ORIGIN, cookies: [{ name: 'sid', value: 'v' }], path: '/weather-mcp', chromium });
  expect(seen.cookies).toEqual([{ name: 'sid', value: 'v', url: ORIGIN }]);
  expect(seen.goto).toBe(`${ORIGIN}/weather-mcp`);
  expect(seen.closed).toBe(true);
  // Only the lane BFF's own API server errors count; a 401 probe or another origin does not.
  expect(result).toMatchObject({ status: 200, finalPathname: '/weather-mcp', rendered: true, errorBoundary: false, failedApiCalls: ['GET /api/weather 502'], pageErrors: ['TypeError: boom'] });
});

describe('uiBuildFreshness', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-build-'));
    fs.mkdirSync(path.join(root, 'build'));
    fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const touch = (file, seconds) => { fs.writeFileSync(file, ''); fs.utimesSync(file, seconds, seconds); };

  test('a build newer than every source file is current', () => {
    touch(path.join(root, 'src', 'pages', 'A.js'), 1000);
    touch(path.join(root, 'build', 'index.html'), 2000);
    expect(uiBuildFreshness(root)).toEqual({ current: true });
  });

  test('a source file changed after the build makes it stale', () => {
    touch(path.join(root, 'build', 'index.html'), 2000);
    touch(path.join(root, 'src', 'pages', 'A.js'), 3000);
    expect(uiBuildFreshness(root)).toMatchObject({ current: false, reason: expect.stringContaining('older than the UI source') });
  });

  test('a missing build is not current', () => {
    expect(uiBuildFreshness(root)).toMatchObject({ current: false, reason: expect.stringContaining('no UI build') });
  });
});
