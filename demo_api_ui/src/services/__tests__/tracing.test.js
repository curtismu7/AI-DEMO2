/**
 * tracing.js runs before React renders (see index.jsx) — it must never throw,
 * regardless of what /api/admin/feature-flags does. `started` is a module-level
 * guard, so each scenario needs a fresh module instance via resetModules().
 */
// resetModules() gives '../tracing' a fresh module graph — including its own
// fresh @opentelemetry/api instance, distinct from any statically imported at
// the top of this file. Re-import api dynamically in lockstep so the
// "is a provider registered" check below observes the SAME instance
// initTracing() actually registered against.
async function freshInitTracing() {
  vi.resetModules();
  const [{ trace, isSpanContextValid }, { initTracing }] = await Promise.all([
    import('@opentelemetry/api'),
    import('../tracing'),
  ]);
  await initTracing();
  return function tracerIsRegistered() {
    const span = trace.getTracer('demo-api-ui').startSpan('probe');
    const valid = isSpanContextValid(span.spanContext());
    span.end();
    return valid;
  };
}

describe('tracing.initTracing', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not throw and registers nothing when fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const tracerIsRegistered = await freshInitTracing();
    expect(tracerIsRegistered()).toBe(false);
  });

  it('does not throw and registers nothing on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const tracerIsRegistered = await freshInitTracing();
    expect(tracerIsRegistered()).toBe(false);
  });

  it('does not throw and registers nothing on malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    });
    const tracerIsRegistered = await freshInitTracing();
    expect(tracerIsRegistered()).toBe(false);
  });

  it('registers nothing when ff_tracing is false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ flags: [{ id: 'ff_tracing', value: 'false' }] }),
    });
    const tracerIsRegistered = await freshInitTracing();
    expect(tracerIsRegistered()).toBe(false);
  });

  it('registers a real WebTracerProvider when ff_tracing is true', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ flags: [{ id: 'ff_tracing', value: 'true' }] }),
    });
    const tracerIsRegistered = await freshInitTracing();
    expect(tracerIsRegistered()).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
