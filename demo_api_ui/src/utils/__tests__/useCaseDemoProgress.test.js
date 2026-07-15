/**
 * useCaseDemoProgress — session check-offs for the use-case launcher.
 */
import {
  BX_UC_COMPLETED_KEY,
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
});
