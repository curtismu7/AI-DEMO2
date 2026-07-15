'use strict';

describe('usecaseCheck gates', () => {
  let permitAccounts;
  let denyInsufficientScope;
  let executeBffTool;
  let runAttackSim;

  beforeEach(() => {
    jest.resetModules();
    executeBffTool = jest.fn();
    runAttackSim = jest.fn();
    jest.doMock('../../services/bffMcpToolExecutor', () => ({ executeBffTool }));
    jest.doMock('../../services/attackSimulatorService', () => ({ runAttackSim }));
    ({ permitAccounts, denyInsufficientScope } = require('../../services/checks/usecaseCheck'));
  });

  test('permit fails with nextAction when session missing', async () => {
    const out = await permitAccounts.run({ req: { session: {} } });
    expect(out.status).toBe('fail');
    expect(out.nextAction).toMatch(/Sign in/);
  });

  test('permit passes when executeBffTool returns accounts JSON', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify([{ id: 'a1' }]));
    const req = {
      session: { oauthTokens: { accessToken: 'tok' }, user: { id: 'u1' }, id: 's1' },
      body: {},
    };
    const out = await permitAccounts.run({ req });
    expect(out.status).toBe('pass');
    expect(executeBffTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_my_accounts' }));
    expect(req.body.useCaseId).toBe('delegated-access-with-proof');
  });

  test('deny passes when attack sim returns 403', async () => {
    runAttackSim.mockResolvedValue({
      status: 403,
      errorCode: 'insufficient_scope',
      tokenChainEvents: [],
    });
    const req = { session: { oauthTokens: { accessToken: 'tok' } } };
    const out = await denyInsufficientScope.run({ req });
    expect(out.status).toBe('pass');
    expect(out.meta.expectedOutcome).toBe('DENY');
  });

  test('deny fails on unexpected_permit with nextAction', async () => {
    runAttackSim.mockResolvedValue({
      status: 200,
      errorCode: 'unexpected_permit',
      tokenChainEvents: [],
    });
    const req = { session: { oauthTokens: { accessToken: 'tok' } } };
    const out = await denyInsufficientScope.run({ req });
    expect(out.status).toBe('fail');
    expect(out.nextAction).toMatch(/Gateway enforcement/);
  });
});
