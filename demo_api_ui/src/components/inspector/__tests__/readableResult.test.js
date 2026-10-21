import { describe, it, expect } from 'vitest';
import { readableResult, toolErrorText } from '../readableResult';

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
    expect(toolErrorText(rpc({ isError: true, content: [text('boom')] }))).toBe('boom');
  });

  it('does not treat a successful result as an error', () => {
    expect(toolErrorText(rpc({ content: [text('fine')] }))).toBe('');
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
    expect(e.blocks[0].text).toBe('no_token: sign in first');
  });

  it('says nothing for empty bodies and empty content', () => {
    expect(readableResult(null).kind).toBe('empty');
    expect(readableResult(rpc({ content: [] })).kind).toBe('empty');
  });

  it('points at the JSON for non-text content instead of dropping it', () => {
    const r = readableResult(rpc({ content: [{ type: 'image', data: 'xx' }] }));
    expect(r.blocks[0].text).toBe('[image content — see the JSON]');
  });
});
