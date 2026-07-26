'use strict';

const { normalizeAxiosError } = require('../../utils/normalizeAxiosError');

const axErr = (extra) => Object.assign(new Error('raw axios message'), extra);

describe('normalizeAxiosError', () => {
  test('ECONNABORTED / ETIMEDOUT → UPSTREAM_TIMEOUT / 504, message echoes timeout', () => {
    for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
      const e = normalizeAxiosError(axErr({ code }), { label: 'PingOne token', timeoutMs: 8000 });
      expect(e.code).toBe('UPSTREAM_TIMEOUT');
      expect(e.httpStatus).toBe(504);
      expect(e.message).toMatch(/PingOne token timed out after 8000ms/);
    }
  });

  test('connection failures → UPSTREAM_UNREACHABLE / 503', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET']) {
      const e = normalizeAxiosError(axErr({ code }));
      expect(e.code).toBe('UPSTREAM_UNREACHABLE');
      expect(e.httpStatus).toBe(503);
    }
  });

  test('HTTP error response → UPSTREAM_HTTP_ERROR, upstream status + safe body', () => {
    const e = normalizeAxiosError(
      axErr({ response: { status: 400, data: { error: 'invalid_client', error_description: 'bad secret' } } }),
      { label: 'PingOne token' },
    );
    expect(e.code).toBe('UPSTREAM_HTTP_ERROR');
    expect(e.httpStatus).toBe(400);
    expect(e.upstreamStatus).toBe(400);
    expect(e.upstreamBody).toEqual({ error: 'invalid_client', error_description: 'bad secret' });
    expect(e.message).toMatch(/failed \(400\): bad secret/);
  });

  test('custom code names override transport codes (gateway parity)', () => {
    const e = normalizeAxiosError(axErr({ code: 'ECONNABORTED' }), {
      codes: { timeout: 'GATEWAY_TIMEOUT', unreachable: 'GATEWAY_UNREACHABLE' },
    });
    expect(e.code).toBe('GATEWAY_TIMEOUT');
    expect(e.httpStatus).toBe(504);
  });

  test('cause is credential-safe (no axios .config), keeps transport code + status', () => {
    const raw = axErr({ code: 'ECONNREFUSED', config: { headers: { Authorization: 'Bearer secret' } } });
    const e = normalizeAxiosError(raw);
    expect(e.cause.config).toBeUndefined();
    expect(e.cause.transportCode).toBe('ECONNREFUSED');
  });

  test('non-axios custom Error is returned unchanged (TOKEN_INACTIVE passthrough)', () => {
    const custom = Object.assign(new Error('token dead'), { code: 'TOKEN_INACTIVE' });
    expect(normalizeAxiosError(custom)).toBe(custom);
  });

  test('non-Error throw is wrapped but preserved as cause', () => {
    const e = normalizeAxiosError('string-boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('string-boom');
    expect(e.cause).toBe('string-boom');
  });
});
