import { describe, expect, it } from 'vitest';
import { isPublicUseCase, authLevelForUseCase } from '../useCaseAuth';

describe('useCaseAuth', () => {
  it('reads the level the server stamped on the entry', () => {
    expect(authLevelForUseCase({ id: 'UC24', auth: 'public' })).toBe('public');
    expect(authLevelForUseCase({ id: 'ADMIN1', auth: 'admin' })).toBe('admin');
    expect(authLevelForUseCase({ id: 'UC1', auth: 'user' })).toBe('user');
  });

  it('fails closed when the entry carries no level', () => {
    expect(authLevelForUseCase({ id: 'UC1' })).toBe('user');
    expect(authLevelForUseCase(null)).toBe('user');
    expect(authLevelForUseCase(undefined)).toBe('user');
    expect(isPublicUseCase({ id: 'UC24' })).toBe(false);
  });

  it('fails closed on a level it does not recognise', () => {
    expect(authLevelForUseCase({ id: 'UC1', auth: 'anonymous' })).toBe('user');
    expect(isPublicUseCase({ id: 'UC1', auth: 'PUBLIC' })).toBe(false);
  });

  it('only treats an explicit public level as guest-runnable', () => {
    expect(isPublicUseCase({ id: 'UC24', auth: 'public' })).toBe(true);
    expect(isPublicUseCase({ id: 'UC7', auth: 'user' })).toBe(false);
    expect(isPublicUseCase({ id: 'ADMIN1', auth: 'admin' })).toBe(false);
  });
});
