import { BankingAPIError } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

export const executeQueryUserByEmail: HandlerFn = async (deps, token, params) => {
  const { email } = params as { email: string };
  try {
    deps.logger.debug(`[BankingToolProvider] Calling Banking API: queryUserByEmail`);
    const response = await deps.apiClient.queryUserByEmail(token, email);
    deps.logger.debug(`[BankingToolProvider] Banking API response: queryUserByEmail completed`);

    // Return the complete API response as JSON
    return createSuccessResult(JSON.stringify(response, null, 2));
  } catch (error) {
    // Handle 404 as a normal "not found" response rather than an error
    if (error instanceof BankingAPIError && error.statusCode === 404) {
      const notFoundResponse = {
        exists: false,
        email: email,
        error: "User not found"
      };
      return createSuccessResult(JSON.stringify(notFoundResponse, null, 2));
    }
    throw error; // Re-throw other errors to be handled by main executeTool method
  }
};
