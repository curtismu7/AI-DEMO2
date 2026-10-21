import { describe, it, expect } from 'vitest';
import { PARAM_DEFAULTS, defaultParamsFor, pickDefaultTool, DEFAULT_TOOLS } from './inspectorDefaults';

describe('defaultParamsFor', () => {
  it('defaults the weather city to Austin, TX (Texas) when the tool declares city_name', () => {
    expect(PARAM_DEFAULTS.city_name).toBe('Austin, TX');
    expect(defaultParamsFor({ city_name: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, location_name: { type: 'string' } }))
      .toEqual({ city_name: 'Austin, TX' });
  });
  it('never fills coordinates or a saved location name (policy denies location_name)', () => {
    expect(defaultParamsFor({ latitude: {}, longitude: {}, location_name: {} })).toEqual({});
  });
  it('fills nothing for a tool that does not declare it, and tolerates a missing schema', () => {
    expect(defaultParamsFor({ account_type: {} })).toEqual({});
    expect(defaultParamsFor(undefined)).toEqual({});
    expect(defaultParamsFor(null)).toEqual({});
  });
});

describe('pickDefaultTool', () => {
  const t = (...names) => names.map((name) => ({ name }));
  it('prefers the named tools in order, per source', () => {
    expect(pickDefaultTool('banking', t('create_deposit', 'get_my_accounts'))?.name).toBe('get_my_accounts');
    expect(pickDefaultTool('protocol', [{ method: 'resources/list' }, { method: 'server/discover' }], 'method')?.method).toBe('server/discover');
  });
  it('gateway picks a weather tool, exact names first, then anything weather-like, never a search tool', () => {
    expect(pickDefaultTool('gateway', t('brave_news_search', 'get_forecast', 'get_weather_summary'))?.name).toBe('get_weather_summary');
    expect(pickDefaultTool('gateway', t('brave_news_search', 'get_forecast'))?.name).toBe('get_forecast');
    expect(pickDefaultTool('gateway', t('brave_news_search', 'brave_web_search'))).toBeNull();
  });
  it('returns null when nothing preferred is offered, the source has no default, or tools are missing', () => {
    expect(pickDefaultTool('banking', t('create_deposit'))).toBeNull();
    expect(pickDefaultTool('api', t('get_my_accounts'))).toBeNull();
    expect(pickDefaultTool('banking', undefined)).toBeNull();
  });
  it('only ever pre-selects reads: no default tool name looks like a write', () => {
    const names = Object.values(DEFAULT_TOOLS).flat().filter((x) => typeof x === 'string');
    for (const n of names) expect(n, n).not.toMatch(/create|delete|update|withdraw|transfer|deposit|reset|freeze|adjust|set/i);
  });
});
