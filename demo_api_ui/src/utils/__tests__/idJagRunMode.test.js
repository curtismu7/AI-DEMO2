import { beforeEach, describe, expect, it } from 'vitest';
import {
  ID_JAG_USE_CASE_ID,
  RUN_MODES,
  createIdJagLaunchIntent,
  isIdJagRunMode,
  requestLiveIdJagRun,
  requestMockIdJagReplay,
  clearIdJagRunState,
} from '../idJagRunMode';
import { createMockIdJagTrace } from '../idJagMockTrace';
import { getUseCaseRunContext, setUseCaseRunContext } from '../useCaseRunContext';

describe('ID-JAG run-mode contract', () => {
  beforeEach(() => sessionStorage.clear());

  it('accepts only the two explicit ID-JAG modes', () => {
    expect(isIdJagRunMode(RUN_MODES.LIVE_ID_JAG)).toBe(true);
    expect(isIdJagRunMode(RUN_MODES.MOCK_ID_JAG)).toBe(true);
    expect(isIdJagRunMode(RUN_MODES.STANDARD)).toBe(false);
    expect(isIdJagRunMode('id-jag')).toBe(false);
  });

  it('bounds a live launch to UC40, a short message, and a same-origin path', () => {
    expect(createIdJagLaunchIntent({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance',
      returnTo: '/pingfederate-id-jag/demo',
    })).toEqual({
      useCaseId: ID_JAG_USE_CASE_ID,
      mode: 'live-id-jag',
      message: 'show my balance',
      returnTo: '/pingfederate-id-jag/demo',
    });
    expect(() => createIdJagLaunchIntent({ mode: RUN_MODES.STANDARD, message: 'show my balance', returnTo: '/dashboard' })).toThrow();
    expect(() => createIdJagLaunchIntent({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: 'https://evil.example' })).toThrow();
    expect(() => createIdJagLaunchIntent({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '//evil.example' })).toThrow();
    expect(() => createIdJagLaunchIntent({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/\\evil.example' })).toThrow();
    expect(() => createIdJagLaunchIntent({ mode: RUN_MODES.LIVE_ID_JAG, message: 'x'.repeat(257), returnTo: '/dashboard' })).toThrow();
  });

  it('dispatches the validated live intent without sending an agent prompt', () => {
    const heard = [];
    const onRun = (event) => heard.push(event.detail);
    const onPrefill = (event) => heard.push(event.type);
    window.addEventListener('id-jag-run-requested', onRun);
    window.addEventListener('banking-agent-prefill', onPrefill);
    try {
      requestLiveIdJagRun({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' });
      expect(heard).toEqual([{ useCaseId: ID_JAG_USE_CASE_ID, mode: 'live-id-jag', message: 'show my balance', returnTo: '/dashboard' }]);
    } finally {
      window.removeEventListener('id-jag-run-requested', onRun);
      window.removeEventListener('banking-agent-prefill', onPrefill);
    }
  });

  it('dispatches an offline replay with mock provenance and no live-token material', () => {
    const heard = [];
    const onMock = (event) => heard.push(event.detail);
    window.addEventListener('id-jag-mock-replay-requested', onMock);
    try {
      requestMockIdJagReplay();
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({
        provenance: 'mock-id-jag',
        tokenEvents: [{ id: 'id-jag-issued' }, { id: 'id-jag-redeemed' }],
      });
      expect(heard[0]).toEqual(createMockIdJagTrace());
      const serialized = JSON.stringify(heard[0]);
      expect(serialized).toContain('mock-pingfederate');
      expect(serialized).not.toMatch(/https?:\/\/|eyJ[A-Za-z0-9_-]{20,}|Bearer /);
    } finally {
      window.removeEventListener('id-jag-mock-replay-requested', onMock);
    }
  });

  it('clears only ID-JAG state and announces the reset', () => {
    sessionStorage.setItem('bx_id_jag_pending_intent', 'pending');
    sessionStorage.setItem('unrelated-presenter-state', 'keep');
    setUseCaseRunContext({ useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', autoSend: true, mode: RUN_MODES.LIVE_ID_JAG });
    const heard = [];
    const onClear = () => heard.push('cleared');
    window.addEventListener('id-jag-run-cleared', onClear);
    try {
      clearIdJagRunState();
      expect(sessionStorage.getItem('bx_id_jag_pending_intent')).toBeNull();
      expect(sessionStorage.getItem('unrelated-presenter-state')).toBe('keep');
      expect(getUseCaseRunContext()).toEqual({ useCaseId: ID_JAG_USE_CASE_ID, message: 'show my balance', autoSend: true });
      expect(heard).toEqual(['cleared']);
    } finally {
      window.removeEventListener('id-jag-run-cleared', onClear);
    }
  });
});
