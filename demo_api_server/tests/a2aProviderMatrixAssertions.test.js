'use strict';

const { assertActiveProvider, assertProviderIssuer, assertVerticalActivated } = require('./real/helpers/a2aProviderMatrix');

describe('strict A2A provider-matrix assertions', () => {
  test('matches PF sessions against the configured issuer, including a trailing slash', () => {
    expect(() => assertProviderIssuer(
      'pingfederate',
      'https://pf.example.test',
      'https://pf.example.test/',
    )).not.toThrow();
  });

  test('rejects PF validation without a configured issuer', () => {
    expect(() => assertProviderIssuer('pingfederate', 'https://pf.example.test', '')).toThrow(/configured pingfederate issuer/i);
  });

  test('a strict provider-matrix run fails instead of passing when vertical activation fails', () => {
    expect(() => assertVerticalActivated(false, 'pingfederate', 'airlines')).toThrow(/could not activate vertical 'airlines'/);
  });

  test('non-matrix runs can continue to skip an unavailable vertical', () => {
    expect(() => assertVerticalActivated(false, '', 'airlines')).not.toThrow();
  });

  test('matrix mode refuses to run against a differently configured API provider', () => {
    expect(() => assertActiveProvider('pingfederate', 'pingone')).toThrow(/API runtime is configured for pingone/);
  });
});
