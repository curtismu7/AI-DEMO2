/**
 * demoAgentSafety — pure helpers extracted from BankingAgent.
 *
 * makeReentrancyGuard, clampPanelPosition, claimPendingNl,
 * isAbortError, resolveEmbeddedFocus, anySignal, isLocalModelTimeout
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeReentrancyGuard,
  clampPanelPosition,
  claimPendingNl,
  isAbortError,
  resolveEmbeddedFocus,
  anySignal,
  isLocalModelTimeout,
} from '../demoAgentSafety';

// ── makeReentrancyGuard ──────────────────────────────────────────────────────

describe('makeReentrancyGuard', () => {
  it('tryAcquire returns true on first call', () => {
    const g = makeReentrancyGuard();
    expect(g.tryAcquire()).toBe(true);
  });

  it('tryAcquire returns false while held', () => {
    const g = makeReentrancyGuard();
    g.tryAcquire();
    expect(g.tryAcquire()).toBe(false);
  });

  it('tryAcquire returns true again after release', () => {
    const g = makeReentrancyGuard();
    g.tryAcquire();
    g.release();
    expect(g.tryAcquire()).toBe(true);
  });

  it('each guard instance is independent', () => {
    const a = makeReentrancyGuard();
    const b = makeReentrancyGuard();
    a.tryAcquire();
    expect(b.tryAcquire()).toBe(true);
  });
});

// ── clampPanelPosition ───────────────────────────────────────────────────────

describe('clampPanelPosition', () => {
  const panel    = { width: 300, height: 200 };
  const viewport = { width: 1024, height: 768 };

  it('returns position unchanged when within safe zone', () => {
    const pos = { x: 200, y: 100 };
    expect(clampPanelPosition(pos, panel, viewport)).toEqual({ x: 200, y: 100 });
  });

  it('clamps x to maxX when panel is pushed too far right', () => {
    const pos = { x: 2000, y: 100 };
    const result = clampPanelPosition(pos, panel, viewport);
    expect(result.x).toBeLessThanOrEqual(viewport.width - 48);
  });

  it('clamps x to minX when panel is pushed too far left', () => {
    const pos = { x: -1000, y: 100 };
    const result = clampPanelPosition(pos, panel, viewport);
    expect(result.x).toBeGreaterThanOrEqual(48 - panel.width);
  });

  it('clamps y to 0 minimum (never above viewport)', () => {
    const pos = { x: 100, y: -50 };
    const result = clampPanelPosition(pos, panel, viewport);
    expect(result.y).toBe(0);
  });

  it('clamps y to maxY when panel is too far down', () => {
    const pos = { x: 100, y: 9000 };
    const result = clampPanelPosition(pos, panel, viewport);
    expect(result.y).toBeLessThanOrEqual(viewport.height - 48);
  });

  it('respects custom margin', () => {
    const pos = { x: 990, y: 100 };
    const result = clampPanelPosition(pos, panel, viewport, 100);
    expect(result.x).toBeLessThanOrEqual(viewport.width - 100);
  });
});

// ── claimPendingNl ───────────────────────────────────────────────────────────

describe('claimPendingNl', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns null when key is absent', () => {
    expect(claimPendingNl('test-key')).toBeNull();
  });

  it('returns the value and removes it on first call', () => {
    sessionStorage.setItem('test-key', 'transfer $50');
    expect(claimPendingNl('test-key')).toBe('transfer $50');
    expect(sessionStorage.getItem('test-key')).toBeNull();
  });

  it('second call returns null (claimed once)', () => {
    sessionStorage.setItem('test-key', 'hello');
    claimPendingNl('test-key');
    expect(claimPendingNl('test-key')).toBeNull();
  });

  it('returns null for blank/whitespace-only value', () => {
    sessionStorage.setItem('test-key', '   ');
    expect(claimPendingNl('test-key')).toBeNull();
  });

  it('trims leading/trailing whitespace', () => {
    sessionStorage.setItem('test-key', '  show balance  ');
    expect(claimPendingNl('test-key')).toBe('show balance');
  });
});

// ── isAbortError ─────────────────────────────────────────────────────────────

describe('isAbortError', () => {
  it('returns true for an AbortError', () => {
    const err = new DOMException('user aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('returns false for a generic Error', () => {
    expect(isAbortError(new Error('oops'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

// ── resolveEmbeddedFocus ─────────────────────────────────────────────────────

describe('resolveEmbeddedFocus', () => {
  it('returns "config" for /config', () => {
    expect(resolveEmbeddedFocus('/config')).toBe('config');
  });

  it('returns "banking" for any other route', () => {
    expect(resolveEmbeddedFocus('/dashboard')).toBe('banking');
    expect(resolveEmbeddedFocus('/')).toBe('banking');
    expect(resolveEmbeddedFocus('')).toBe('banking');
  });

  it('strips trailing slash before matching', () => {
    expect(resolveEmbeddedFocus('/config/')).toBe('config');
  });

  it('handles null/undefined gracefully', () => {
    expect(resolveEmbeddedFocus(null)).toBe('banking');
    expect(resolveEmbeddedFocus(undefined)).toBe('banking');
  });
});

// ── anySignal ────────────────────────────────────────────────────────────────

describe('anySignal', () => {
  it('produces a signal that is not yet aborted', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const sig = anySignal([c1.signal, c2.signal]);
    expect(sig.aborted).toBe(false);
  });

  it('aborts when first source is aborted', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const sig = anySignal([c1.signal, c2.signal]);
    c1.abort();
    expect(sig.aborted).toBe(true);
  });

  it('aborts when second source is aborted', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const sig = anySignal([c1.signal, c2.signal]);
    c2.abort();
    expect(sig.aborted).toBe(true);
  });

  it('is immediately aborted when a source is already aborted on entry', () => {
    const c1 = new AbortController();
    c1.abort();
    const c2 = new AbortController();
    const sig = anySignal([c1.signal, c2.signal]);
    expect(sig.aborted).toBe(true);
  });
});

// ── isLocalModelTimeout ──────────────────────────────────────────────────────

describe('isLocalModelTimeout', () => {
  it('returns true for TimeoutError on llamacpp provider', () => {
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(isLocalModelTimeout(err, 'llamacpp')).toBe(true);
  });

  it('returns true for message-based timeout on llamacpp', () => {
    expect(isLocalModelTimeout(new Error('request timed out'), 'llamacpp')).toBe(true);
  });

  it('returns false for timeout on non-llamacpp provider', () => {
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(isLocalModelTimeout(err, 'anthropic')).toBe(false);
  });

  it('returns false for non-timeout error on llamacpp', () => {
    expect(isLocalModelTimeout(new Error('network error'), 'llamacpp')).toBe(false);
  });

  it('returns false for null error', () => {
    expect(isLocalModelTimeout(null, 'llamacpp')).toBe(false);
  });
});
