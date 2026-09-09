// banking_api_ui/src/services/__tests__/apiTrafficStore.spinnerBalance.test.js
/**
 * patchFetch drives the global spinner for raw `fetch('/api/…')` calls — the
 * half of the app that does not go through apiClient.
 *
 * It passed the url to increment() but called decrement() bare. That was
 * harmless while increment() ignored the url: both sides always fired. Once
 * increment() gained the SILENT_URL_PREFIXES guard, silent polls stopped
 * incrementing but kept decrementing, draining pending entries belonging to
 * real in-flight requests and hiding the overlay early.
 *
 * These assert both sides of patchFetch are handed the same url.
 *
 * patchFetch guards on a module-level `fetchPatched` flag, so each test must
 * resetModules and install its window.fetch BEFORE patching — otherwise the
 * second test silently runs unpatched and proves nothing.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(fetchImpl) {
  vi.resetModules();
  window.fetch = fetchImpl;

  const { patchFetch } = await import('../apiTrafficStore');
  const { spinner } = await import('../spinnerService');

  const increments = [];
  const decrements = [];
  vi.spyOn(spinner, 'increment').mockImplementation((_m, u) => increments.push(u));
  vi.spyOn(spinner, 'decrement').mockImplementation((_e, u) => decrements.push(u));

  patchFetch();
  return { increments, decrements };
}

const okFetch = () => vi.fn(async () => new Response('{}', {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

describe('patchFetch — spinner increment/decrement symmetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the same url to decrement that it passed to increment', async () => {
    const { increments, decrements } = await setup(okFetch());

    await window.fetch('/api/users');
    await flush();

    expect(increments).toEqual(['/api/users']);
    expect(decrements).toEqual(['/api/users']);
  });

  it('hands decrement the url for a silent route too, so the guard can match', async () => {
    const { increments, decrements } = await setup(okFetch());

    await window.fetch('/api/auth/session');
    await flush();

    expect(increments).toEqual(['/api/auth/session']);
    expect(decrements).toEqual(['/api/auth/session']);
  });

  it('passes the url on the error path as well', async () => {
    const { decrements } = await setup(vi.fn(async () => {
      throw new Error('network down');
    }));

    await expect(window.fetch('/api/tokens')).rejects.toThrow('network down');
    await flush();

    expect(decrements).toEqual(['/api/tokens']);
  });

  it('leaves non-/api calls entirely alone', async () => {
    const { increments, decrements } = await setup(okFetch());

    await window.fetch('/static/logo.svg');
    await flush();

    expect(increments).toEqual([]);
    expect(decrements).toEqual([]);
  });
});
