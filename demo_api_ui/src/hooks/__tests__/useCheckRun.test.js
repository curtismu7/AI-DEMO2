import { renderHook, act } from '@testing-library/react';
import { deriveVerdict } from '../useCheckRun';

describe('deriveVerdict', () => {
  test('null when empty', () => { expect(deriveVerdict({})).toBe(null); });
  test('ready when all pass', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'skip' } })).toBe('ready');
  });
  test('warn precedence', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'warn' } })).toBe('ready_with_warnings');
  });
  test('fail wins', () => {
    expect(deriveVerdict({ a: { status: 'warn' }, b: { status: 'fail' } })).toBe('not_ready');
  });
});
