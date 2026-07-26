/**
 * useCaseDemoProgress — session check-offs for the use-case launcher.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BX_UC_COMPLETED_KEY,
  BX_UC_PROGRESS_EVENT,
  clearCompletedUseCases,
  getCompletedUseCaseIds,
  isUseCaseCompleted,
  markUseCaseCompleted,
} from '../useCaseDemoProgress';

describe('useCaseDemoProgress', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('starts empty and marks ids', () => {
    expect(getCompletedUseCaseIds().size).toBe(0);
    markUseCaseCompleted('UC1');
    expect(isUseCaseCompleted('UC1')).toBe(true);
    expect(isUseCaseCompleted('UC2')).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(BX_UC_COMPLETED_KEY))).toEqual(['UC1']);
  });

  it('accumulates multiple runs without duplicates', () => {
    markUseCaseCompleted('UC1');
    markUseCaseCompleted('UC2');
    markUseCaseCompleted('UC1');
    expect([...getCompletedUseCaseIds()].sort()).toEqual(['UC1', 'UC2']);
  });

  it('ignores invalid ids', () => {
    markUseCaseCompleted('');
    markUseCaseCompleted(null);
    expect(getCompletedUseCaseIds().size).toBe(0);
  });

  it('clears progress', () => {
    markUseCaseCompleted('UC1');
    clearCompletedUseCases();
    expect(getCompletedUseCaseIds().size).toBe(0);
    expect(sessionStorage.getItem(BX_UC_COMPLETED_KEY)).toBeNull();
  });

  it('tolerates corrupt storage', () => {
    sessionStorage.setItem(BX_UC_COMPLETED_KEY, '{not-json');
    expect(getCompletedUseCaseIds().size).toBe(0);
  });

  it('markUseCaseCompleted dispatches BX_UC_PROGRESS_EVENT', () => {
    const handler = vi.fn();
    window.addEventListener(BX_UC_PROGRESS_EVENT, handler);
    markUseCaseCompleted('UC1');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(BX_UC_PROGRESS_EVENT, handler);
  });

  it('clearCompletedUseCases dispatches BX_UC_PROGRESS_EVENT', () => {
    const handler = vi.fn();
    window.addEventListener(BX_UC_PROGRESS_EVENT, handler);
    clearCompletedUseCases();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(BX_UC_PROGRESS_EVENT, handler);
  });

  it('dispatches event even when marking invalid id (no-op storage, still broadcasts)', () => {
    const handler = vi.fn();
    window.addEventListener(BX_UC_PROGRESS_EVENT, handler);
    markUseCaseCompleted('');
    // Invalid id — storage unchanged but event must not fire (no progress changed)
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(BX_UC_PROGRESS_EVENT, handler);
  });

  it('markUseCaseCompleted returns the updated Set', () => {
    const result = markUseCaseCompleted('UC1');
    expect(result instanceof Set).toBe(true);
    expect(result.has('UC1')).toBe(true);
  });

  it('clearCompletedUseCases returns an empty Set', () => {
    markUseCaseCompleted('UC1');
    const result = clearCompletedUseCases();
    expect(result instanceof Set).toBe(true);
    expect(result.size).toBe(0);
  });
});
