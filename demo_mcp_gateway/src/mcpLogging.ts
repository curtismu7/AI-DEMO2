'use strict';

/**
 * MCP Logging capability — logging/setLevel + notifications/message.
 *
 * Distinct from this codebase's application-level console/pino logging:
 * that never reaches the connected MCP client. This is the protocol-level
 * channel the spec defines for a server to push structured log messages
 * to whichever client asked for them, at a level the client controls.
 */

// RFC 5424 syslog severities, as the MCP spec defines them, in ascending order.
export const LOG_LEVELS = [
  'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
] as const;

export type McpLogLevel = (typeof LOG_LEVELS)[number];

export function isValidLogLevel(v: unknown): v is McpLogLevel {
  return typeof v === 'string' && (LOG_LEVELS as readonly string[]).includes(v);
}

/** A client that never called logging/setLevel gets no notifications at all. */
export function levelMeetsThreshold(level: McpLogLevel, threshold: McpLogLevel | undefined): boolean {
  if (!threshold) return false;
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

export interface LoggingState {
  level?: McpLogLevel;
}

export function emitLogMessage(
  send: (s: string) => void,
  state: LoggingState,
  level: McpLogLevel,
  data: unknown,
  logger?: string,
): void {
  if (!levelMeetsThreshold(level, state.level)) return;
  send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level, ...(logger ? { logger } : {}), data },
  }));
}
