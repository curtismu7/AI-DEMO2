import { mapTransactionError } from '../../src/tools/TransactionErrorMapper';
import { BankingAPIError } from '../../src/interfaces/banking';

describe('mapTransactionError', () => {
  it('returns null for non-BankingAPIError', () => {
    expect(mapTransactionError(new Error('plain'), 'deposit', 100)).toBeNull();
  });

  it('returns null for unrecognised errorCode', () => {
    const err = new BankingAPIError('boom', 400, 'unrecognized_code');
    expect(mapTransactionError(err, 'deposit', 100)).toBeNull();
  });

  it('maps amount_exceeds_hard_limit with limit from response', () => {
    const err = new BankingAPIError('exceeds', 400, 'amount_exceeds_hard_limit');
    (err as any).originalError = { response: { data: { limit: 750 } } };
    const result = mapTransactionError(err, 'transfer', 2000);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('amount_exceeds_hard_limit');
    expect(payload.limit).toBe(750);
    expect(payload.amount).toBe(2000);
  });

  it('maps amount_exceeds_hard_limit with default limit when missing', () => {
    const err = new BankingAPIError('exceeds', 400, 'amount_exceeds_hard_limit');
    (err as any).originalError = { response: { data: {} } };
    const result = mapTransactionError(err, 'withdrawal', 1500);
    const payload = JSON.parse(result!.text);
    expect(payload.limit).toBe(1000);
  });

  it('maps hitl_required with hitl.type from response', () => {
    const err = new BankingAPIError('hitl', 428, 'hitl_required');
    (err as any).originalError = { response: { data: { hitl: { type: 'step_up' } } } };
    const result = mapTransactionError(err, 'transfer', 600);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('hitl_required');
    expect(payload.hitl.type).toBe('step_up');
    expect(payload.amount).toBe(600);
  });

  it('maps step_up_required with method', () => {
    const err = new BankingAPIError('stepup', 428, 'step_up_required');
    (err as any).originalError = { response: { data: { step_up_method: 'sms' } } };
    const result = mapTransactionError(err, 'transfer', 800);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('step_up_required');
    expect(payload.step_up_method).toBe('sms');
  });
});
