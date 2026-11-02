// demo_api_server/tests/demoAgentLangGraphService.balanceTool.regression.test.js
//
// Regression: "show my balance" names no account, and the banking balance
// action then called get_my_accounts (every account) while UC1, UC17, UC20
// and UC25 declare get_account_balance — the readiness lanes failed all four
// on "selected tool does not match catalog contract". With no account named,
// the action reads the vertical's primary account, by type name, so the
// balance route resolves it to the user's own account in whichever store
// answers.

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
// The MCP call is replaced: this test is about which tool the action picks.
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async ({ name }) => (name === 'get_my_accounts'
    ? { accounts: [{ id: 'a1', accountType: 'checking', balance: 5000 }] }
    : { accountType: 'checking', balance: 5000 })),
  executeBffToolWithToken: jest.fn(),
}));

const { dispatchBankingAction } = require('../services/demoAgentLangGraphService');
const { executeBffTool } = require('../services/bffMcpToolExecutor');
const { verticalManifest } = require('../services/verticalManifest');

// The BFF loads the vertical manifests at startup; the primary account type comes from them.
beforeAll(() => verticalManifest.loader.loadAll());
beforeEach(() => jest.clearAllMocks());

const ctx = { vertical: 'banking', userToken: 'user-token', req: { sessionID: 's1', tokenEvents: [] } };

test('with no account named, the balance action reads the primary account with get_account_balance', async () => {
  const result = await dispatchBankingAction('balance', {}, 'u1', ctx);
  expect(result.toolsCalled).toEqual(['get_account_balance']);
  expect(executeBffTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_account_balance', args: { account_id: 'checking' } }));
  expect(result.reply).toContain('$5000.00');
});

test('a named account is still read with get_account_balance', async () => {
  const result = await dispatchBankingAction('balance', { accountId: 'savings' }, 'u1', ctx);
  expect(result.toolsCalled).toEqual(['get_account_balance']);
  expect(executeBffTool).toHaveBeenCalledWith(expect.objectContaining({ args: { account_id: 'savings' } }));
});

test('listing accounts still uses get_my_accounts', async () => {
  const result = await dispatchBankingAction('accounts', {}, 'u1', ctx);
  expect(result.toolsCalled).toEqual(['get_my_accounts']);
});
