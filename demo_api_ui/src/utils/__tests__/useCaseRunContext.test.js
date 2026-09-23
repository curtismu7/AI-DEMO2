import { runContextFromLocation } from '../useCaseRunContext';
import { act, renderHook } from '@testing-library/react';
import { useUseCaseRunContext } from '../useCaseRunContext';

describe('runContextFromLocation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

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

  it('does not label an ordinary prompt-prefill as a Use Case launch', () => {
    expect(runContextFromLocation({
      pathname: '/dashboard',
      state: { triggerText: 'show my balance' },
    })).toBeNull();
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

  it('binds the selected scenario when a Demo Track step is picked', () => {
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));

    act(() => {
      window.dispatchEvent(new CustomEvent('agent-track-step-pick', {
        detail: {
          step: { stepId: 'UC1', title: 'Delegated access (consent only)', buyerStory: 'Show my reservations' },
        },
      }));
    });

    expect(result.current).toMatchObject({
      source: 'demo-track',
      useCaseId: 'UC1',
      useCaseLabel: 'Delegated access (consent only)',
      triggerText: 'Show my reservations',
    });
  });
});
