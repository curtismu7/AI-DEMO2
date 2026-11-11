// demo_api_server/tests/agentBuilderService.agentNameStoreUser.regression.test.js
//
// Regression: the OAuth callback seeds session.user.username from PingOne's
// preferred_username, which for this tenant is an email
// ("cmuir+demouser@pingone.com"), while the registered personal agent is named
// after the canonical store user ("AI Agent - demoUser", store user matched by
// oauthId). getAgentForUser built the name from the session user and missed,
// so the Digital Worker attended run failed with
// "No personal agent is registered for your account".
//
// agentName() must resolve the canonical store user by oauthId (fallback
// email) and use their username; unknown identities keep the session name.

const _users = [];
jest.mock('../data/store', () => ({
  getAllUsers: jest.fn(() => _users),
}));

const { agentName } = (() => {
  // agentName is module-private; reach it via the exported summary path is
  // heavier (PingOne calls), so exercise the name logic through a tiny
  // re-require with the internal export trick: the service exports
  // createAgentForUser etc. but not agentName. Instead call getAgentForUser
  // with a mocked listApplicationsRaw.
  return require('../services/agentBuilderService');
})();

jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn(async () => 'tok'),
}));
jest.mock('../services/personalAgentCimdService', () => ({}));
jest.mock('../services/agentLifecycleEvents', () => ({ on: jest.fn(), emit: jest.fn() }));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => (k === 'PINGONE_ENVIRONMENT_ID' ? 'env-test' : null)),
  getConfig: jest.fn(() => ({})),
  setConfig: jest.fn(async () => {}),
}));
jest.mock('../utils/sanitizeAxiosCause', () => ({ sanitizeAxiosCause: (e) => e }));

// Patch listApplicationsRaw indirectly: getAgentForUser → findAgentRaw →
// listApplicationsRaw → axios.get. Mock axios so the app list is local.
jest.mock('axios', () => ({
  get: jest.fn(async (url) => {
    if (String(url).includes('/applications')) {
      return {
        status: 200,
        data: {
          _embedded: {
            applications: [
              { id: 'app-1', name: 'AI Agent - demoUser', type: 'AI_AGENT', enabled: true, grantTypes: ['CLIENT_CREDENTIALS'] },
            ],
          },
        },
      };
    }
    return { status: 404, data: {} };
  }),
}));

describe('agentBuilderService — agent name resolves the canonical store user (regression)', () => {
  beforeEach(() => {
    _users.length = 0;
    _users.push(
      { id: '5', username: 'demoUser', email: 'cmuir+demouser@pingone.com', oauthId: 'sub-1583' },
      { id: 'other', username: 'cmuir+demo-user@pingone.com', email: 'cmuir+demo-user@pingone.com', oauthId: 'sub-other' },
    );
  });

  test('session user with email-shaped username + matching oauthId → store username', async () => {
    const user = { id: 'sub-1583', oauthId: 'sub-1583', username: 'cmuir+demouser@pingone.com', email: 'cmuir+demouser@pingone.com' };
    const a = await agentName ? null : null; // agentName not exported — go through getAgentForUser
    const svc = require('../services/agentBuilderService');
    const agent = await svc.getAgentForUser(user, 'personal');
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('AI Agent - demoUser');
  });

  test('email fallback when oauthId absent from the store record', async () => {
    _users.length = 0;
    _users.push({ id: '5', username: 'demoUser', email: 'cmuir+demouser@pingone.com', oauthId: 'different-sub' });
    const user = { id: 'sub-1583', oauthId: 'sub-1583', username: 'cmuir+demouser@pingone.com', email: 'cmuir+demouser@pingone.com' };
    const svc = require('../services/agentBuilderService');
    const agent = await svc.getAgentForUser(user, 'personal');
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('AI Agent - demoUser');
  });

  test('no store match keeps the session identity', async () => {
    _users.length = 0;
    const user = { id: 'sub-9', oauthId: 'sub-9', username: 'someone-else@pingone.com', email: 'someone-else@pingone.com' };
    const svc = require('../services/agentBuilderService');
    const agent = await svc.getAgentForUser(user, 'personal');
    expect(agent).toBeNull(); // app list has no 'AI Agent - someone-else@pingone.com'
  });
});
