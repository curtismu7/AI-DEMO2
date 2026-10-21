import { describe, it, expect } from 'vitest';
import { readableResult, failureOf, failureMessage } from '../readableResult';

const rpc = (result) => ({ jsonrpc: '2.0', id: 2, result });
const text = (t) => ({ type: 'text', text: t });

describe('readableResult', () => {
  it('keeps a prose text part as prose, line breaks intact', () => {
    const r = readableResult(rpc({ content: [text('Sunny, 21 C.\nWind 5 km/h.')] }));
    expect(r.kind).toBe('text');
    expect(r.isError).toBe(false);
    expect(r.blocks).toEqual([{ type: 'text', text: 'Sunny, 21 C.\nWind 5 km/h.' }]);
    expect(r.summary).toBe('Sunny, 21 C.');
  });

  it('parses a JSON text part into data (the banking tools do this)', () => {
    const r = readableResult(rpc({ content: [text(JSON.stringify({ accounts: [{ id: 'a1', balance: 10 }] }, null, 2))] }));
    expect(r.kind).toBe('data');
    expect(r.blocks[0]).toEqual({ type: 'data', value: { accounts: [{ id: 'a1', balance: 10 }] } });
  });

  it('leaves text that merely starts with a brace but is not JSON alone', () => {
    const r = readableResult(rpc({ content: [text('{not json at all')] }));
    expect(r.blocks).toEqual([{ type: 'text', text: '{not json at all' }]);
  });

  it('flags isError and surfaces the tool\'s own words', () => {
    const r = readableResult(rpc({ isError: true, content: [text('Error: Provide one of: coordinates, location_name, or city_name.')] }));
    expect(r.kind).toBe('error');
    expect(r.isError).toBe(true);
    expect(failureOf(rpc({ isError: true, content: [text('boom')] }))).toEqual({ message: 'boom', ranTool: true });
  });

  it('does not treat a successful result as an error', () => {
    expect(failureOf(rpc({ content: [text('fine')] }))).toBeNull();
  });

  it('reads a JSON-RPC error', () => {
    const r = readableResult({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
    expect(r).toMatchObject({ kind: 'error', isError: true });
    expect(r.blocks[0].text).toBe('Method not found (code -32601)');
  });

  it('unwraps a gateway wrapper and a BFF {response:{result}} wrapper', () => {
    const inner = { content: [text('Rain tomorrow')] };
    expect(readableResult({ status: 200, server: 'weather', result: inner }).blocks[0].text).toBe('Rain tomorrow');
    expect(readableResult({ response: { result: inner } }).blocks[0].text).toBe('Rain tomorrow');
  });

  it('uses structuredContent when there is no text', () => {
    const r = readableResult(rpc({ content: [], structuredContent: { temp: 21 } }));
    expect(r.blocks).toEqual([{ type: 'data', value: { temp: 21 } }]);
  });

  it('handles the local-fallback bare object and bare error', () => {
    expect(readableResult({ accounts: [1, 2] }).kind).toBe('data');
    const e = readableResult({ error: 'no_token', message: 'sign in first' });
    expect(e).toMatchObject({ kind: 'error', isError: true });
    expect(e.blocks[0].text).toBe('sign in first (no_token)');
  });

  it('says nothing for empty bodies and empty content', () => {
    expect(readableResult(null).kind).toBe('empty');
    expect(readableResult(rpc({ content: [] })).kind).toBe('empty');
  });

  it('points at the JSON for non-text content instead of dropping it', () => {
    const r = readableResult(rpc({ content: [{ type: 'image', data: 'xx' }] }));
    expect(r.blocks[0].text).toBe('[image content — see the JSON]');
  });

  it('an isError result is never message-less: JSON text, empty content and structuredContent all get words', () => {
    const jsonText = readableResult(rpc({ isError: true, content: [text('{"error":"bad"}')] }));
    expect(jsonText.isError).toBe(true);
    expect(failureMessage(jsonText)).toBe('{"error":"bad"}');
    expect(failureOf(rpc({ isError: true, content: [] }))).toEqual({ message: 'The tool reported an error.', ranTool: true });
    expect(failureOf(rpc({ isError: true, structuredContent: { error: 'x' } }))).toEqual({ message: '{"error":"x"}', ranTool: true });
  });

  it('a tool that ran is distinguished from a call that was refused', () => {
    expect(readableResult(rpc({ content: [text('Sunny')] })).ranTool).toBe(true);
    expect(readableResult(rpc({ isError: true, content: [text('bad')] })).ranTool).toBe(true);
    expect(readableResult({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } }).ranTool).toBe(false);
  });

  it('treats refusal shapes as errors, not answers: denied, error:true, HTTP >= 400', () => {
    for (const body of [
      { denied: true, status: 403, message: 'Denied by PingOne Authorize' },
      { error: true, message: 'flag off', status: 200 },
      { status: 401, message: 'auth required' },
    ]) {
      const r = readableResult(body);
      expect(r, JSON.stringify(body)).toMatchObject({ kind: 'error', isError: true, ranTool: false });
      expect(r.blocks[0].text).toContain(body.message);
    }
    expect(readableResult({ denied: true, status: 403 }).blocks[0].text).toBe('HTTP 403 refusal');
  });

  it('does not mistake a successful gateway wrapper or a data result with a status field for a refusal', () => {
    expect(readableResult({ status: 200, server: 'weather', result: { content: [text('ok')] } }).isError).toBe(false);
    expect(readableResult({ status: 'active', name: 'Checking' }).kind).toBe('data');
  });
});
