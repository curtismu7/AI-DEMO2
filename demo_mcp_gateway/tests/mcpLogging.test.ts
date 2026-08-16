'use strict';

/**
 * MCP Logging capability: logging/setLevel + notifications/message. The
 * gateway declared no `logging` capability and had no way to emit a
 * structured log message over the MCP channel at all (confirmed absent in
 * the MCP spec-compliance audit) — application-level console/pino logging
 * is not the same thing, it never reaches the connected client.
 */

import { isValidLogLevel, levelMeetsThreshold, emitLogMessage, LOG_LEVELS } from '../src/mcpLogging';

describe('isValidLogLevel', () => {
  it('accepts all 8 RFC 5424 severity levels', () => {
    for (const l of LOG_LEVELS) expect(isValidLogLevel(l)).toBe(true);
  });
  it('rejects an unknown level', () => {
    expect(isValidLogLevel('trace')).toBe(false);
    expect(isValidLogLevel(42)).toBe(false);
    expect(isValidLogLevel(undefined)).toBe(false);
  });
});

describe('levelMeetsThreshold', () => {
  it('returns false when no threshold has been set (client never called setLevel)', () => {
    expect(levelMeetsThreshold('error', undefined)).toBe(false);
  });
  it('returns true when the level is at or above the threshold', () => {
    expect(levelMeetsThreshold('error', 'warning')).toBe(true);
    expect(levelMeetsThreshold('warning', 'warning')).toBe(true);
  });
  it('returns false when the level is below the threshold', () => {
    expect(levelMeetsThreshold('debug', 'warning')).toBe(false);
  });
});

describe('emitLogMessage', () => {
  it('sends notifications/message when the level meets the threshold', () => {
    const send = jest.fn();
    emitLogMessage(send, { level: 'info' }, 'error', { detail: 'proxy failed' });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(send.mock.calls[0][0]);
    expect(sent).toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'error', data: { detail: 'proxy failed' } },
    });
  });

  it('includes logger name when provided', () => {
    const send = jest.fn();
    emitLogMessage(send, { level: 'info' }, 'error', { detail: 'x' }, 'gateway.proxy');
    const sent = JSON.parse(send.mock.calls[0][0]);
    expect(sent.params.logger).toBe('gateway.proxy');
  });

  it('does not send when the level is below the connection threshold', () => {
    const send = jest.fn();
    emitLogMessage(send, { level: 'error' }, 'debug', { detail: 'noisy' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when no threshold has been set at all', () => {
    const send = jest.fn();
    emitLogMessage(send, {}, 'emergency', { detail: 'x' });
    expect(send).not.toHaveBeenCalled();
  });
});
