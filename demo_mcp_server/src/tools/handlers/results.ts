import type { BankingToolResult } from '../BankingToolProvider';

export function createSuccessResult(text: string, data?: Record<string, any>): BankingToolResult {
  return {
    type: 'text',
    text,
    success: true,
    ...(data !== undefined ? { structuredContent: data } : {}),
  };
}

export function createErrorResult(error: string): BankingToolResult {
  return {
    type: 'text',
    text: `Error: ${error}`,
    success: false,
    error,
  };
}