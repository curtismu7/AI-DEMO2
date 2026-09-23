'use strict';

const express = require('express');
const request = require('supertest');
const { resolveUseCase } = require('../config/useCases');

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { sub: 'customer-1', acr: req.headers.authorization === 'Bearer mfa' ? 'Multi_Factor' : 'Single_Factor' };
    next();
  },
}));
jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (req, _res, next) => {
    req.session = {
      id: 'session-1',
      user: req.user ? { sub: req.user.sub, email: 'customer@example.test' } : undefined,
      oauthTokens: req.user ? { accessToken: 'session-token' } : undefined,
    };
    req.agentContext = req.user ? { tokenEvents: [] } : null;
    req.tokenEvents = [];
    next();
  },
}));
jest.mock('../services/agentBuilderService', () => ({
  getAgentForUser: jest.fn(async () => ({ id: 'registered-agent', name: 'Assistant', type: 'personal' })),
  ensurePersonalAgentCimd: jest.fn(async () => {}),
}));
jest.mock('../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async () => ({ reply: 'Policy path reached', success: true, toolsCalled: [], tokenEvents: [] })),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => ({ ff_intent_authorization_enabled: 'false', ff_intent_token_enabled: 'false' })[key]),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));
jest.mock('../services/lmdb/conversationStore.lmdb', () => ({ saveMessage: jest.fn() }));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');
const agentBuilderService = require('../services/agentBuilderService');
const app = express();
app.use('/api', require('../routes/agentInvokeRoute'));

const invoke = (id, vertical = 'sporting-goods') => ({
  prompt: resolveUseCase(id, vertical).runPrompt,
  vertical,
  useCaseId: resolveUseCase(id, vertical).useCaseId,
});

beforeEach(() => jest.clearAllMocks());

describe('workload agent invoke contract', () => {
  test.each(['UC38', 'UC44'])('%s requires a signed-in customer', async (id) => {
    const res = await request(app).post('/api/agent/invoke').send(invoke(id));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('authentication_required');
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('UC38 without MFA returns step-up before agent execution', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(invoke('UC38'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ error: 'step_up_required', step_up_required: true, toolsCalled: [] });
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('UC38 with MFA verifies registration and continues with the catalog action', async () => {
    const body = invoke('UC38');
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer mfa').send(body);
    expect(res.status).toBe(200);
    expect(agentBuilderService.getAgentForUser).toHaveBeenCalledWith(expect.any(Object), 'personal');
    expect(processAgentMessage).toHaveBeenCalledWith(expect.objectContaining({ message: body.prompt, vertical: body.vertical, isGuest: false }));
  });

  test('UC44 without MFA verifies registration and continues to normal agent policy', async () => {
    const body = invoke('UC44');
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(body);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(agentBuilderService.getAgentForUser).toHaveBeenCalledWith(expect.any(Object), 'personal');
    expect(processAgentMessage).toHaveBeenCalledWith(expect.objectContaining({ message: body.prompt, vertical: body.vertical, isGuest: false }));
  });

  test('UC44 still requires a registered workload agent', async () => {
    agentBuilderService.getAgentForUser.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(invoke('UC44'));
    expect(res.status).toBe(200);
    expect(res.body.error).toBe('agent_not_registered');
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('UC44 requires an explicit vertical mapping', async () => {
    const { vertical, ...body } = invoke('UC44');
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(body);
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test.each(['unknown-vertical', 'airlines'])('rejects a missing or mismatched %s action mapping', async (vertical) => {
    const body = { ...invoke('UC44'), vertical };
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(body);
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('rejects an unknown use-case ID instead of falling back to a scenario', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain')
      .send({ ...invoke('UC44'), useCaseId: 'unknown-workload-scenario' });
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('rejects a non-string use-case ID', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain')
      .send({ ...invoke('UC44'), useCaseId: 44 });
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('rejects a prompt for another vertical instead of choosing that action', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain')
      .send({ ...invoke('UC44'), prompt: resolveUseCase('UC44', 'airlines').runPrompt });
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('rejects a browser-selected tool', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain')
      .send({ ...invoke('UC44'), toolName: 'create_transfer' });
    expect(res.status).toBe(400);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });
});
