/**
 * poll() checked the module-level `_stopped` flag only once, synchronously,
 * before its `await _http.get(...)` call -- it never re-checked after the
 * await resumes. A poll started under one session that is stopped and
 * quickly restarted before the response arrives still applied its stale
 * response's side effects (pushEvent) to the new session's state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { create: () => ({ get: (...args) => mockGet(...args) }) },
}));

import { spinnerActivity } from '../spinnerActivityService';

describe('spinnerActivityService stale-poll race', () => {
  beforeEach(() => {
    mockGet.mockReset();
    spinnerActivity.stop();
  });

  afterEach(() => {
    spinnerActivity.stop();
  });

  it("discards a stopped session's in-flight response after a quick restart", async () => {
    let resolveFirst;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    mockGet.mockImplementation(() => Promise.resolve({ data: { events: [] } }));

    spinnerActivity.start(); // first poll dispatched, response deferred
    spinnerActivity.stop();  // session ends before the response arrives
    spinnerActivity.start(); // a new session begins immediately

    // The first poll's stale response finally arrives, carrying an event
    // that belongs to the already-ended session.
    resolveFirst({
      data: {
        events: [{ id: 'stale-1', category: 'oauth', message: 'stale event', timestamp: new Date().toISOString() }],
      },
    });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const events = spinnerActivity.getEvents();
    expect(events.find((e) => e.id === 'stale-1')).toBeUndefined();
  });
});
