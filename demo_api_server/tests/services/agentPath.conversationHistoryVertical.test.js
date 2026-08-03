'use strict';
/**
 * Conversation history was loaded from the RAW request param, not the resolved
 * vertical:
 *
 *   demoAgentLangGraphService.js:1795
 *   const verticalForHistory = vertical || 'banking';
 *
 * `activeId` — the documented precedence (explicit param -> this session's pin
 * -> banking) — is computed 25 lines earlier and used by toolSchemas,
 * systemPrompt and executeTool, but not here. So a session PINNED to healthcare
 * that sent no `vertical` body param (the SPA omits it on several paths) loaded
 * the user's BANKING thread and replayed it verbatim into a healthcare prompt.
 *
 * That is a cross-vertical leak of prior conversation content, distinct from the
 * tool-execution sites: no tool runs, the banking text is simply already in the
 * message array before the model is called.
 */

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async () => JSON.stringify({ ok: true })),
  executeBffToolWithToken: jest.fn(),
}));
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => false),
  delegateToSpecialist: jest.fn(),
}));
jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async ({ messages }) => {
    global.__capturedMessages = messages;
    return { ok: true, answer: 'ok', toolsCalled: [], inputTokens: 0, outputTokens: 0 };
  }),
}));
jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({
  getHistory: jest.fn(() => []),
  saveMessage: jest.fn(),
}));

function load() {
  require('../../services/verticalManifest').verticalManifest.init();
  const configStore = require('../../services/configStore');
  const realGet = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_heuristic_enabled') return 'false';
    if (k === 'agent_mode') return 'llamacpp';
    return realGet(k);
  });
  return {
    service: require('../../services/demoAgentLangGraphService'),
    conversationStore: require('../../services/lmdb/conversationStore.lmdb'),
  };
}

function runAgent(service, { vertical, sessionPin }) {
  global.__capturedMessages = null;
  return service.processAgentMessage({
    message: 'hello',
    vertical,
    userId: 'u1',
    userToken: 'tok',
    sessionId: 's1',
    tokenEvents: [],
    langchainConfig: {},
    req: { session: { active_vertical: sessionPin }, tokenEvents: [] },
  });
}

describe('conversation history is keyed on the RESOLVED vertical', () => {
  it('a session pinned to healthcare does not load the banking thread', async () => {
    const { service, conversationStore } = load();
    conversationStore.getHistory.mockImplementation((_u, v) => (
      v === 'banking'
        ? [{ role: 'assistant', content: 'Your BANKING-THREAD checking balance is $4,821.00' }]
        : []
    ));

    // No `vertical` body param — the session pin is the only signal.
    await runAgent(service, { vertical: undefined, sessionPin: 'healthcare' });

    expect(conversationStore.getHistory).toHaveBeenCalledWith('u1', 'healthcare');
    expect(conversationStore.getHistory).not.toHaveBeenCalledWith('u1', 'banking');
    expect(JSON.stringify(global.__capturedMessages)).not.toMatch(/BANKING-THREAD/);
  });

  it('an explicit param still wins over the session pin', async () => {
    const { service, conversationStore } = load();
    await runAgent(service, { vertical: 'retail', sessionPin: 'healthcare' });
    expect(conversationStore.getHistory).toHaveBeenCalledWith('u1', 'retail');
  });

  it('an unpinned, param-less session still uses banking (documented default)', async () => {
    const { service, conversationStore } = load();
    await runAgent(service, { vertical: undefined, sessionPin: undefined });
    expect(conversationStore.getHistory).toHaveBeenCalledWith('u1', 'banking');
  });
});
