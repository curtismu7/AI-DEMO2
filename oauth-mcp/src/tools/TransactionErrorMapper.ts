/**
 * Maps transactional banking errors (deposit / withdrawal / transfer) into structured
 * BankingToolResults. Returns null when the error is not a recognised code so the caller
 * can re-throw.
 *
 * Extracted from BankingToolProvider.handleTransactionBankingError. Behavior is identical;
 * only relocation.
 */
import { BankingAPIError } from '../interfaces/banking';
import type { BankingToolResult } from './BankingToolProvider';
import { createSuccessResult } from './handlers/results';

export type TransactionOperation = 'deposit' | 'withdrawal' | 'transfer';

const HITL_THRESHOLD_USD = Number(process.env.HITL_THRESHOLD_USD ?? 500);

export function mapTransactionError(
  error: unknown,
  operationLabel: TransactionOperation,
  amount: number,
): BankingToolResult | null {
  if (!(error instanceof BankingAPIError)) {
    console.log(`[DEBUG-MCP-ERROR] ❌ Not a BankingAPIError, ignoring: ${error}`);
    return null;
  }
  const axiosData = (error.originalError?.response?.data ?? {}) as Record<string, unknown>;

  console.log(`[DEBUG-MCP-HANDLER] 🔍 MCP ERROR HANDLER - Processing error:
  errorCode: ${error.errorCode}
  operationLabel: ${operationLabel}
  amount: $${amount}
  apiErrorDebugHitl: ${axiosData.debug_hitl_check}
  apiErrorDebugStepup: ${axiosData.debug_stepup_check}`);

  if (error.errorCode === 'amount_exceeds_hard_limit') {
    const limit = typeof axiosData['limit'] === 'number' ? axiosData['limit'] : 1000;
    const insufficientFundsAlso = axiosData['insufficient_funds_also'] === true;
    const reasonNote = insufficientFundsAlso
      ? `Note: your account also has insufficient funds for this amount.`
      : `This is a system limit set by the administrator (separate from your account balance).`;
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'amount_exceeds_hard_limit',
          message: `The maximum ${operationLabel} amount is $${limit} per transaction. You requested $${amount}. ${reasonNote} Would you like me to try a smaller amount instead?`,
          limit,
          amount,
        },
        null,
        2
      )
    );
  }

  if (error.errorCode === 'hitl_required') {
    const hitlType: string = typeof (axiosData['hitl'] as any)?.type === 'string'
      ? (axiosData['hitl'] as any).type : 'consent';
    console.log(`[MCP-CONSENT] hitl_required (type=${hitlType}) for ${operationLabel} $${amount}`);
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'hitl_required',
          hitl: { type: hitlType },
          message: error.message,
          hitl_threshold_usd: HITL_THRESHOLD_USD,
          amount: amount,
          type: operationLabel,
          fromAccountId: typeof axiosData['fromAccountId'] === 'string' ? axiosData['fromAccountId'] : null,
          toAccountId: typeof axiosData['toAccountId'] === 'string' ? axiosData['toAccountId'] : null,
        },
        null,
        2
      )
    );
  }

  if (error.errorCode === 'step_up_required') {
    const stepUpMethod: string = typeof axiosData['step_up_method'] === 'string'
      ? (axiosData['step_up_method'] as string) : 'email';
    console.log(`[MCP-STEPUP] step_up_required method=${stepUpMethod} for ${operationLabel} $${amount}`);
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'step_up_required',
          hitl: { type: 'step_up' },
          step_up_required: true,
          step_up_method: stepUpMethod,
          message: `This transaction requires additional authentication (${stepUpMethod.toUpperCase()}). Please complete the step-up verification to proceed.`,
          amount_threshold: typeof axiosData['amount_threshold'] === 'number' ? axiosData['amount_threshold'] : null,
        },
        null,
        2
      )
    );
  }

  return null;
}
