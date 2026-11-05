import { describe, it, expect } from 'vitest';
import { PARAM_DEFAULTS, defaultParamsFor, pickDefaultTool, DEFAULT_TOOLS, choiceGroupFor, inferOption, applyOption } from './inspectorDefaults';

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

describe('location choice (city / coordinates / saved location)', () => {
  const WEATHER = { city_name: {}, latitude: {}, longitude: {}, location_name: {}, days: {}, units: {} };
  const group = choiceGroupFor(WEATHER);

  it('applies only to a tool that declares every alternative', () => {
    expect(group?.id).toBe('location');
    expect(choiceGroupFor({ city_name: {}, latitude: {}, longitude: {} })).toBeNull();
    expect(choiceGroupFor({ account_type: {} })).toBeNull();
    expect(choiceGroupFor(undefined)).toBeNull();
  });

  it('infers the option from what is filled: one -> that one, none -> City, several -> null (show everything)', () => {
    expect(inferOption(group, { city_name: 'Austin, TX' })).toBe('city');
    expect(inferOption(group, { latitude: '1', longitude: '2' })).toBe('coords');
    expect(inferOption(group, { location_name: 'home' })).toBe('saved');
    expect(inferOption(group, {})).toBe('city');
    expect(inferOption(group, { city_name: '  ', latitude: '' })).toBe('city');
    expect(inferOption(group, { city_name: 'Austin', latitude: '30' })).toBeNull();
  });

  it('switching clears every other alternative and applies the new one\'s defaults, keeping unrelated values', () => {
    const start = { city_name: 'Austin, TX', days: '3' };
    expect(applyOption(group, 'coords', start)).toEqual({ days: '3', latitude: '30.2672', longitude: '-97.7431' });
    expect(applyOption(group, 'saved', { latitude: '30', longitude: '-97', days: '3' })).toEqual({ days: '3' });
    expect(applyOption(group, 'city', { latitude: '30', longitude: '-97' })).toEqual({ city_name: PARAM_DEFAULTS.city_name });
  });

  it('says what the demo policy does with each alternative', () => {
    const hint = (id) => group.options.find((o) => o.id === id).hint;
    expect(hint('city')).toMatch(/denied/i);
    expect(hint('saved')).toMatch(/always denied/i);
  });
});

