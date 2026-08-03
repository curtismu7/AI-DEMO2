import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

export const executeRequestFeeWaiver: HandlerFn = async (deps, token, params) => {
  const { account_id, reason } = params as { account_id: string; reason?: string };
  const result = await deps.apiClient.requestFeeWaiver(token, account_id, reason || 'Customer request');
  const data = result as Record<string, any>;
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
