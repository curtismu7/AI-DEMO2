'use strict';

const mockGetEffective = jest.fn();

jest.mock('axios', () => ({ post: jest.fn(), put: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: (...args) => mockGetEffective(...args) }));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-access-token'),
}));

const axios = require('axios');
const pingOneClientService = require('../services/pingOneClientService');
const { createBrowserRiskEvaluation } = require('../services/pingOneProtectService');

describe('createBrowserRiskEvaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEffective.mockImplementation((key) => ({
      PINGONE_REGION: 'com',
      PINGONE_ENVIRONMENT_ID: 'environment-1',
      PINGONE_SDK_DEMO_CLIENT_ID: 'public-client-1',
    })[key]);
  });

  test('submits browser Signals and server context as an authentication event', async () => {
    const expectedEvaluation = {
      id: 'evaluation-1',
      result: { level: 'MEDIUM', recommendedAction: 'MFA' },
    };
    axios.post.mockResolvedValue({ data: expectedEvaluation });

    const result = await createBrowserRiskEvaluation({
      userId: 'alice@example.com',
      ip: '203.0.113.9',
      userAgent: 'Demo Browser/1.0',
      signalsData: '{"device":"signals"}',
      targetResourceId: 'public-client-1',
      sessionId: 'session-1',
    });

    expect(pingOneClientService.getManagementToken).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.pingone.com/v1/environments/environment-1/riskEvaluations',
      {
        event: {
          ip: '203.0.113.9',
          user: { id: 'alice@example.com', type: 'EXTERNAL', name: 'alice@example.com', email: 'alice@example.com' },
          browser: { userAgent: 'Demo Browser/1.0' },
          flow: { type: 'AUTHENTICATION' },
          session: { id: 'session-1' },
          targetResource: { id: 'public-client-1', name: 'PingOne Protect browser risk evaluation demo' },
          sdk: { signals: { data: '{"device":"signals"}' } },
        },
      },
      { headers: { Authorization: 'Bearer worker-access-token' }, timeout: 10000 },
    );
    expect(result).toEqual(expectedEvaluation);
  });

  test('uses an external identity for a username supplied by the standalone demo', async () => {
    axios.post.mockResolvedValue({ data: { id: 'evaluation-username', result: { level: 'LOW' } } });

    await createBrowserRiskEvaluation({
      userId: 'demouser',
      ip: '203.0.113.9',
      userAgent: 'Demo Browser/1.0',
      signalsData: '{"device":"signals"}',
      targetResourceId: 'public-client-1',
      sessionId: 'session-1',
    });

    expect(axios.post.mock.calls[0][1].event.user).toEqual({
      id: 'demouser',
      type: 'EXTERNAL',
      name: 'demouser',
    });
  });

  test('does not include signals or Worker credentials in a Protect error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    axios.post.mockRejectedValue({
      response: { status: 403, data: { message: 'Rejected', details: [] } },
      config: { headers: { Authorization: 'Bearer worker-access-token' } },
    });

    await expect(createBrowserRiskEvaluation({
      userId: 'alice',
      ip: '203.0.113.9',
      userAgent: 'Demo Browser/1.0',
      signalsData: 'private-signals-payload',
      targetResourceId: 'public-client-1',
      sessionId: 'session-1',
    })).rejects.toThrow('PingOne Protect risk evaluation failed (403)');

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('private-signals-payload'), expect.anything());
    expect(warn.mock.calls.flat().join(' ')).not.toContain('private-signals-payload');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('worker-access-token');
    warn.mockRestore();
  });

  test('rejects a response without a risk evaluation ID', async () => {
    axios.post.mockResolvedValue({ data: { result: { level: 'LOW' } } });

    await expect(createBrowserRiskEvaluation({
      userId: 'alice', ip: '203.0.113.9', userAgent: 'browser',
      signalsData: 'signals', targetResourceId: 'client', sessionId: 'session',
    })).rejects.toThrow('PingOne Protect did not return a risk evaluation ID');
  });
});
