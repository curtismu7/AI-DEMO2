import { worst } from '../status';

describe('worst', () => {
  it('returns idle for an empty list', () => {
    expect(worst([])).toBe('idle');
  });

  it('returns skip, not pass, when every check was skipped', () => {
    expect(worst(['skip', 'skip'])).toBe('skip');
  });

  it('returns pass when at least one check passed and none failed/warned', () => {
    expect(worst(['skip', 'pass'])).toBe('pass');
  });

  it('returns fail when any check failed', () => {
    expect(worst(['pass', 'warn', 'fail'])).toBe('fail');
  });
});
