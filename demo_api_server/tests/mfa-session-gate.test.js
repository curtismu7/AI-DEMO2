'use strict';

/**
 * Unit tests for mfaSessionGate middleware
 *
 * Tests the redirect logic that gates admin users without MFA verification
 * to the /mfa-challenge page.
 */

// Mock configStore before importing middleware
jest.mock('../services/configStore', () => ({
  get: jest.fn()
}));

describe('mfaSessionGate middleware', () => {
  let mfaSessionGate;
  let configStore;
  let req, res, next;

  beforeEach(() => {
    // Import fresh instances for each test
    configStore = require('../services/configStore');

    // Import the middleware
    mfaSessionGate = require('../middleware/mfaSessionGate');

    // Create mock request, response, and next function
    req = {
      session: {},
      originalUrl: '/api/admin/dashboard'
    };

    res = {
      redirect: jest.fn()
    };

    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test 1: Allows request if MFA not required by feature flag
   */
  test('allows request if MFA not required', () => {
    // Mock configStore to return false (MFA not required)
    configStore.get.mockReturnValue(false);

    // Call middleware
    mfaSessionGate(req, res, next);

    // Assertions: should call next(), not redirect
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  /**
   * Test 2: Allows admin with mfa_verified=true
   */
  test('allows admin with mfa_verified=true', () => {
    // Mock configStore to return true (MFA required)
    configStore.get.mockReturnValue(true);

    // Set up user as admin with MFA verified
    req.session.user = {
      role: 'admin',
      mfa_verified: true
    };

    // Call middleware
    mfaSessionGate(req, res, next);

    // Assertions: should call next(), not redirect
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  /**
   * Test 3: Redirects admin without mfa_verified to /mfa-challenge
   */
  test('redirects admin without mfa_verified to /mfa-challenge', () => {
    // Mock configStore to return true (MFA required)
    configStore.get.mockReturnValue(true);

    // Set up user as admin without MFA verified
    req.session.user = {
      role: 'admin',
      mfa_verified: false
    };

    // Call middleware
    mfaSessionGate(req, res, next);

    // Assertions: should redirect and store original URL
    expect(res.redirect).toHaveBeenCalledWith('/mfa-challenge');
    expect(req.session.mfa_redirect_to).toBe('/api/admin/dashboard');
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * Test 4: Allows customer even without mfa_verified
   */
  test('allows customer even without mfa_verified', () => {
    // Mock configStore to return true (MFA required)
    configStore.get.mockReturnValue(true);

    // Set up user as customer without MFA verified
    req.session.user = {
      role: 'customer',
      mfa_verified: false
    };

    // Call middleware
    mfaSessionGate(req, res, next);

    // Assertions: should call next(), not redirect (customers bypass MFA)
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
