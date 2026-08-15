// demo_api_server/tests/demoAgentLangGraphService.adminTokenPublicCatalog.regression.test.js
//
// Regression: the admin-token-on-customer-agent guard (customerTokenGuard)
// blocked the ENTIRE agent turn for any admin token on a non-exempt vertical,
// before the message's intent was even parsed. That also blocked UC24/Act 1
// public catalog (branch_hours) — data that explicitly needs no customer
// identity at all (docs/use-cases/progressive-trust-public-access.md: "skips
// PingOne Authorize, the Agent Gateway, and token exchange"). An admin
// signed into the console saw "This action needs a customer sign-in" just
// for asking "What branches are near me?".
//
// Fix: the guard now exempts the parsed branch_hours intent. Money-moving /
// identity-reading banking actions (accounts, balance, transfer, ...) must
// stay blocked — locked in by the second test below.

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

jest.mock('../config/oauth', () => ({ clientId: 'ADMIN-CLIENT-123' }));

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const adminToken = `header.${b64({ azp: 'ADMIN-CLIENT-123' })}.sig`;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(_cfg)) delete _cfg[k];
});

describe('processAgentMessage — admin token vs UC24 public catalog (regression)', () => {
  test('admin token + public catalog intent (branch_hours) is NOT blocked', async () => {
    const result = await processAgentMessage({
      message: 'What branches are near me?',
      userId: 'u1',
      userToken: adminToken,
      vertical: 'banking',
      req: { body: { vertical: 'banking' }, tokenEvents: [] },
    });

    expect(result.requiresCustomerLogin).not.toBe(true);
    expect(result.code).not.toBe('admin_token_on_customer');
    expect(result.toolsCalled).toContain('get_branch_hours');
  });

  test('admin token + customer banking intent (accounts) still requires customer login', async () => {
    const result = await processAgentMessage({
      message: 'show my accounts',
      userId: 'u1',
      userToken: adminToken,
      vertical: 'banking',
      req: { body: { vertical: 'banking' }, tokenEvents: [] },
    });

    expect(result.requiresCustomerLogin).toBe(true);
    expect(result.code).toBe('admin_token_on_customer');
    expect(result.toolsCalled).toEqual([]);
  });
});
