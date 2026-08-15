'use strict';

/**
 * MCP Logging capability — logging/setLevel + notifications/message.
 * Mirrors demo_mcp_gateway/src/mcpLogging.ts (same monorepo, separately
 * deployed services, no cross-package import).
 */

import { isValidLogLevel, levelMeetsThreshold, emitLogMessage, LOG_LEVELS } from '../src/mcpLogging';

describe('isValidLogLevel', () => {
  it('accepts all 8 RFC 5424 severity levels', () => {
    for (const l of LOG_LEVELS) expect(isValidLogLevel(l)).toBe(true);
  });
  it('rejects an unknown level', () => {
    expect(isValidLogLevel('trace')).toBe(false);
  });
});

describe('levelMeetsThreshold', () => {
  it('returns false when no threshold has been set', () => {
    expect(levelMeetsThreshold('error', undefined)).toBe(false);
  });
  it('returns true when the level is at or above the threshold', () => {
    expect(levelMeetsThreshold('error', 'warning')).toBe(true);
  });
});

describe('emitLogMessage', () => {
  it('sends notifications/message when the level meets the threshold', () => {
    const send = jest.fn();
    emitLogMessage(send, { level: 'info' }, 'error', { detail: 'db error' }, 'resource-server.db');
    const sent = JSON.parse(send.mock.calls[0][0]);
    expect(sent).toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'error', logger: 'resource-server.db', data: { detail: 'db error' } },
    });
  });

  it('does not send below threshold', () => {
    const send = jest.fn();
    emitLogMessage(send, { level: 'error' }, 'debug', { detail: 'x' });
    expect(send).not.toHaveBeenCalled();
  });
});
