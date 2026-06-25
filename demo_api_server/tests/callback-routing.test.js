'use strict';
/**
 * Callback Routing Tests (Phase 169-03)
 *
 * Verifies callbackDispatcher registers OAuth callback routes correctly
 * for PingOne defaults, Federate, Auth0, Okta, and edge cases.
 * Uses a mock Express app — no server started.
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

describe('callbackDispatcher', () => {
  let registerCallbacks;
  let mockApp;
  let mockAdminRouter;
  let mockUserRouter;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.OAUTH_ADMIN_CALLBACK_PATH;
    delete process.env.OAUTH_USER_CALLBACK_PATH;

    // Mock Express app — capture all app.get registrations
    mockApp = { get: jest.fn(), routes: [] };
    mockApp.get.mockImplementation((path, ...handlers) => {
      mockApp.routes.push({ path, handlers });
    });

    mockAdminRouter = jest.fn();
    mockUserRouter  = jest.fn();
  });

  afterEach(() => {
    delete process.env.OAUTH_ADMIN_CALLBACK_PATH;
    delete process.env.OAUTH_USER_CALLBACK_PATH;
  });

  function getRoutes() {
    return registerCallbacks = require('../services/callbackDispatcher');
  }

  // ── Test 1 ────────────────────────────────────────────────────────────────
  test('registers admin callback at default path when no config set', () => {
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).toContain('/api/auth/oauth/callback');
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  test('registers user callback at default path when no config set', () => {
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).toContain('/api/auth/oauth/user/callback');
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  test('registers custom admin callback path when OAUTH_ADMIN_CALLBACK_PATH set', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/oauth2/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).toContain('/oauth2/callback');
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  test('registers custom user callback path when OAUTH_USER_CALLBACK_PATH set', () => {
    process.env.OAUTH_USER_CALLBACK_PATH = '/oauth2/user-callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).toContain('/oauth2/user-callback');
  });

  // ── Test 5: Federate pattern ───────────────────────────────────────────────
  test('supports Federate pattern — both callbacks on /oauth2/callback', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/oauth2/callback';
    process.env.OAUTH_USER_CALLBACK_PATH  = '/oauth2/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const adminRoute = mockApp.routes.find(r => r.path === '/oauth2/callback');
    expect(adminRoute).toBeDefined();
    // Only one route registered when paths are the same (admin wins)
    const allPaths = mockApp.routes.map(r => r.path);
    expect(allPaths.filter(p => p === '/oauth2/callback')).toHaveLength(1);
  });

  // ── Test 6: Auth0 pattern ─────────────────────────────────────────────────
  test('supports Auth0 pattern — callback on /callback', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/callback';
    process.env.OAUTH_USER_CALLBACK_PATH  = '/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).toContain('/callback');
  });

  // ── Test 7: query string forwarding ───────────────────────────────────────
  test('callback handler rewrites req.url to /callback preserving query string', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/oauth2/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const route = mockApp.routes.find(r => r.path === '/oauth2/callback');
    expect(route).toBeDefined();

    // Simulate the handler being called with a request containing ?code&state
    const mockReq = { url: '/oauth2/callback?code=abc123&state=xyz' };
    const mockRes = {};
    const mockNext = jest.fn();
    const handler  = route.handlers[route.handlers.length - 1]; // last handler is the route fn
    handler(mockReq, mockRes, mockNext);

    expect(mockReq.url).toBe('/callback?code=abc123&state=xyz');
    expect(mockAdminRouter).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
  });

  // ── Test 8: no query string ────────────────────────────────────────────────
  test('callback handler rewrites req.url with no query string', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/oauth2/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const route   = mockApp.routes.find(r => r.path === '/oauth2/callback');
    const handler = route.handlers[route.handlers.length - 1];
    const mockReq = { url: '/oauth2/callback' };
    handler(mockReq, {}, jest.fn());

    expect(mockReq.url).toBe('/callback');
  });

  // ── Test 9: rate limiter applied ───────────────────────────────────────────
  test('rate limiter middleware is injected when provided', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/oauth2/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    const mockLimiter = jest.fn();
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter, mockLimiter);

    const route = mockApp.routes.find(r => r.path === '/oauth2/callback');
    // Rate limiter should be the first handler
    expect(route.handlers[0]).toBe(mockLimiter);
  });

  // ── Test 10: invalid path skipped ─────────────────────────────────────────
  test('does not register route for invalid admin callback path', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = 'not-a-valid-path';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths).not.toContain('not-a-valid-path');
  });

  // ── Test 11: path too long skipped ────────────────────────────────────────
  test('does not register route when path exceeds 255 characters', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/' + 'a'.repeat(300);
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const paths = mockApp.routes.map(r => r.path);
    expect(paths.some(p => p.length > 255)).toBe(false);
  });

  // ── Test 12: user router called for user path ─────────────────────────────
  test('user router is called for user callback path handler', () => {
    process.env.OAUTH_ADMIN_CALLBACK_PATH = '/admin/callback';
    process.env.OAUTH_USER_CALLBACK_PATH  = '/user/callback';
    const { registerCallbacks } = require('../services/callbackDispatcher');
    registerCallbacks(mockApp, mockAdminRouter, mockUserRouter);

    const userRoute  = mockApp.routes.find(r => r.path === '/user/callback');
    const handler    = userRoute.handlers[userRoute.handlers.length - 1];
    const mockReq    = { url: '/user/callback?code=abc&state=def' };
    handler(mockReq, {}, jest.fn());

    expect(mockUserRouter).toHaveBeenCalled();
    expect(mockAdminRouter).not.toHaveBeenCalled();
  });
});
