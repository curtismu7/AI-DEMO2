// Unit tests for the admin-token-on-customer-agent guard.
// Mock config/oauth so the test does not depend on configStore/LMDB seeding.
jest.mock('../../config/oauth', () => ({ clientId: 'ADMIN-CLIENT-123' }));

const {
  isAdminClientToken,
  isCustomerBankingTool,
  adminTokenAgentResponse,
  ADMIN_TOKEN_ON_CUSTOMER,
} = require('../../services/customerTokenGuard');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (claims) => `header.${b64(claims)}.sig`;

describe('customerTokenGuard.isAdminClientToken', () => {
  it('returns true when azp matches the admin client id', () => {
    expect(isAdminClientToken(tok({ azp: 'ADMIN-CLIENT-123' }))).toBe(true);
  });

  it('returns true when client_id (no azp) matches the admin client id', () => {
    expect(isAdminClientToken(tok({ client_id: 'ADMIN-CLIENT-123' }))).toBe(true);
  });

  it('returns false for a user-client token', () => {
    expect(isAdminClientToken(tok({ azp: 'USER-CLIENT-999' }))).toBe(false);
  });

  it('returns false for malformed / empty / null tokens', () => {
    expect(isAdminClientToken('not-a-jwt')).toBe(false);
    expect(isAdminClientToken('')).toBe(false);
    expect(isAdminClientToken(null)).toBe(false);
    expect(isAdminClientToken(undefined)).toBe(false);
  });

  it('returns false for the _cookie_session stub', () => {
    expect(isAdminClientToken('_cookie_session')).toBe(false);
  });
});

describe('customerTokenGuard.isCustomerBankingTool', () => {
  it('matches the customer banking tool set', () => {
    expect(isCustomerBankingTool('get_my_accounts')).toBe(true);
    expect(isCustomerBankingTool('get_account_balance')).toBe(true);
    expect(isCustomerBankingTool('create_transfer')).toBe(true);
  });

  it('does not match unknown / admin tools', () => {
    expect(isCustomerBankingTool('list_users')).toBe(false);
    expect(isCustomerBankingTool('foo')).toBe(false);
  });
});

describe('customerTokenGuard.isVerticalExemptFromAdminTokenGuard', () => {
  const { isVerticalExemptFromAdminTokenGuard } = require('../../services/customerTokenGuard');

  it('exempts the admin vertical (its chips are admin-only tools)', () => {
    expect(isVerticalExemptFromAdminTokenGuard('admin')).toBe(true);
  });

  it('exempts the oauth-teaching vertical (OAuth Academy)', () => {
    expect(isVerticalExemptFromAdminTokenGuard('oauth-teaching')).toBe(true);
  });

  it('does not exempt customer verticals', () => {
    expect(isVerticalExemptFromAdminTokenGuard('banking')).toBe(false);
    expect(isVerticalExemptFromAdminTokenGuard('healthcare')).toBe(false);
    expect(isVerticalExemptFromAdminTokenGuard(null)).toBe(false);
    expect(isVerticalExemptFromAdminTokenGuard(undefined)).toBe(false);
  });
});

describe('customerTokenGuard.adminTokenAgentResponse', () => {
  it('is a terminal, no-tool envelope flagged for customer login', () => {
    const r = adminTokenAgentResponse();
    expect(r.requiresCustomerLogin).toBe(true);
    expect(r.code).toBe('admin_token_on_customer');
    expect(r.success).toBe(false);
    expect(r.toolsCalled).toEqual([]);
    expect(r.reply).toBe(ADMIN_TOKEN_ON_CUSTOMER.message);
  });

  it('passes through accumulated token events', () => {
    const events = [{ phase: 'x' }];
    expect(adminTokenAgentResponse(events).tokenEvents).toBe(events);
  });
});
