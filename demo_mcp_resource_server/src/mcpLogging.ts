'use strict';

/**
 * MCP Logging capability — logging/setLevel + notifications/message.
 * Mirrors demo_mcp_gateway/src/mcpLogging.ts.
 */

export const LOG_LEVELS = [
  'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
] as const;

export type McpLogLevel = (typeof LOG_LEVELS)[number];

export function isValidLogLevel(v: unknown): v is McpLogLevel {
  return typeof v === 'string' && (LOG_LEVELS as readonly string[]).includes(v);
}

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
