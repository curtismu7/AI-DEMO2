import { runContextFromLocation } from '../useCaseRunContext';

describe('runContextFromLocation', () => {
  it('returns the launcher context for a Use Case dashboard navigation', () => {
    expect(runContextFromLocation({
      pathname: '/dashboard',
      state: {
        triggerText: 'show my balance',
        runContext: { source: 'use-cases', useCaseId: 'audit-trail' },
      },
    })).toEqual({ source: 'use-cases', useCaseId: 'audit-trail' });
  });

  it('returns null for a direct dashboard navigation', () => {
    expect(runContextFromLocation({ pathname: '/dashboard', state: null })).toBeNull();
  });
});
