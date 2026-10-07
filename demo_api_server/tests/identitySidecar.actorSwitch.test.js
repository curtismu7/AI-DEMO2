'use strict';

/**
 * ff_agent_identity_sidecar switch points. Flag OFF must leave the actor-token
 * path exactly as it was; flag ON only reroutes the default agent (no runtime).
 * A runtime (Agent Builder / delegated commerce) carries its own credentials and
 * must never be sent to the sidecar.
 */

jest.mock('axios');
jest.mock('../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));

const mockSidecar = { isEnabled: jest.fn(), fetchActorToken: jest.fn() };
jest.mock('../services/identitySidecarClient', () => mockSidecar);

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const oauthService = require('../services/oauthService');

const ENV_KEYS = ['PINGONE_AI_AGENT_CLIENT_ID', 'PINGONE_AI_AGENT_CLIENT_SECRET'];
const saved = {};

beforeEach(() => {
  axios.post.mockReset();
  mockSidecar.isEnabled.mockReset();
  mockSidecar.fetchActorToken.mockReset();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.PINGONE_AI_AGENT_CLIENT_ID = 'default-agent-client';
  process.env.PINGONE_AI_AGENT_CLIENT_SECRET = 'default-agent-secret';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getAiAgentClientCredentialsToken', () => {
  test('flag ON + no runtime: token comes from the sidecar, PingOne is not called', async () => {
    mockSidecar.isEnabled.mockReturnValue(true);
    mockSidecar.fetchActorToken.mockResolvedValue('sidecar-token');

    await expect(oauthService.getAiAgentClientCredentialsToken(null)).resolves.toBe('sidecar-token');

    expect(axios.post).not.toHaveBeenCalled();
  });

  test('flag ON + runtime: the runtime keeps its own credentials, sidecar not used', async () => {
    mockSidecar.isEnabled.mockReturnValue(true);
    axios.post.mockResolvedValue({ data: { access_token: 'runtime-token' } });

    const token = await oauthService.getAiAgentClientCredentialsToken({
      clientId: 'builder-agent', clientSecret: 'builder-secret', authMethod: 'post',
    });

    expect(token).toBe('runtime-token');
    expect(mockSidecar.fetchActorToken).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1]).toContain('client_id=builder-agent');
  });

  test('flag OFF: the unchanged client_credentials path, sidecar never consulted', async () => {
    mockSidecar.isEnabled.mockReturnValue(false);
    axios.post.mockResolvedValue({ data: { access_token: 'local-token' } });

    await expect(oauthService.getAiAgentClientCredentialsToken(null)).resolves.toBe('local-token');

    expect(mockSidecar.fetchActorToken).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1]).toContain('client_id=default-agent-client');
  });

  test('flag ON + sidecar failure surfaces the error instead of minting locally', async () => {
    mockSidecar.isEnabled.mockReturnValue(true);
    mockSidecar.fetchActorToken.mockRejectedValue(new Error('Identity sidecar unreachable'));

    await expect(oauthService.getAiAgentClientCredentialsToken(null)).rejects.toThrow(/unreachable/);

    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('two-exchange actor mint (agentMcpTokenService)', () => {
  // The two-exchange function is too large to drive here without re-mocking half the
  // stack, so pin the one contract that matters: the sidecar is chosen only for the
  // default agent (no PF provider branch, no runtime) and only when the flag is ON.
  test('source routes only the default agent to the sidecar', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/agentMcpTokenService.js'), 'utf8');
    expect(src).toMatch(/\?\s*await provider\.getActorToken\(providerConfig, 'agent'\)\s*:\s*\(!agentRuntime && identitySidecar\.isEnabled\(\)\)/);
    // ...and it checks the token against the configured audience and scope instead of trusting
    // the sidecar's static target.
    expect(src).toMatch(/\?\s*await identitySidecar\.fetchActorToken\(\{\s*audience:\s*agentGatewayAud,\s*scope:\s*agentGatewayScope\s*\}\)\s*:\s*await oauthService\.getClientCredentialsTokenAs\(aiAgentClientId/);
  });
});
