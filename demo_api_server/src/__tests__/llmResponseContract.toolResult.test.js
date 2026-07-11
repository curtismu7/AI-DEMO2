'use strict';

const { parseToolResult } = require('../../services/llmResponseContract');

describe('parseToolResult', () => {
  it('passes objects through untouched', () => {
    const obj = { accounts: [{ id: 'a1' }] };
    expect(parseToolResult(obj)).toEqual({ result: obj, parseFailed: false });
  });

  it('parses JSON strings', () => {
    expect(parseToolResult('{"balance":42}')).toEqual({ result: { balance: 42 }, parseFailed: false });
  });

  it('repairs mildly malformed JSON strings', () => {
    expect(parseToolResult('{"balance":42,}')).toEqual({ result: { balance: 42 }, parseFailed: false });
  });

  it('returns an error-shaped result for unparseable strings (never the raw string)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, parseFailed } = parseToolResult('Internal Server Error <html>...', { site: 'test' });
    expect(parseFailed).toBe(true);
    expect(result.error).toBe('tool_result_unparseable');
    expect(result.error_description).toContain('Internal Server Error');
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('tool_result_unparseable'));
    spy.mockRestore();
  });

  it('returns an error-shaped result for empty input', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const raw of [null, undefined, '', '   ']) {
      const { result, parseFailed } = parseToolResult(raw, { site: 'test' });
      expect(parseFailed).toBe(true);
      expect(result.error).toBe('tool_result_empty');
    }
    spy.mockRestore();
  });

  it('feeds classifyMcpToolResult an error it recognises', () => {
    const { classifyMcpToolResult } = require('../../services/mcpToolOutcome');
    const { result } = parseToolResult('not json', { site: 'test' });
    const c = classifyMcpToolResult(result);
    expect(c.kind).toBe('error');
    expect(c.message).toContain('not json');
  });

  it('does NOT extract embedded JSON fragments from prose-wrapped garbage (machine output is strict)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, parseFailed } = parseToolResult('Gateway error: policy {"decision":"DENY"} evaluated', { site: 'test' });
    expect(parseFailed).toBe(true);
    expect(result.error).toBe('tool_result_unparseable');
    spy.mockRestore();
  });
});
