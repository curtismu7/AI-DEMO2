// banking_api_ui/src/services/__tests__/spinnerService.test.js
/**
 * spinnerService uses module-level state; reset modules each test.
 * Timers control debounce (200 ms) and minimum visible time (1500 ms).
 */

describe('spinnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows after debounce when increment is not cancelled by decrement', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/accounts');
    expect(spinner.getState().visible).toBe(false);
    vi.advanceTimersByTime(2500);
    expect(spinner.getState().visible).toBe(true);
    expect(spinner.getState().message).toMatch(/./);
  });

  it('does not show when decrement runs before debounce fires', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/foo');
    spinner.decrement(true);
    vi.advanceTimersByTime(500);
    expect(spinner.getState().visible).toBe(false);
  });

  it('show then hide clears visible state', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.show('Manual task');
    expect(spinner.getState().visible).toBe(true);
    spinner.hide();
    vi.runAllTimers();
    expect(spinner.getState().visible).toBe(false);
  });

  it('keeps spinner until the last outstanding increment is decremented', async () => {
    const { spinner } = await import('../spinnerService');
    spinner.increment('GET', '/api/a');
    vi.advanceTimersByTime(2500);
    expect(spinner.getState().visible).toBe(true);
    spinner.increment('GET', '/api/b');
    spinner.decrement(false);
    expect(spinner.getState().visible).toBe(true);
    spinner.decrement(false);
    vi.advanceTimersByTime(2000);
    expect(spinner.getState().visible).toBe(false);
  });

  it('unsubscribe stops listener callbacks', async () => {
    const { spinner } = await import('../spinnerService');
    const spy = vi.fn();
    const off = spinner.subscribe(spy);
    spinner.show('x');
    expect(spy).toHaveBeenCalled();
    const callsAfterShow = spy.mock.calls.length;
    off();
    spinner.hide();
    vi.runAllTimers();
    spinner.show('y');
    expect(spy.mock.calls.length).toBe(callsAfterShow);
  });
});
