import { runContextFromLocation } from '../useCaseRunContext';
import { renderHook } from '@testing-library/react';
import { useUseCaseRunContext } from '../useCaseRunContext';

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

  it('clears context after a route transition with null state', () => {
    const { result, rerender } = renderHook(
      ({ location }) => useUseCaseRunContext(location),
      {
        initialProps: {
          location: {
            pathname: '/dashboard',
            state: {
              triggerText: 'show my balance',
              runContext: { source: 'use-cases', useCaseId: 'audit-trail' },
            },
          },
        },
      },
    );

    expect(result.current.useCaseId).toBe('audit-trail');
    rerender({ location: { pathname: '/use-cases', state: null } });
    rerender({ location: { pathname: '/dashboard', state: null } });
    expect(result.current).toBeNull();
  });
});
