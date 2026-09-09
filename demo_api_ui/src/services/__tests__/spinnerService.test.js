// banking_api_ui/src/services/__tests__/spinnerService.test.js
/**
 * The overlay was disabled in #1172 (too distracting) and re-enabled behind the
 * NeuralSpinner rework. The contract these tests pin down is what makes it
 * tolerable this time:
 *   - nothing shows until DEBOUNCE_MS, so fast calls never flash the overlay
 *   - SILENT_URL_PREFIXES routes never show AND never touch _pending
 *   - _pending stays balanced, so the spinner always hides again
 * spinnerService uses module-level state; reset modules each test.
 */

const DEBOUNCE_MS = 2500;
const MIN_DISPLAY_MS = 300;

describe('spinnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden until the debounce window elapses, then shows', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/admin/config');

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(spinner.getState().visible).toBe(false);

    vi.advanceTimersByTime(1);
    expect(spinner.getState().visible).toBe(true);
  });

  it('never shows when the request finishes inside the debounce window', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/admin/config');
    vi.advanceTimersByTime(DEBOUNCE_MS - 500);
    spinner.decrement(false, '/api/admin/config');

    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(spinner.getState().visible).toBe(false);
  });

  it('maps a known route to its contextual message and endpoint', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('POST', '/api/tokens');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    const state = spinner.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('Exchanging tokens…');
    expect(state.endpoint).toContain('POST');
    expect(state.endpoint).toContain('/api/tokens');
    expect(state.color).toBeTruthy();
  });

  it('falls back to a quip for an unmapped route', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/nothing-mapped-here');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(spinner.getState().message).toEqual(expect.any(String));
    expect(spinner.getState().message.length).toBeGreaterThan(0);
  });

  it('hides after the minimum display time once the last request lands', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/users');
    vi.advanceTimersByTime(MIN_DISPLAY_MS - 1);
    expect(spinner.getState().visible).toBe(true);

    vi.advanceTimersByTime(1);
    expect(spinner.getState().visible).toBe(false);
  });

  it('hides immediately on error, skipping the minimum display time', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    spinner.decrement(true, '/api/users');
    vi.advanceTimersByTime(0);
    expect(spinner.getState().visible).toBe(false);
  });

  it('stays visible while any request is still outstanding', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/users');
    spinner.increment('GET', '/api/authorize');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/users');
    vi.advanceTimersByTime(MIN_DISPLAY_MS * 2);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/authorize');
    vi.advanceTimersByTime(MIN_DISPLAY_MS);
    expect(spinner.getState().visible).toBe(false);
  });

  it('never shows for a silent-list route', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/auth/session');
    spinner.increment('POST', '/api/mcp/tool');
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(spinner.getState().visible).toBe(false);
  });

  /**
   * Regression for the leak that made re-enabling impossible: increment() had
   * no silent-URL guard while decrement() did, so polling routes ratcheted
   * _pending upward and pinned the spinner open until the 60 s safety timer.
   */
  it('does not leak _pending when silent routes poll alongside a real request', async () => {
    const { spinner } = await import('../spinnerService');

    for (let i = 0; i < 5; i++) {
      spinner.increment('GET', '/api/auth/session');
      spinner.decrement(false, '/api/auth/session');
    }

    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/users');
    vi.advanceTimersByTime(MIN_DISPLAY_MS);
    expect(spinner.getState().visible).toBe(false);
  });

  /**
   * Regression: show() used to increment _pending unconditionally. Callers that
   * show per item in a loop and hide once (CodebaseUploader) left the counter
   * above zero, pinning the overlay open until the 60s safety timer.
   */
  it('keeps repeated manual shows to a single pending entry', async () => {
    const { spinner } = await import('../spinnerService');

    spinner.show('Indexing folder…');
    spinner.show('Indexing file 1…');
    spinner.show('Indexing file 2…');
    expect(spinner.getState().visible).toBe(true);
    expect(spinner.getState().message).toBe('Indexing file 2…');

    // Bounded advance on purpose: vi.runAllTimers() would fire the 60s safety
    // timeout, which force-hides regardless and makes this pass even unfixed.
    spinner.hide();
    vi.advanceTimersByTime(MIN_DISPLAY_MS);
    expect(spinner.getState().visible).toBe(false);
  });

  /** A defensive hide() must not consume a pending entry it never created. */
  it('hide is a no-op when no manual show is outstanding', async () => {
    const { spinner } = await import('../spinnerService');

    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    spinner.hide();
    vi.advanceTimersByTime(MIN_DISPLAY_MS * 2);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/users');
    vi.advanceTimersByTime(MIN_DISPLAY_MS);
    expect(spinner.getState().visible).toBe(false);
  });

  /**
   * Regression: patchFetch passes the url to increment() but used to call
   * decrement() without it. Once increment gained a silent-URL guard, a silent
   * fetch decremented without ever incrementing — draining the counter and
   * hiding the overlay while a real request was still in flight.
   */
  it('a silent-route decrement cannot drain a real request\'s pending entry', async () => {
    const { spinner } = await import('../spinnerService');

    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    // The silent poll completes; it never incremented, so it must not decrement.
    spinner.decrement(false, '/api/auth/session');
    vi.advanceTimersByTime(MIN_DISPLAY_MS * 2);
    expect(spinner.getState().visible).toBe(true);

    spinner.decrement(false, '/api/users');
    vi.advanceTimersByTime(MIN_DISPLAY_MS);
    expect(spinner.getState().visible).toBe(false);
  });

  it('manual show displays at once and hide clears it', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.show('Redirecting to PingOne…', 'GET /authorize');

    const state = spinner.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('Redirecting to PingOne…');
    expect(state.endpoint).toBe('GET /authorize');

    spinner.hide();
    vi.runAllTimers();
    expect(spinner.getState().visible).toBe(false);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { spinner } = await import('../spinnerService');
    const spy = vi.fn();
    const off = spinner.subscribe(spy);

    spinner.show('Working…');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)[0].visible).toBe(true);

    spinner.hide();
    vi.runAllTimers();
    expect(spy.mock.calls.at(-1)[0].visible).toBe(false);

    const callsAfterHide = spy.mock.calls.length;
    off();
    spinner.show('Ignored…');
    vi.runAllTimers();
    expect(spy.mock.calls.length).toBe(callsAfterHide);
  });

  it('force-hides if the pending counter leaks past the safety timeout', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/users');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(spinner.getState().visible).toBe(true);

    // Response never arrives — decrement is never called.
    vi.advanceTimersByTime(60000);
    expect(spinner.getState().visible).toBe(false);
  });
});
