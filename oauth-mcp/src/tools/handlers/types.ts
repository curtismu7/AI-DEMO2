import type { BankingAPIClient } from '../../banking/BankingAPIClient';
import type { Logger } from '../../utils/Logger';
import type { BankingToolResult } from '../BankingToolProvider';

export interface HandlerDeps {
  apiClient: BankingAPIClient;
  logger: Logger;
}

export type HandlerFn = (
  deps: HandlerDeps,
  token: string,
  params: any,
) => Promise<BankingToolResult>;
