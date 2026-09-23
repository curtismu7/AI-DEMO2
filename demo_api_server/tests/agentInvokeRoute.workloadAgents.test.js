'use strict';

const express = require('express');
const request = require('supertest');
const { resolveUseCase, VERTICALS } = require('../config/useCases');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { toolForAction } = require('../services/stepVerificationExpectations');
const mockConfig = {};

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
  getEffective: jest.fn((key) => mockConfig[key] ?? ({ ff_intent_authorization_enabled: 'false', ff_intent_token_enabled: 'false' })[key]),
}));
jest.mock('../services/verticalMcpExecution', () => ({
  executePluginToolViaMcp: jest.fn(async () => ({ out: { result: { items: [] }, render: 'text' } })),
}));
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async () => ({ ok: true, answer: 'LLM chose a tool', toolsCalled: [] })),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));
jest.mock('../services/lmdb/conversationStore.lmdb', () => ({ saveMessage: jest.fn() }));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');
const agentBuilderService = require('../services/agentBuilderService');
const { runReasonLoop } = require('../services/agentReasoningClient');
const app = express();
app.use('/api', require('../routes/agentInvokeRoute'));

const invoke = (id, vertical = 'sporting-goods') => ({
  prompt: resolveUseCase(id, vertical).runPrompt,
  vertical,
  useCaseId: resolveUseCase(id, vertical).useCaseId,
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
});

describe('workload agent invoke contract', () => {
  test.each(['UC38', 'UC44'])('%s catalog prompts resolve to their tool in every vertical', (id) => {
    for (const vertical of VERTICALS) {
      const scenario = resolveUseCase(id, vertical);
      const heuristic = parseHeuristic(scenario.runPrompt, vertical, resolveVerticalCtx(vertical), {});
      const action = heuristic?.banking?.action || heuristic?.action;
      expect(toolForAction(action, vertical)).toBe(scenario.primaryTool);
    }
  });

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

  test('UC45 keeps its existing MFA step-up before worker execution', async () => {
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain')
      .send({ prompt: 'show my reservations', vertical: 'airlines', useCaseId: 'saas-embedded-worker' });
    expect(res.status).toBe(200);
    expect(res.body.error).toBe('step_up_required');
    expect(agentBuilderService.getAgentForUser).not.toHaveBeenCalled();
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test.each(['UC38', 'UC44'])('%s dispatches its catalog tool even in BFF LLM-only mode', async (id) => {
    mockConfig.agent_mode = 'gemini';
    mockConfig.agent_external_wiring = 'bff';
    mockConfig.ff_heuristic_enabled = 'false';
    processAgentMessage.mockImplementationOnce((args) => {
      expect(args.req.body.forceHeuristic).toBe(true);
      return jest.requireActual('../services/demoAgentLangGraphService').processAgentMessage(args);
    });
    const body = invoke(id);
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer mfa')
      .send({ ...body, forceHeuristic: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.toolsCalled).toEqual([resolveUseCase(id, body.vertical).primaryTool]);
    expect(runReasonLoop).not.toHaveBeenCalled();
  });

  test('workload actions fail closed when platform wiring would bypass the heuristic constraint', async () => {
    mockConfig.agent_mode = 'gemini';
    mockConfig.agent_external_wiring = 'platform';
    const res = await request(app).post('/api/agent/invoke').set('Authorization', 'Bearer plain').send(invoke('UC44'));
    expect(res.status).toBe(409);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('anonymous UC44 still returns 401 when platform wiring is selected', async () => {
    mockConfig.agent_mode = 'gemini';
    mockConfig.agent_external_wiring = 'platform';
    const res = await request(app).post('/api/agent/invoke').send(invoke('UC44'));
    expect(res.status).toBe(401);
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
