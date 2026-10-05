'use strict';

jest.mock('axios');
const axios = require('axios');
const { buildRecord, traceNlTurn, _resetForTest } = require('../services/opikTurnTrace');

const req = { session: { id: 'sess-1' } };
const base = { req, vertical: 'super-sports', startMs: 1000, endMs: 1040 };

describe('opikTurnTrace.buildRecord', () => {
  afterEach(() => { delete process.env.OPIK_BFF_TRACE_CONTENT; });

  it('heuristic turn: metadata only, no llm span, no usage, no text', () => {
    const rec = buildRecord({ ...base, provider: 'heuristic', message: 'my secret prompt',
      parsed: { source: 'heuristic', result: { kind: 'banking', banking: { action: 'get_balance' }, message: 'reply text' } } });
    expect(rec.tags).toEqual(['bff', 'bff-heuristic', 'source:heuristic', 'vertical:super-sports']);
    expect(rec.thread_id).toBe('sess-1');
    expect(rec.spans).toHaveLength(1);
    expect(rec.spans[0]).toMatchObject({ type: 'general', output: 'source=heuristic action=get_balance' });
    expect(JSON.stringify(rec)).not.toMatch(/usage|secret prompt|reply text/);
    expect(rec.input).toBeUndefined();
  });

  it('LLM turn: llm span without usage; content only when switched on, redacted and clipped', () => {
    const parsed = { source: 'privilege_llm', result: { kind: 'education', education: { panel: 'x' }, message: 'a'.repeat(900) } };
    const off = buildRecord({ ...base, provider: 'privilege_llm', message: 'hi', parsed });
    expect(off.tags).toContain('source:llm');
    expect(off.spans[1]).toMatchObject({ type: 'llm', provider: 'privilege_llm' });
    expect(off.spans[1].usage).toBeUndefined();
    expect(off.input).toBeUndefined();

    process.env.OPIK_BFF_TRACE_CONTENT = '1';
    const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.c2ln';
    const on = buildRecord({ ...base, provider: 'privilege_llm', message: `tok ${jwt}`, parsed });
    expect(on.input).toBe('tok [REDACTED_JWT]');
    expect(on.output).toHaveLength(500);
  });

  it('heuristic answer after a failed LLM attempt still shows the llm span; cache hit does not', () => {
    const r = { kind: 'none' };
    expect(buildRecord({ ...base, provider: 'google', parsed: { source: 'heuristic', result: r, llm_attempted: true } }).spans).toHaveLength(2);
    expect(buildRecord({ ...base, provider: 'google', parsed: { source: 'google', result: r, cache_hit: true } }).spans).toHaveLength(1);
    expect(buildRecord({ ...base, provider: 'google', parsed: { source: 'heuristic', result: r, llm_not_configured: true, llm_attempted: false } }).spans).toHaveLength(1);
  });

  it('maps policy denial and rate limit to named error types on trace and llm span', () => {
    const denied = buildRecord({ ...base, provider: 'privilege_llm', error: Object.assign(new Error('x'), { code: 'llm_policy_denied', reason: 'no' }) });
    expect(denied.error).toEqual({ type: 'PrivilegePolicyDenied', message: 'no' });
    expect(denied.spans[1].error.type).toBe('PrivilegePolicyDenied');
    const limited = buildRecord({ ...base, provider: 'privilege_llm', error: Object.assign(new Error('slow'), { code: 'llm_rate_limited' }) });
    expect(limited.error.type).toBe('PrivilegeRateLimited');
    const other = buildRecord({ ...base, provider: 'heuristic', error: new Error('boom') });
    expect(other.error.type).toBe('NlParseError');
    expect(other.spans).toHaveLength(1);
  });
});

describe('opikTurnTrace.traceNlTurn', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = 'development'; axios.post.mockReset(); _resetForTest(); });
  afterEach(() => { process.env.NODE_ENV = env; });
  const turn = { ...base, provider: 'heuristic', parsed: { source: 'heuristic', result: { kind: 'none' } } };

  it('posts with the internal secret and a 2s timeout, returns synchronously', () => {
    axios.post.mockResolvedValue({ status: 202, data: { enabled: true } });
    expect(traceNlTurn(turn)).toBeUndefined();
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/opik\/trace$/);
    expect(body.name).toBe('bff.nl');
    expect(opts.timeout).toBe(2000);
    expect(opts.headers['x-internal-gateway-secret']).toBeTruthy();
  });

  it('never throws, and stops posting after a failure (drop-if-down)', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(() => traceNlTurn(turn)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    traceNlTurn(turn);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when switched off', () => {
    process.env.OPIK_BFF_TRACE = '0';
    traceNlTurn(turn);
    delete process.env.OPIK_BFF_TRACE;
    expect(axios.post).not.toHaveBeenCalled();
  });
});
