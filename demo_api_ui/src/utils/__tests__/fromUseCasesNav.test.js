/**
 * fromUseCasesNav — session flag for TopNav "← Use Cases" back button.
 */
import {
  BX_FROM_USE_CASES_KEY,
  cameFromUseCases,
  clearCameFromUseCases,
  markCameFromUseCases,
} from '../fromUseCasesNav';

describe('fromUseCasesNav', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('marks and reads the launcher-origin flag', () => {
    expect(cameFromUseCases()).toBe(false);
    markCameFromUseCases();
    expect(sessionStorage.getItem(BX_FROM_USE_CASES_KEY)).toBe('1');
    expect(cameFromUseCases()).toBe(true);
  });

  it('clears the flag', () => {
    markCameFromUseCases();
    clearCameFromUseCases();
    expect(cameFromUseCases()).toBe(false);
    expect(sessionStorage.getItem(BX_FROM_USE_CASES_KEY)).toBeNull();
  });

  it('returns false when the stored value is not the marker', () => {
    sessionStorage.setItem(BX_FROM_USE_CASES_KEY, 'yes');
    expect(cameFromUseCases()).toBe(false);
  });
});
