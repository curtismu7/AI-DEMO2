import { executeGetMyAccounts, executeGetAccountBalance, executeGetSensitiveAccountDetails, executeUpdateContactEmail } from './accountHandlers';
import { executeGetMyTransactions, executeCreateDeposit, executeCreateWithdrawal, executeCreateTransfer } from './transactionHandlers';
import { executeQueryUserByEmail } from './identityHandlers';
import { executeSequentialThink } from './reasoningHandlers';
import { executeRequestFeeWaiver } from './commitmentHandlers';
import { verticalHandlerMap } from './verticalHandlers';
import {
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
} from '../adminToolHandlers';
import type { HandlerFn } from './types';

export const handlerMap: Record<string, HandlerFn> = {
  executeGetMyAccounts,
  executeGetAccountBalance,
  executeUpdateContactEmail,
  executeGetMyTransactions,
  executeCreateDeposit,
  executeCreateWithdrawal,
  executeCreateTransfer,
  executeQueryUserByEmail,
  executeGetSensitiveAccountDetails,
  executeSequentialThink,
  executeRequestFeeWaiver,
  ...verticalHandlerMap,
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
};

export type { HandlerFn, HandlerDeps } from './types';
