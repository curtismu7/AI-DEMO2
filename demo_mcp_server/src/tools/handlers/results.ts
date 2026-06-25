import type { BankingToolResult } from '../BankingToolProvider';

export function createSuccessResult(text: string): BankingToolResult {
  return {
    type: 'text',
    text,
    success: true,
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
