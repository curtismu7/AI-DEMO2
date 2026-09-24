import { beforeEach, describe, expect, it } from 'vitest';
import { RUN_MODES } from '../idJagRunMode';
import { getUseCaseRunContext, setUseCaseRunContext } from '../useCaseRunContext';

describe('use-case run context', () => {
  beforeEach(() => sessionStorage.clear());

  it('round trips existing event fields while keeping standard mode optional', () => {
    setUseCaseRunContext({ useCaseId: 'UC1', message: 'show my balance', autoSend: true });
    expect(getUseCaseRunContext()).toEqual({ useCaseId: 'UC1', message: 'show my balance', autoSend: true });
    setUseCaseRunContext({ useCaseId: 'enterprise-managed-mcp-authorization', message: 'show my balance', autoSend: true, mode: RUN_MODES.LIVE_ID_JAG });
    expect(getUseCaseRunContext()).toEqual({ useCaseId: 'enterprise-managed-mcp-authorization', message: 'show my balance', autoSend: true, mode: 'live-id-jag' });
  });

  it('drops stale ID-JAG mode on logout while retaining ordinary context fields', () => {
    setUseCaseRunContext({ useCaseId: 'UC1', message: 'next', mode: RUN_MODES.LIVE_ID_JAG });
    window.dispatchEvent(new Event('userLoggedOut'));
    expect(getUseCaseRunContext()).toEqual({ useCaseId: 'UC1', message: 'next' });
  });

  it('drops stale mode on ordinary login, including an unvalidated mode hint', () => {
    setUseCaseRunContext({ useCaseId: 'UC1', message: 'next', mode: RUN_MODES.LIVE_ID_JAG });
    window.dispatchEvent(new CustomEvent('userAuthenticated', { detail: { mode: RUN_MODES.LIVE_ID_JAG } }));
    expect(getUseCaseRunContext()).toEqual({ useCaseId: 'UC1', message: 'next' });
  });

  it('keeps the mode only for an explicitly validated UC40 callback', () => {
    setUseCaseRunContext({ useCaseId: 'enterprise-managed-mcp-authorization', message: 'show my balance', mode: RUN_MODES.LIVE_ID_JAG });
    window.dispatchEvent(new CustomEvent('userAuthenticated', {
      detail: { idJagCallbackValidated: true, useCaseId: 'enterprise-managed-mcp-authorization', mode: RUN_MODES.LIVE_ID_JAG },
    }));
    expect(getUseCaseRunContext().mode).toBe('live-id-jag');
  });
});
