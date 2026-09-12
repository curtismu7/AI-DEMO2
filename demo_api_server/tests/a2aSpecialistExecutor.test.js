'use strict';

jest.mock('../services/a2aDelegationService', () => ({
  ...jest.requireActual('../services/a2aDelegationService'),
  exchangeAsSpecialist: jest.fn(),
}));
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffToolWithToken: jest.fn(),
}));

const { exchangeAsSpecialist } = require('../services/a2aDelegationService');
const { executeBffToolWithToken } = require('../services/bffMcpToolExecutor');
const { makeSpecialistExecutor, assertSkillAllowed } = require('../services/a2aProtocolServer');
const { specialistForVertical } = require('../config/a2aSpecialists');

const SPECIALIST = specialistForVertical('investment');
const TOOL = SPECIALIST.tools[0];

function fakeRequestContext(text) {
  return {
    contextId: 'c1',
    taskId: 't1',
    userMessage: {
      parts: [{ content: { $case: 'text', value: text } }],
      metadata: { vertical: 'investment', tool: TOOL },
    },
  };
}

function capture() {
  const published = [];
  return { published, eventBus: { publish: (e) => published.push(e) } };
}

// eventBus receives an AgentEvent, which wraps the message: AgentEvent.message()
// returns { kind: 'message', data: <message> }. Unwrap it (tolerating a bare
// message) rather than reading .parts off the event, which is never there.
function replyOf(published) {
  const msg = published[0].data || published[0];
  const text = msg.parts
    .map((p) => (p?.content?.$case === 'text' ? p.content.value : ''))
    .join('');
  return { payload: JSON.parse(text), metadata: msg.metadata };
}

describe('specialist A2A executor', () => {
  beforeEach(() => jest.clearAllMocks());

  test('runs Exchange #2 then the tool, and returns DATA with no token', async () => {
    exchangeAsSpecialist.mockResolvedValue({
      token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: ['invest:read'],
    });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ positions: [{ symbol: 'VTI' }] }));

    const ctx = { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(exchangeAsSpecialist).toHaveBeenCalledWith('T.AGENT1', expect.objectContaining({ vertical: 'investment', tool: TOOL }));
    expect(executeBffToolWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: TOOL, suppliedToken: 'T.NESTED' }),
    );

    const { payload, metadata } = replyOf(published);
    expect(payload.result).toEqual({ positions: [{ symbol: 'VTI' }] });
    expect(payload.toolError).toBeNull();
    expect(metadata.actChainDepth).toBe(2);
    // No credential may appear anywhere in the reply.
    expect(JSON.stringify(published[0])).not.toMatch(/T\.NESTED|T\.AGENT1/);
  });

  test('serves locally only when the gateway recorded a PERMIT', async () => {
    const verticalDispatch = require('../services/verticalDispatch');
    exchangeAsSpecialist.mockResolvedValue({ token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: [] });
    executeBffToolWithToken.mockResolvedValue(
      JSON.stringify({ error: 'mcp_error', message: 'HTTP 502', gatewayDecision: 'PERMIT' }),
    );
    const schemas = jest.spyOn(verticalDispatch, 'toolSchemasFor').mockReturnValue([{ name: TOOL }]);
    const local = jest.spyOn(verticalDispatch, 'executeToolFor').mockResolvedValue({ result: { ok: 1 } });

    const ctx = { req: { sessionID: 's1', session: { user: { id: 'u1' } } }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(local).toHaveBeenCalledTimes(1);
    expect(replyOf(published).payload.result).toEqual({ ok: 1 });
    schemas.mockRestore();
    local.mockRestore();
  });

  test('does NOT serve locally without a PERMIT', async () => {
    const verticalDispatch = require('../services/verticalDispatch');
    exchangeAsSpecialist.mockResolvedValue({ token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: [] });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ error: 'mcp_error', message: 'socket hang up' }));
    const schemas = jest.spyOn(verticalDispatch, 'toolSchemasFor').mockReturnValue([{ name: TOOL }]);
    const local = jest.spyOn(verticalDispatch, 'executeToolFor').mockResolvedValue({ result: { ok: 1 } });

    const ctx = { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(local).not.toHaveBeenCalled();
    expect(replyOf(published).payload.toolError).toBe('mcp_error');
    schemas.mockRestore();
    local.mockRestore();
  });

  // REGRESSION_PLAN §1 (LLM token custody) + §4 2026-09-11 "No-gateway A2A
  // specialist calls could not complete": the local-serve gate accepts the
  // gateway's PERMIT *or*, with no gateway, the BFF gate's own PERMIT — that is
  // the enforcement point then. Pinned here because this executor re-implements
  // the gate that demoAgentLangGraphService.js owns today.
  test('serves locally with no gateway when the BFF gate itself PERMITted', async () => {
    const verticalDispatch = require('../services/verticalDispatch');
    exchangeAsSpecialist.mockResolvedValue({ token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: [] });
    executeBffToolWithToken.mockResolvedValue(
      JSON.stringify({ error: 'mcp_error', message: 'Upstream aud mismatch', gatewayDecision: null, bffDecision: 'PERMIT' }),
    );
    const schemas = jest.spyOn(verticalDispatch, 'toolSchemasFor').mockReturnValue([{ name: TOOL }]);
    const local = jest.spyOn(verticalDispatch, 'executeToolFor').mockResolvedValue({ result: { ok: 1 } });

    const ctx = { req: { sessionID: 's1', session: { user: { id: 'u1' } } }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(local).toHaveBeenCalledTimes(1);
    expect(replyOf(published).payload.result).toEqual({ ok: 1 });
    schemas.mockRestore();
    local.mockRestore();
  });

  test('refuses a skill the specialist does not own', () => {
    expect(() => assertSkillAllowed(SPECIALIST, 'transfer_money')).toThrow(/not authorized/i);
    expect(() => assertSkillAllowed(SPECIALIST, TOOL)).not.toThrow();
  });
});
