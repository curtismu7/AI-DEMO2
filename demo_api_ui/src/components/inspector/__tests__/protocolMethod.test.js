import { describe, it, expect } from 'vitest';
import { isProtocolMethod, listOf } from '../protocolMethod';

describe('isProtocolMethod', () => {
  it('recognises every method the Raw JSON-RPC source offers, and the bare handshake ones', () => {
    for (const m of ['resources/list', 'resources/read', 'resources/templates/list', 'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel', 'server/discover', 'tools/list', 'initialize', 'ping']) {
      expect(isProtocolMethod(m), m).toBe(true);
    }
  });
  it('does not mistake a tool name for a protocol method', () => {
    for (const t of ['get_weather_summary', 'listApplicationCatalog', 'create_deposit', '', undefined, null, 42]) {
      expect(isProtocolMethod(t), String(t)).toBe(false);
    }
  });
});

describe('listOf', () => {
  it('turns resources into title / uri / description rows', () => {
    const l = listOf({ resources: [{ uri: 'banking://accounts', name: 'Accounts', description: 'All accounts', mimeType: 'application/json' }, { uri: 'banking://rates' }] });
    expect(l.noun).toBe('resource');
    expect(l.items).toEqual([
      { title: 'Accounts', subtitle: 'banking://accounts', description: 'All accounts' },
      { title: 'banking://rates', subtitle: '', description: '' },
    ]);
  });
  it('handles prompts, resource templates and tools', () => {
    expect(listOf({ prompts: [{ name: 'summarize', description: 'Summarize' }] }).items[0].title).toBe('summarize');
    expect(listOf({ resourceTemplates: [{ uriTemplate: 'banking://accounts/{id}', name: 'Account' }] }).items[0]).toMatchObject({ title: 'Account', subtitle: 'banking://accounts/{id}' });
    expect(listOf({ tools: [{ name: 'get_my_accounts' }] }).noun).toBe('tool');
  });
  it('gives an empty list an empty items array, and anything else null', () => {
    expect(listOf({ resources: [] })).toEqual({ noun: 'resource', items: [] });
    expect(listOf({ serverInfo: { name: 'x' } })).toBeNull();
    expect(listOf([{ name: 'a' }])).toBeNull();
    expect(listOf(null)).toBeNull();
  });
  it('skips junk entries and never returns an unnamed blank', () => {
    expect(listOf({ prompts: [null, 3, {}] }).items).toEqual([{ title: '(unnamed)', subtitle: '', description: '' }]);
  });
});
