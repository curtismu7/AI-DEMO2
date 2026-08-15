import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nrLog } from '../nrLog';

describe('nrLog', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    delete window.__nrCorrelationId;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('posts message and attributes to /api/nr-log', async () => {
    nrLog('test.event', { foo: 'bar' });
    await Promise.resolve(); // flush micro-task
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/nr-log',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message).toBe('test.event');
    expect(body.attributes.foo).toBe('bar');
  });

  test('includes correlationId from attributes when provided', async () => {
    nrLog('test.event', { correlationId: 'abc-123' });
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('abc-123');
  });

  test('includes correlationId from window.__nrCorrelationId when not in attributes', async () => {
    window.__nrCorrelationId = 'window-id-999';
    nrLog('test.event', {});
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('window-id-999');
  });

  test('attribute correlationId takes precedence over window', async () => {
    window.__nrCorrelationId = 'window-id-999';
    nrLog('test.event', { correlationId: 'attr-id-111' });
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('attr-id-111');
  });

  test('never throws when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    expect(() => nrLog('test.event')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });
});
