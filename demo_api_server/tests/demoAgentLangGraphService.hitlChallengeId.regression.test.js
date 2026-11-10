// demo_api_server/tests/demoAgentLangGraphService.hitlChallengeId.regression.test.js
//
// Regression: the transfer/deposit/withdrawal HITL branches of
// dispatchBankingAction returned `error: 'hitl_required'` WITHOUT
// `hitlChallengeId`, even though classifyMcpToolResult had already extracted
// it from the pipeline body (`tc.hitlChallengeId`). The UI's approval path
// (PersonalAgentStudioPage) only enters approval state when
// `data.hitlChallengeId || data.challengeId` is present, so the challenge id
// was dropped on the floor: the run died as a generic failure, the mock-phone
// approval was wasted, and the gateway challenge sat unspent.
//
// The step-up branch already carried `hitlChallengeId: tc.hitlChallengeId`;
// these tests pin the same field on all three HITL branches.

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

// The pipeline is the seam: mock executeBffTool to return a gateway HITL body
// shaped exactly like mcpGatewayClient surfaces a 428 (error + challengeId).
const _toolResults = new Map();
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async ({ name }) => {
    const r = globalThis.__toolResults.get(name);
    if (r) return r;
    return { error: 'ok' };
  }),
}));

jest.mock('../data/store', () => ({
  getAccountsByUserId: jest.fn(async () => [
    { id: 'acc-checking', accountType: 'Checking' },
    { id: 'acc-savings', accountType: 'Savings' },
  ]),
}));

jest.mock('../services/mcpToolPipeline', () => ({
  // The real buildToolDeps fans out to token services we don't want here;
  // the HITL classification happens in dispatchBankingAction via
  // classifyMcpToolResult(result), so a bare body suffices.
  buildToolDeps: jest.fn(() => ({})),
}));

const { dispatchBankingAction } = require('../services/demoAgentLangGraphService');
const { executeBffTool } = require('../services/bffMcpToolExecutor');

globalThis.__toolResults = _toolResults;

const GW_HITL_BODY = {
  error: 'hitl_required',
  isError: false,
  tool: 'create_transfer',
  message: 'Transaction requires human approval (HITL consent)',
  hitl: true,
  challengeId: 'challenge-abc-123',
  challenge_type: 'consent',
  tokenEvents: [],
};

const ctx = (vertical = 'banking') => ({
  userToken: 'tok',
  req: { session: { user: { username: 'u' } }, tokenEvents: [] },
  subjectToken: null,
  isAdmin: false,
  terminology: null,
  vertical,
});

describe('dispatchBankingAction — HITL responses carry the gateway challenge id (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _toolResults.clear();
  });

  test('transfer HITL body → hitlChallengeId present', async () => {
    _toolResults.set('create_transfer', GW_HITL_BODY);
    const r = await dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 300 }, 'u1', ctx());
    expect(r.error).toBe('hitl_required');
    expect(r.hitlChallengeId).toBe('challenge-abc-123');
  });

  test('transfer_600_test normalizes onto transfer and carries it too', async () => {
    _toolResults.set('create_transfer', GW_HITL_BODY);
    const r = await dispatchBankingAction('transfer_600_test', {}, 'u1', ctx());
    expect(r.error).toBe('hitl_required');
    expect(r.hitlChallengeId).toBe('challenge-abc-123');
  });

  test('deposit HITL body → hitlChallengeId present', async () => {
    _toolResults.set('create_deposit', { ...GW_HITL_BODY, tool: 'create_deposit' });
    const r = await dispatchBankingAction('deposit', { toId: 'savings', amount: 300 }, 'u1', ctx());
    expect(r.error).toBe('hitl_required');
    expect(r.hitlChallengeId).toBe('challenge-abc-123');
  });

  test('withdrawal HITL body → hitlChallengeId present', async () => {
    _toolResults.set('create_withdrawal', { ...GW_HITL_BODY, tool: 'create_withdrawal' });
    const r = await dispatchBankingAction('withdraw', { fromId: 'checking', amount: 300 }, 'u1', ctx());
    expect(r.error).toBe('hitl_required');
    expect(r.hitlChallengeId).toBe('challenge-abc-123');
  });
});
