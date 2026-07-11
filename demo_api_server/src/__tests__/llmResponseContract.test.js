// demo_api_server/src/__tests__/llmResponseContract.test.js
'use strict';

const { repairAndParseJson, snippet, logMendEvent } = require('../../services/llmResponseContract');

describe('repairAndParseJson', () => {
  it('parses clean JSON', () => {
    expect(repairAndParseJson('{"kind":"banking"}')).toEqual({ kind: 'banking' });
  });

  it('strips markdown fences', () => {
    expect(repairAndParseJson('```json\n{"kind":"banking"}\n```')).toEqual({ kind: 'banking' });
  });

  it('strips <think> chain-of-thought wrappers', () => {
    expect(repairAndParseJson('<think>hmm reasoning</think>{"kind":"banking"}')).toEqual({ kind: 'banking' });
  });

  it('extracts the first {...} object from surrounding prose', () => {
    expect(repairAndParseJson('Sure!\n{"kind":"banking","banking":{"action":"accounts"}}\nHope that helps'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('repairs trailing commas', () => {
    expect(repairAndParseJson('{"kind":"banking","banking":{"action":"accounts",},}'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('repairs smart double quotes', () => {
    expect(repairAndParseJson('{“kind”:“banking”}')).toEqual({ kind: 'banking' });
  });

  it('completes truncated output missing closers', () => {
    expect(repairAndParseJson('{"kind":"banking","banking":{"action":"accounts"'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('does not append closers inside string values', () => {
    expect(repairAndParseJson('{"kind":"none","message":"use { braces } wisely"}'))
      .toEqual({ kind: 'none', message: 'use { braces } wisely' });
  });

  it('returns null for empty and hopeless input', () => {
    expect(repairAndParseJson('')).toBeNull();
    expect(repairAndParseJson(null)).toBeNull();
    expect(repairAndParseJson('no json here at all')).toBeNull();
  });
});

describe('snippet', () => {
  it('collapses control chars, trims, and caps length', () => {
    expect(snippet('  a\u0000b\nc  ')).toBe('a b c');
    expect(snippet('x'.repeat(500)).length).toBe(200);
    expect(snippet(null)).toBe('');
  });
});

describe('logMendEvent', () => {
  it('emits one [llmContract] warn line and never throws', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logMendEvent('test_event', { site: 'here' });
    expect(spy).toHaveBeenCalledWith('[llmContract]', JSON.stringify({ event: 'test_event', site: 'here' }));
    const circular = {}; circular.self = circular;
    expect(() => logMendEvent('bad', circular)).not.toThrow();
    spy.mockRestore();
  });
});
