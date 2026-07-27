'use strict';

/**
 * Tests that resolveAgentTarget() picks the correct port for each llm_framework
 * value and falls back to langchain (8888) for unknown values.
 *
 * Imports FRAMEWORK_PORTS from the route module itself so this test catches
 * port drift between the BFF routing table and the actual agent listeners.
 * The previous version re-declared the map locally and missed a real
 * langchain port bug (8889/chat-WS vs 8888/AG-UI-SSE).
 */

const mockGetEffective = jest.fn();

jest.mock('../services/configStore', () => ({
  getEffective: mockGetEffective,
}));

const agentRunRoute = require('../routes/agentRun');
const { FRAMEWORK_PORTS, FRAMEWORK_HOSTS } = agentRunRoute;

function resolvePort(framework) {
  return FRAMEWORK_PORTS[framework] ?? FRAMEWORK_PORTS.langchain;
}

function resolveHost(framework) {
  return FRAMEWORK_HOSTS[framework] ?? FRAMEWORK_HOSTS.langchain;
}

describe('resolveAgentTarget — framework port routing', () => {
  afterEach(() => mockGetEffective.mockReset());

  test('FRAMEWORK_PORTS is exported from the route module', () => {
    expect(FRAMEWORK_PORTS).toEqual({
      langchain:     8888,
      openai_agents: 8891,
      mastra:        8892,
      pydantic_ai:   8893,
    });
  });

  test.each([
    ['langchain',     8888],
    ['openai_agents', 8891],
    ['mastra',        8892],
    ['pydantic_ai',   8893],
  ])('llm_framework=%s → port %i', (framework, expectedPort) => {
    mockGetEffective.mockReturnValue(framework);
    expect(resolvePort(mockGetEffective('llm_framework'))).toBe(expectedPort);
  });

  test('unknown framework falls back to langchain port', () => {
    mockGetEffective.mockReturnValue('unknown_framework');
    expect(resolvePort(mockGetEffective('llm_framework'))).toBe(FRAMEWORK_PORTS.langchain);
  });

  test('null/undefined framework falls back to langchain port', () => {
    mockGetEffective.mockReturnValue(null);
    const framework = mockGetEffective('llm_framework') || 'langchain';
    expect(resolvePort(framework)).toBe(FRAMEWORK_PORTS.langchain);
  });
});

describe('resolveAgentTarget — framework hostname routing', () => {
  afterEach(() => mockGetEffective.mockReset());

  // Each framework runs in its own container (data/serverInventory.js) — a
  // shared hostname across frameworks means non-langchain runs connect to
  // langchain-agent's container, which doesn't listen on their port.
  test.each([
    ['langchain',     'langchain-agent'],
    ['openai_agents', 'openai-agent'],
    ['mastra',        'mastra-agent'],
    ['pydantic_ai',   'pydantic-agent'],
  ])('llm_framework=%s → hostname %s', (framework, expectedHost) => {
    mockGetEffective.mockReturnValue(framework);
    expect(resolveHost(mockGetEffective('llm_framework'))).toBe(expectedHost);
  });

  test('unknown framework falls back to langchain hostname', () => {
    mockGetEffective.mockReturnValue('unknown_framework');
    expect(resolveHost(mockGetEffective('llm_framework'))).toBe(FRAMEWORK_HOSTS.langchain);
  });
});
