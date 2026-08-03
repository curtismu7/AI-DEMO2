// banking_api_ui/src/services/__tests__/spinnerService.test.js
/**
 * The full-screen spinner overlay was disabled on purpose in #1172 (too
 * distracting): increment() and show() are no-ops, so the spinner must NEVER
 * become visible. decrement()/hide() remain callable (interceptors still call
 * them) and still notify subscribers with a hidden state.
 * spinnerService uses module-level state; reset modules each test.
 */

describe('spinnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increment never shows the spinner, even after the debounce window', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/accounts');
    expect(spinner.getState().visible).toBe(false);
    vi.advanceTimersByTime(2500);
    expect(spinner.getState().visible).toBe(false);
  });

  it('does not show when decrement runs before debounce fires', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/foo');
    spinner.decrement(true);
    vi.advanceTimersByTime(500);
    expect(spinner.getState().visible).toBe(false);
  });

  it('manual show is a no-op and hide stays safe to call', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.show('Manual task');
    expect(spinner.getState().visible).toBe(false);
    spinner.hide();
    vi.runAllTimers();
    expect(spinner.getState().visible).toBe(false);
  });

  it('stays hidden across overlapping increment/decrement cycles', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/a');
    vi.advanceTimersByTime(2500);
    spinner.increment('GET', '/api/b');
    spinner.decrement(false);
    spinner.decrement(false);
    vi.advanceTimersByTime(2000);
    expect(spinner.getState().visible).toBe(false);
  });

  it('unsubscribe stops listener callbacks', async () => {
    const { spinner } = await import('../spinnerService');
    const spy = vi.fn();
    const off = spinner.subscribe(spy);
    // show() is a no-op, but hide() still schedules a notify
    spinner.hide();
    vi.runAllTimers();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)[0].visible).toBe(false);
    const callsAfterHide = spy.mock.calls.length;
    off();
    spinner.hide();
    vi.runAllTimers();
    expect(spy.mock.calls.length).toBe(callsAfterHide);
  });
});
