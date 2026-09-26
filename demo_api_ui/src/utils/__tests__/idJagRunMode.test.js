import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ID_JAG_USE_CASE_ID,
  RUN_MODES,
  createIdJagLaunchIntent,
  isIdJagRunMode,
  requestLiveIdJagRun,
  requestMockIdJagReplay,
  clearIdJagRunState,
  completeIdJagRunHandoff,
} from '../idJagRunMode';
import { createMockIdJagTrace } from '../idJagMockTrace';
import { RUN_CONTEXT_STORAGE_KEY } from '../useCaseRunContext';

describe('ID-JAG run-mode contract', () => {
  beforeEach(() => {
    clearIdJagRunState();
    sessionStorage.clear();
  });

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

  it('emits only one launch while the handoff is pending, then permits a new run after reset', () => {
    const heard = [];
    const onRun = (event) => heard.push(event.detail);
    window.addEventListener('id-jag-run-requested', onRun);
    const detail = { mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' };
    try {
      requestLiveIdJagRun(detail);
      requestLiveIdJagRun(detail);
      expect(heard).toHaveLength(1);
      clearIdJagRunState();
      requestLiveIdJagRun(detail);
      expect(heard).toHaveLength(2);
    } finally {
      window.removeEventListener('id-jag-run-requested', onRun);
    }
  });

  it('auto-recovers when a stale pending intent deadlocks the launch guard', () => {
    // Simulate the exact stuck state from the 2026-09-26 UC40 incident: a
    // pending intent with no createdAt (pre-fix format) plus the in-memory
    // guard cleared by a reload — the next click must proceed, not vanish.
    sessionStorage.setItem('bx_id_jag_pending_intent', JSON.stringify({
      useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance', returnTo: '/dashboard',
    }));
    const heard = [];
    const onRun = (event) => heard.push(event.detail);
    window.addEventListener('id-jag-run-requested', onRun);
    try {
      const result = requestLiveIdJagRun({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' });
      expect(result).toEqual({ useCaseId: ID_JAG_USE_CASE_ID, mode: 'live-id-jag', message: 'show my balance', returnTo: '/dashboard' });
      expect(heard).toHaveLength(1);
    } finally {
      window.removeEventListener('id-jag-run-requested', onRun);
    }
  });

  it('auto-recovers an intent older than the server-side 5-minute TTL', () => {
    sessionStorage.setItem('bx_id_jag_pending_intent', JSON.stringify({
      useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance', returnTo: '/dashboard',
      createdAt: Date.now() - 6 * 60 * 1000,
    }));
    const heard = [];
    window.addEventListener('id-jag-run-requested', (e) => heard.push(e.detail));
    try {
      expect(requestLiveIdJagRun({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' })).not.toBeNull();
      expect(heard).toHaveLength(1);
    } finally {
      window.removeEventListener('id-jag-run-requested', onRunClose);
    }
    function onRunClose(e) { heard.push(e.detail); }
  });

  it('blocks a concurrent fresh launch visibly instead of silently', () => {
    const detail = { mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' };
    requestLiveIdJagRun(detail);
    const blocked = [];
    const onBlocked = (e) => blocked.push(e.detail.reason);
    window.addEventListener('id-jag-launch-blocked', onBlocked);
    try {
      expect(requestLiveIdJagRun(detail)).toBeNull();
      expect(blocked).toEqual(['launch_in_progress']);
    } finally {
      window.removeEventListener('id-jag-launch-blocked', onBlocked);
    }
  });

  it('blocks a fresh (non-stale) stored intent visibly instead of silently', () => {
    sessionStorage.setItem('bx_id_jag_pending_intent', JSON.stringify({
      useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance', returnTo: '/dashboard',
      createdAt: Date.now(),
    }));
    const blocked = [];
    window.addEventListener('id-jag-launch-blocked', (e) => blocked.push(e.detail.reason));
    try {
      expect(requestLiveIdJagRun({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/dashboard' })).toBeNull();
      expect(blocked).toEqual(['intent_pending']);
    } finally {
      window.removeEventListener('id-jag-launch-blocked', onBlockedClose);
    }
    function onBlockedClose(e) { blocked.push(e.detail.reason); }
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
    sessionStorage.setItem(RUN_CONTEXT_STORAGE_KEY, JSON.stringify({
      source: 'use-cases', useCaseId: ID_JAG_USE_CASE_ID, triggerText: 'show my balance', autoSend: true, mode: RUN_MODES.LIVE_ID_JAG,
    }));
    const heard = [];
    const onClear = () => heard.push('cleared');
    window.addEventListener('id-jag-run-cleared', onClear);
    try {
      clearIdJagRunState();
      expect(sessionStorage.getItem('bx_id_jag_pending_intent')).toBeNull();
      expect(sessionStorage.getItem('unrelated-presenter-state')).toBe('keep');
      expect(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY)).toBeNull();
      expect(heard).toEqual(['cleared']);
    } finally {
      window.removeEventListener('id-jag-run-cleared', onClear);
    }
  });

  it('preserves an unrelated run context when clearing ID-JAG state', () => {
    const unrelated = { source: 'demo-track', useCaseId: 'UC1', triggerText: 'show reservations' };
    sessionStorage.setItem(RUN_CONTEXT_STORAGE_KEY, JSON.stringify(unrelated));
    clearIdJagRunState();
    expect(JSON.parse(sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY))).toEqual(unrelated);
  });
});


describe('pre-run provider capture and restore', () => {
  beforeEach(() => {
    clearIdJagRunState();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('captures the current provider when a live run is requested', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ config: { oauth_provider: 'pingone' } }),
    })));
    const intent = requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance',
      returnTo: '/pingfederate-id-jag/demo',
    });
    expect(intent).not.toBeNull();
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('bx_id_jag_pre_run_provider')).toBe('pingone');
    });
  });

  it('restores the pre-run provider and clears the session after a completed run', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push([url, opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null]);
      if (opts.method === 'POST') return { ok: true, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({ config: { oauth_provider: calls.length <= 1 ? 'pingone' : 'pingfederate' } }),
      };
    }));
    requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance',
      returnTo: '/pingfederate-id-jag/demo',
    });
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('bx_id_jag_pre_run_provider')).toBe('pingone');
    });
    completeIdJagRunHandoff();
    await vi.waitFor(() => {
      expect(calls.some(([u, m, b]) => m === 'POST' && u === '/api/admin/config' && b?.oauth_provider === 'pingone')).toBe(true);
    });
    expect(sessionStorage.getItem('bx_id_jag_pre_run_provider')).toBeNull();
  });

  it('does nothing when no provider was captured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    completeIdJagRunHandoff();
    await vi.waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
