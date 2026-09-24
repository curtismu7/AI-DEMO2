import { act, renderHook } from '@testing-library/react';
import { runContextFromLocation, useUseCaseRunContext, RUN_CONTEXT_STORAGE_KEY } from '../useCaseRunContext';
import { ID_JAG_USE_CASE_ID, RUN_MODES, clearIdJagRunState, requestLiveIdJagRun } from '../idJagRunMode';

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

  it('persists ID-JAG mode on the existing prefill binding and clears UC40 on ordinary login', () => {
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));
    act(() => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
      detail: { useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', autoSend: true, mode: RUN_MODES.LIVE_ID_JAG },
    })));
    expect(result.current).toMatchObject({ useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG });
    expect(JSON.parse(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).mode).toBe(RUN_MODES.LIVE_ID_JAG);

    act(() => window.dispatchEvent(new CustomEvent('userAuthenticated', { detail: { mode: RUN_MODES.LIVE_ID_JAG } })));
    expect(result.current).toBeNull();
    expect(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).toBeNull();
  });

  it('clears a UC40 launch on logout but leaves an unrelated event-bound context alone', () => {
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));
    act(() => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
      detail: { useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', mode: RUN_MODES.LIVE_ID_JAG },
    })));
    act(() => window.dispatchEvent(new Event('userLoggedOut')));
    expect(result.current).toBeNull();
    expect(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).toBeNull();

    act(() => window.dispatchEvent(new CustomEvent('agent-track-step-pick', {
      detail: { step: { stepId: 'UC1', title: 'Delegated access', buyerStory: 'Show reservations' } },
    })));
    act(() => window.dispatchEvent(new Event('userAuthenticated')));
    expect(result.current).toMatchObject({ source: 'demo-track', useCaseId: 'UC1' });
    expect(JSON.parse(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).useCaseId).toBe('UC1');
  });

  it('keeps UC40 mode only after a validated ID-JAG callback', () => {
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));
    act(() => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
      detail: { useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', mode: RUN_MODES.LIVE_ID_JAG },
    })));
    act(() => window.dispatchEvent(new CustomEvent('userAuthenticated', {
      detail: { idJagCallbackValidated: true, useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG },
    })));
    expect(result.current).toMatchObject({ useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG });
  });

  it('keeps a single pending launch through an ID-JAG handoff logout while clearing its old context', () => {
    const heard = [];
    const onRun = (event) => heard.push(event.detail);
    window.addEventListener('id-jag-run-requested', onRun);
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));
    const intent = { mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' };
    try {
      act(() => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
        detail: { useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', mode: RUN_MODES.LIVE_ID_JAG },
      })));
      act(() => requestLiveIdJagRun(intent));
      act(() => window.dispatchEvent(new CustomEvent('userLoggedOut', { detail: { idJagHandoff: true } })));
      expect(result.current).toBeNull();
      expect(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).toBeNull();
      act(() => requestLiveIdJagRun(intent));
      expect(heard).toHaveLength(1);
    } finally {
      window.removeEventListener('id-jag-run-requested', onRun);
      act(() => clearIdJagRunState());
    }
  });

  it('clears UC40 in memory when the explicit ID-JAG reset event fires', () => {
    const { result } = renderHook(() => useUseCaseRunContext({ pathname: '/dashboard', state: null }));
    act(() => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
      detail: { useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', mode: RUN_MODES.LIVE_ID_JAG },
    })));
    act(() => clearIdJagRunState());
    expect(result.current).toBeNull();
    expect(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).toBeNull();
  });
});
