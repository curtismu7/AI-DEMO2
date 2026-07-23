// demo_api_ui/src/services/__tests__/demoAgentService.auth401.test.js
/**
 * Overnight session expiry: sendAgentMessage must normalize 401 bodies so the
 * agent never surfaces raw "Unauthorized" / "HTTP 401" to the user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mcpFlowSseClient', () => ({
  openMcpFlowSse: () => () => {},
}));

vi.mock('../apiTrafficStore', () => ({
  appendTokenEvents: vi.fn(),
  setCurrentTurn: vi.fn(),
  clearCurrentTurn: vi.fn(),
}));

vi.mock('../agentFlowDiagramService', () => ({
  agentFlowDiagram: { applyServerEvent: vi.fn() },
}));

vi.mock('../tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    beginTrace: vi.fn(),
    ingestRoutingMode: vi.fn(),
    ingestAuthorize: vi.fn(),
    ingestTokenEvents: vi.fn(),
    ingestMcpResult: vi.fn(),
    ingestLlmReply: vi.fn(),
    completeTrace: vi.fn(),
    getState: () => ({ trace: { tokenEvents: [] } }),
  },
}));

const notifySpy = vi.fn();
vi.mock('../../utils/authUi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notifySessionExpiredIfNeeded: (...args) => {
      notifySpy(...args);
      return actual.notifySessionExpiredIfNeeded(...args);
    },
  };
});

describe('sendAgentMessage 401 normalization', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    notifySpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes Session expired 401 after failed refresh', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      clone() {
        return this;
      },
      json: async () => ({
        error: 'Session expired',
        message: 'Could not refresh session. Please log in again.',
        need_auth: true,
      }),
    });

    const { sendAgentMessage } = await import('../demoAgentService');
    const result = await sendAgentMessage('show my balance', null, {
      forceHeuristic: true,
      vertical: 'banking',
    });

    expect(result.error).toBe('session_expired');
    expect(result.need_auth).toBe(true);
    expect(result.requiresLogin).toBe(true);
    expect(result._status).toBe(401);
    expect(result.message).toMatch(/log in again|sign in/i);
    expect(notifySpy).toHaveBeenCalled();
  });
});