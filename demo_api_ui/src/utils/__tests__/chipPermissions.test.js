/**
 * chipPermissions — chip permission gating shared by BankingChips and SecurityShowcasePanel.
 */
import { describe, it, expect } from 'vitest';
import { chipPermState } from '../chipPermissions';

describe('chipPermState', () => {
  it('returns show=true, denied=false when chip has no tool', () => {
    expect(chipPermState({ label: 'Balance' })).toEqual({ show: true, denied: false });
    expect(chipPermState({ label: 'Balance', tool: undefined })).toEqual({ show: true, denied: false });
  });

  it('returns show=true, denied=false when tool is not in permissions map', () => {
    const result = chipPermState({ tool: 'view_balance' }, {});
    expect(result).toEqual({ show: true, denied: false });
  });

  it('returns show=true, denied=false when tool is permitted=true', () => {
    const result = chipPermState(
      { tool: 'view_balance' },
      { view_balance: { permitted: true } },
    );
    expect(result).toEqual({ show: true, denied: false });
  });

  it('returns show=true, denied=true when tool is explicitly denied', () => {
    const result = chipPermState(
      { tool: 'create_transfer' },
      { create_transfer: { permitted: false, deniedReason: 'Insufficient scope' } },
    );
    expect(result.show).toBe(true);
    expect(result.denied).toBe(true);
    expect(result.reason).toBe('Insufficient scope');
  });

  it('does NOT deny when toolsError is true (fail-open on discovery blips)', () => {
    const result = chipPermState(
      { tool: 'view_balance' },
      {},
      true, // toolsError
    );
    expect(result.denied).toBe(false);
  });

  it('does NOT deny when toolPermissions is null/undefined', () => {
    expect(chipPermState({ tool: 'view_balance' }, null).denied).toBe(false);
    expect(chipPermState({ tool: 'view_balance' }, undefined).denied).toBe(false);
  });
});
